// src/openlogi/invoiceProcessor.ts
// Invoice データ処理・検証ヘルパー関数

import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { ERROR_MESSAGES } from "../shared/config/openlogiConfig";

/**
 * Invoiceデータ取得結果
 */
export interface InvoiceDataResult {
  success: boolean;
  invoiceData?: any;
  userAddress?: any;
  error?: {
    type: 'INVOICE_NOT_FOUND' | 'USER_NOT_FOUND' | 'ADDRESS_NOT_FOUND' | 'FIRESTORE_ERROR';
    message: string;
    details?: any;
  };
}

/**
 * Invoice + User Address データ取得
 */
export async function fetchInvoiceWithAddress(invoiceId: string): Promise<InvoiceDataResult> {
  try {
    logger.info("Fetching invoice data", { invoiceId });

    // 1. Invoice データ取得
    const invoiceDoc = await admin.firestore()
      .collection('invoices')
      .doc(invoiceId)
      .get();

    if (!invoiceDoc.exists) {
      return {
        success: false,
        error: {
          type: 'INVOICE_NOT_FOUND',
          message: ERROR_MESSAGES.INVOICE_NOT_FOUND
        }
      };
    }

    const invoiceData = invoiceDoc.data();
    logger.info("Invoice retrieved", {
      invoiceId,
      userId: invoiceData?.userId,
      status: invoiceData?.status,
      hasCartSnapshot: !!invoiceData?.cartSnapshot,
      hasShippingSnapshot: !!invoiceData?.shippingSnapshot
    });

    // 2. User Address データ取得
    let userAddress;
    
    // 新しい構造: shippingSnapshot.shippingAddress を優先
    if (invoiceData && invoiceData.shippingSnapshot?.shippingAddress) {
      userAddress = invoiceData.shippingSnapshot.shippingAddress;
      logger.info("Using address from shippingSnapshot", {
        invoiceId,
        addressId: userAddress.id,
        isDefault: userAddress.isDefault,
        hasShippingRequest: !!userAddress.shippingRequest
      });
    } else {
      // フォールバック: Userコレクションから取得
      if (invoiceData && !invoiceData.userId) {
        return {
          success: false,
          error: {
            type: 'USER_NOT_FOUND',
            message: "Missing userId in invoice data"
          }
        };
      }

      const userDoc = await admin.firestore()
        .collection('users')
        .doc(invoiceData?.userId)
        .get();

      if (!userDoc.exists) {
        return {
          success: false,
          error: {
            type: 'USER_NOT_FOUND',
            message: ERROR_MESSAGES.USER_NOT_FOUND
          }
        };
      }

      const userData = userDoc.data();
      const userAddresses = userData?.address || [];
      userAddress = userAddresses.find((addr: any) => addr.isDefault);

      if (!userAddress) {
        return {
          success: false,
          error: {
            type: 'ADDRESS_NOT_FOUND',
            message: `Default address not found for user: ${invoiceData?.userId}`
          }
        };
      }

      logger.info("Using address from user collection", {
        invoiceId,
        userId: invoiceData?.userId,
        addressCount: userAddresses.length,
        hasShippingRequest: !!userAddress.shippingRequest
      });
    }

    // 3. 必須データ検証
    const validationResult = validateInvoiceAndAddress(invoiceData, userAddress);
    if (!validationResult.isValid) {
      return {
        success: false,
        error: {
          type: 'ADDRESS_NOT_FOUND',
          message: "Invalid invoice or address data",
          details: validationResult.errors
        }
      };
    }

    return {
      success: true,
      invoiceData,
      userAddress
    };

  } catch (error: any) {
    logger.error("Failed to fetch invoice data", {
      invoiceId,
      error: error.message,
      stack: error.stack
    });

    return {
      success: false,
      error: {
        type: 'FIRESTORE_ERROR',
        message: `Firestore operation failed: ${error.message}`,
        details: error.stack
      }
    };
  }
}

/**
 * Invoice + Address データバリデーション
 */
export function validateInvoiceAndAddress(invoiceData: any, userAddress: any): {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Invoice基本データチェック
  if (!invoiceData.id) errors.push("Missing invoice.id");
  if (!invoiceData.sessionId) errors.push("Missing invoice.sessionId");
  if (!invoiceData.amount_usd || typeof invoiceData.amount_usd !== 'number') {
    errors.push("Missing or invalid invoice.amount_usd");
  }

  // CartSnapshot チェック
  if (!invoiceData.cartSnapshot) {
    errors.push("Missing invoice.cartSnapshot");
  } else {
    if (!Array.isArray(invoiceData.cartSnapshot.items) || invoiceData.cartSnapshot.items.length === 0) {
      errors.push("Missing or empty cartSnapshot.items");
    } else {
      // 各商品アイテムチェック
      invoiceData.cartSnapshot.items.forEach((item: any, index: number) => {
        if (!item.id) errors.push(`Missing item.id at index ${index}`);
        if (!item.quantity || typeof item.quantity !== 'number') {
          errors.push(`Missing or invalid item.quantity at index ${index}`);
        }
      });
    }

    if (typeof invoiceData.cartSnapshot.subtotal !== 'number') {
      warnings.push("Missing or invalid cartSnapshot.subtotal");
    }
  }

  // User Address チェック
  if (!userAddress) {
    errors.push("Missing userAddress");
  } else {
    if (!userAddress.shippingRequest) {
      errors.push("Missing userAddress.shippingRequest");
    } else {
      const shippingRequest = userAddress.shippingRequest;
      
      if (typeof shippingRequest.international !== 'boolean') {
        errors.push("Missing or invalid shippingRequest.international");
      }

      if (!shippingRequest.recipient) {
        errors.push("Missing shippingRequest.recipient");
      } else {
        const recipient = shippingRequest.recipient;
        if (!recipient.name) errors.push("Missing recipient.name");
        if (!recipient.address1) errors.push("Missing recipient.address1");
        if (!recipient.postcode) errors.push("Missing recipient.postcode");
        if (!recipient.phone) errors.push("Missing recipient.phone");

        if (shippingRequest.international) {
          if (!recipient.region_code) errors.push("Missing recipient.region_code for international shipping");
          if (!recipient.city) errors.push("Missing recipient.city for international shipping");
        } else {
          if (!recipient.prefecture) errors.push("Missing recipient.prefecture for domestic shipping");
        }
      }
    }

    // shippingFee チェック（警告レベル）
    if (typeof userAddress.shippingFee !== 'number') {
      warnings.push("Missing or invalid userAddress.shippingFee");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

/**
 * Invoice ステータス確認
 */
export function checkInvoiceStatus(invoiceData: any): {
  canProcess: boolean;
  status: string;
  reason?: string;
} {
  const status = invoiceData.status;

  // 処理可能ステータス: 'paid'
  if (status === 'paid') {
    return {
      canProcess: true,
      status
    };
  }

  // 処理不可能ステータス
  const nonProcessableStatuses = ['pending', 'expired', 'cancelled', 'failed'];
  if (nonProcessableStatuses.includes(status)) {
    return {
      canProcess: false,
      status,
      reason: `Invoice status '${status}' is not processable for shipment`
    };
  }

  // 不明ステータス（警告として処理可能）
  return {
    canProcess: true,
    status,
    reason: `Unknown invoice status '${status}' - proceeding with caution`
  };
}

/**
 * 配送地域情報抽出
 */
export function extractShippingInfo(userAddress: any): {
  region: string;
  isInternational: boolean;
  carrier?: string;
  method?: string;
} {
  const shippingRequest = userAddress.shippingRequest;
  
  return {
    region: shippingRequest.international 
      ? shippingRequest.recipient.region_code 
      : shippingRequest.recipient.prefecture,
    isInternational: shippingRequest.international,
    carrier: shippingRequest.delivery_carrier,
    method: shippingRequest.delivery_method
  };
}