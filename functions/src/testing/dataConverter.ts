// src/testing/dataConverter.ts
// OpenLogi データ変換テスト関数（シンプル版）

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

import { 
  ConversionTestRequest,
  ConversionTestResponse,
  ConversionErrorResponse,
  OpenLogiError
} from "../shared/types/openlogi";
import { 
  convertToOpenLogiFormat,
  generateConversionMetadata
} from "../shared/utils/openlogiConverter";
import { ERROR_MESSAGES, isDebugMode } from "../shared/config/openlogiConfig";

/**
 * OpenLogi データ変換テスト関数（シンプル版）
 * Firestoreからデータを取得してOpenLogi形式に変換し、curlレスポンスで結果を返す
 */
export const testOpenLogiDataConversion = onRequest({
  region: "asia-northeast1",
  memory: "512MiB",
  timeoutSeconds: 60,
  cors: true,
}, async (request, response) => {
  const startTime = Date.now();
  let invoiceId: string | undefined;

  try {
    // POSTメソッドのみ受け付け
    if (request.method !== "POST") {
      response.status(405).json({
        success: false,
        error: "INVALID_INPUT" as OpenLogiError,
        message: "Only POST method is allowed",
        timestamp: new Date().toISOString()
      } as ConversionErrorResponse);
      return;
    }

    logger.info("OpenLogi conversion test started", {
      method: request.method,
      timestamp: new Date().toISOString(),
      userAgent: request.get("User-Agent"),
      contentType: request.get("Content-Type"),
    });

    // リクエストパラメータ取得
    const {
      invoiceId: reqInvoiceId,
      validateOnly = false,
      includeDebugInfo = false
    }: ConversionTestRequest = request.body;

    invoiceId = reqInvoiceId;

    // 入力バリデーション
    if (!invoiceId || typeof invoiceId !== 'string') {
      const errorResponse: ConversionErrorResponse = {
        success: false,
        error: "INVALID_INPUT",
        message: "invoiceId is required and must be string",
        timestamp: new Date().toISOString()
      };
      response.status(400).json(errorResponse);
      return;
    }

    logger.info("Processing conversion test", {
      invoiceId,
      validateOnly,
      includeDebugInfo
    });

    // 1. Invoice データ取得
    const invoiceDoc = await admin.firestore()
      .collection('invoices')
      .doc(invoiceId)
      .get();

    if (!invoiceDoc.exists) {
      throw new Error(ERROR_MESSAGES.INVOICE_NOT_FOUND);
    }

    const invoiceData = invoiceDoc.data();
    logger.info("Invoice data retrieved", {
      invoiceId,
      userId: invoiceData?.userId,
      status: invoiceData?.status,
      amount_usd: invoiceData?.amount_usd
    });

    // 2. User データ取得
    if (!invoiceData?.userId) {
      throw new Error("Missing userId in invoice data");
    }

    const userDoc = await admin.firestore()
      .collection('users')
      .doc(invoiceData.userId)
      .get();

    if (!userDoc.exists) {
      throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const userData = userDoc.data();

    // 3. デフォルト住所特定
    const userAddresses = userData?.address || [];
    const defaultAddress = userAddresses.find((addr: any) => addr.isDefault);

    if (!defaultAddress) {
      throw new Error(`Default address not found for user: ${invoiceData.userId}`);
    }

    logger.info("User address data retrieved", {
      invoiceId,
      userId: invoiceData.userId,
      addressCount: userAddresses.length,
      hasDefaultAddress: !!defaultAddress,
      isInternational: defaultAddress.shippingRequest?.international
    });

    // 4. 変換メタデータ生成
    const conversionMetadata = generateConversionMetadata(invoiceData, defaultAddress, startTime);

    // バリデーションのみの場合はここで終了
    if (validateOnly) {
      const validationResponse: ConversionTestResponse = {
        success: true,
        invoiceId,
        conversionResult: {
          openlogiPayload: {} as any, // バリデーションのみなので空
          sourceData: includeDebugInfo ? {
            invoice: invoiceData,
            userAddress: defaultAddress
          } : undefined,
          conversionMetadata
        },
        debugInfo: includeDebugInfo ? {
          validationOnly: true,
          debugMode: isDebugMode(),
          environment: process.env.NODE_ENV || 'unknown'
        } : undefined,
        timestamp: new Date().toISOString()
      };
      
      logger.info("Validation completed successfully", {
        invoiceId,
        shippingType: conversionMetadata.shippingType,
        processingTime: conversionMetadata.processingTime
      });
      
      response.status(200).json(validationResponse);
      return;
    }

    // 5. OpenLogi 形式に変換
    const openlogiPayload = convertToOpenLogiFormat(invoiceData, defaultAddress);

    logger.info("Conversion completed successfully", {
      invoiceId,
      shippingType: conversionMetadata.shippingType,
      itemCount: conversionMetadata.itemCount,
      totalAmountJPY: openlogiPayload.total_amount,
      processingTime: conversionMetadata.processingTime
    });

    // 6. 成功レスポンス生成
    const successResponse: ConversionTestResponse = {
      success: true,
      invoiceId,
      conversionResult: {
        openlogiPayload,
        sourceData: includeDebugInfo ? {
          invoice: {
            id: invoiceData.id,
            sessionId: invoiceData.sessionId,
            userId: invoiceData.userId,
            amount_usd: invoiceData.amount_usd,
            cartSnapshot: invoiceData.cartSnapshot,
            status: invoiceData.status
          },
          userAddress: {
            id: defaultAddress.id,
            shippingFee: defaultAddress.shippingFee,
            shippingRegion: defaultAddress.shippingRegion,
            displayName: defaultAddress.displayName,
            isDefault: defaultAddress.isDefault,
            shippingRequest: defaultAddress.shippingRequest
          }
        } : undefined,
        conversionMetadata
      },
      debugInfo: includeDebugInfo ? {
        debugMode: isDebugMode(),
        environment: process.env.NODE_ENV || 'unknown',
        functionRegion: "asia-northeast1"
      } : undefined,
      timestamp: new Date().toISOString()
    };

    const totalProcessingTime = Date.now() - startTime;
    logger.info("Conversion test completed successfully", {
      invoiceId,
      totalProcessingTime: `${totalProcessingTime}ms`
    });

    response.status(200).json(successResponse);

  } catch (error: any) {
    const totalProcessingTime = Date.now() - startTime;
    
    logger.error("Conversion test failed", {
      invoiceId,
      error: error.message,
      stack: error.stack,
      totalProcessingTime: `${totalProcessingTime}ms`
    });

    // エラーの種類を判定
    let errorType: OpenLogiError = "CONVERSION_FAILED";
    const errorMessage = error.message.toLowerCase();
    
    if (errorMessage.includes("invoice not found")) {
      errorType = "INVOICE_NOT_FOUND";
    } else if (errorMessage.includes("user") && errorMessage.includes("not found")) {
      errorType = "USER_NOT_FOUND";
    } else if (errorMessage.includes("address") || errorMessage.includes("recipient")) {
      errorType = "ADDRESS_INVALID";
    } else if (errorMessage.includes("firestore")) {
      errorType = "FIRESTORE_ERROR";
    } else if (errorMessage.includes("missing") && errorMessage.includes("shipping")) {
      errorType = "MISSING_SHIPPING_REQUEST";
    } else if (errorMessage.includes("currency") || errorMessage.includes("conversion")) {
      errorType = "CURRENCY_CONVERSION_ERROR";
    }

    const errorResponse: ConversionErrorResponse = {
      success: false,
      invoiceId,
      error: errorType,
      message: error.message,
      details: isDebugMode() ? {
        stack: error.stack,
        totalProcessingTime: `${totalProcessingTime}ms`
      } : undefined,
      timestamp: new Date().toISOString()
    };

    // ステータスコード判定を修正
    let statusCode = 500; // デフォルト
    if (errorType === "INVOICE_NOT_FOUND" || errorType === "USER_NOT_FOUND") {
      statusCode = 404;
    } else if (errorType === "ADDRESS_INVALID" || errorType === "MISSING_SHIPPING_REQUEST") {
      statusCode = 400;
    }
                      
    response.status(statusCode).json(errorResponse);
  }
});