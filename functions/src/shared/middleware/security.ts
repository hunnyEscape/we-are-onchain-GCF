import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import { db } from "../config/firebase";

export interface WebhookVerificationResult {
  isValid: boolean;
  invoiceId?: string;
  status?: string;
  webhookData?: any;
  errorMessage?: string;
}

/**
 * OpenNode Webhook署名検証
 */
export function verifyWebhookSignature(
  invoiceId: string,
  receivedHash: string,
  apiKey: string
): boolean {
  try {
    // HMAC-SHA256で署名を再計算
    const calculatedHash = crypto
      .createHmac("sha256", apiKey)
      .update(invoiceId)
      .digest("hex");

    // 署名検証
    const isValid = receivedHash === calculatedHash;

    if (isValid) {
      logger.info("✅ Webhook signature verified successfully", {
        invoiceId,
        hashPrefix: calculatedHash.substring(0, 16) + "...",
      });
    } else {
      logger.error("Webhook signature verification failed", {
        invoiceId,
        receivedHash: receivedHash.substring(0, 16) + "...",
        calculatedHash: calculatedHash.substring(0, 16) + "...",
        lengthMatch: receivedHash.length === calculatedHash.length,
      });
    }

    return isValid;
  } catch (error: any) {
    logger.error("Webhook signature verification error", {
      error: error.message,
      invoiceId,
    });
    return false;
  }
}

/**
 * Webhook検証（基本フィールドチェック + 署名検証）
 */
export function verifyWebhookPayload(
  webhookData: any,
  apiKey: string
): WebhookVerificationResult {
  const { id: invoiceId, hashed_order: receivedHash, status } = webhookData;

  logger.info("Webhook payload for verification", {
    invoiceId,
    status,
    hasHashedOrder: !!receivedHash,
    payloadKeys: Object.keys(webhookData || {}),
  });

  // 必須フィールドチェック
  if (!invoiceId || !receivedHash) {
    const errorMessage = "Missing required verification fields";
    logger.warn(errorMessage, {
      hasInvoiceId: !!invoiceId,
      hasHashedOrder: !!receivedHash,
    });

    return {
      isValid: false,
      errorMessage,
    };
  }

  // 署名検証
  const isSignatureValid = verifyWebhookSignature(invoiceId, receivedHash, apiKey);

  return {
    isValid: isSignatureValid,
    invoiceId,
    status,
    webhookData,
    errorMessage: isSignatureValid ? undefined : "Invalid webhook signature",
  };
}

/**
 * セキュアログをFirestoreに保存
 */
export async function saveSecureWebhookLog(
  verification: WebhookVerificationResult,
  request: any,
  processingTime: number,
  processedAction: string,
  apiKey: string
): Promise<string> {
  try {
    const timestamp = new Date();
    const docId = verification.isValid
      ? `SECURE-${timestamp.toISOString().replace(/[:.]/g, "-")}`
      : `SECURE-ERROR-${timestamp.toISOString().replace(/[:.]/g, "-")}`;

    const logData = {
      receivedAt: timestamp,
      webhookData: verification.webhookData,
      verificationResult: {
        signatureValid: verification.isValid,
        invoiceId: verification.invoiceId,
        status: verification.status,
        processedAction,
        errorMessage: verification.errorMessage,
      },
      source: verification.isValid ? "opennode-verified" : "opennode-security-error",
      method: request.method,
      headers: {
        contentType: request.get("Content-Type"),
        userAgent: request.get("User-Agent"),
      },
      metadata: {
        processingTime: `${processingTime}ms`,
        success: verification.isValid,
        apiKeyUsed: apiKey.substring(0, 8) + "***",
      },
    };

    await db.collection("SecureWebhookLogs").doc(docId).set(logData);

    logger.info("Secure webhook log saved", {
      documentId: docId,
      success: verification.isValid,
    });

    return docId;
  } catch (error: any) {
    logger.error("Failed to save secure webhook log", {
      error: error.message,
    });
    throw error;
  }
}