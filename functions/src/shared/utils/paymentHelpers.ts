import * as logger from "firebase-functions/logger";
import { db } from "../config/firebase";

/**
 * 支払い成功処理
 */
export async function processPaymentSuccess(
  invoiceId: string,
  webhookData: any
): Promise<void> {
  try {
    // 1. Invoice ステータス更新
    const invoiceRef = db.collection("invoices").doc(invoiceId);
    const invoiceDoc = await invoiceRef.get();

    if (invoiceDoc.exists) {
      await invoiceRef.update({
        status: "redirect",
        paidAt: new Date(),
        webhook_data: webhookData,
        updatedAt: new Date(),
      });

      // 2. ユーザーカートクリア
      const invoiceData = invoiceDoc.data();
      if (invoiceData?.userId) {
        await db.doc(`users/${invoiceData.userId}`).update({
          cart: [],
          lastPurchaseAt: new Date(),
        });

        logger.info("User cart cleared after payment", {
          userId: invoiceData.userId,
          invoiceId,
        });
      }
    } else {
      logger.warn("Invoice not found for payment processing", {
        invoiceId,
      });
    }
  } catch (error: any) {
    logger.error("Payment success processing failed", {
      invoiceId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * 支払い期限切れ処理
 */
export async function processPaymentExpired(
  invoiceId: string,
  webhookData: any
): Promise<void> {
  try {
    const invoiceRef = db.collection("invoices").doc(invoiceId);
    const invoiceDoc = await invoiceRef.get();

    if (invoiceDoc.exists) {
      await invoiceRef.update({
        status: "expired",
        expiredAt: new Date(),
        webhook_data: webhookData,
        updatedAt: new Date(),
      });
    }
  } catch (error: any) {
    logger.error("Payment expiry processing failed", {
      invoiceId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Invoice ステータス更新
 */
export async function updateInvoiceStatus(
  invoiceId: string,
  status: string,
  webhookData: any
): Promise<void> {
  try {
    const invoiceRef = db.collection("invoices").doc(invoiceId);

    await invoiceRef.update({
      status,
      webhook_data: webhookData,
      updatedAt: new Date(),
    });
  } catch (error: any) {
    logger.error("Invoice status update failed", {
      invoiceId,
      status,
      error: error.message,
    });
    throw error;
  }
}