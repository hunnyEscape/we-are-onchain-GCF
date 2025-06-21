import * as logger from "firebase-functions/logger";
import { db } from "../config/firebase";

/**
 * 在庫更新処理
 */
async function updateProductStock(
	items: any[],
	dev?: boolean
): Promise<void> {
	const prefix = dev ? 'dev-' : '';
	const collectionName = `${prefix}products`;

	for (const item of items) {
		try {
			const productRef = db.collection(collectionName).doc(item.id);
			const productDoc = await productRef.get();

			if (productDoc.exists) {
				const productData = productDoc.data();
				const currentStock = productData?.stock || 0;
				const newStock = currentStock - item.quantity;

				await productRef.update({
					stock: newStock,
					updatedAt: new Date(),
				});

				logger.info("Product stock updated", {
					productId: item.id,
					quantity: item.quantity,
					previousStock: currentStock,
					newStock: newStock,
				});

				if (newStock < 0) {
					logger.warn("Product stock is negative", {
						productId: item.id,
						newStock: newStock,
					});
				}
			} else {
				logger.warn("Product not found for stock update", {
					productId: item.id,
				});
			}
		} catch (error: any) {
			logger.error("Product stock update failed", {
				productId: item.id,
				error: error.message,
			});
			// 他の商品の処理は続行
		}
	}
}

/**
 * 支払い成功処理
 */
export async function processPaymentSuccess(
	invoiceId: string,
	webhookData: any,
	dev?: boolean
): Promise<void> {
	logger.info("🔥🔥🔥 NEW VERSION processPaymentSuccess CALLED 🔥🔥🔥", {
		invoiceId,
		dev,
		timestamp: new Date().toISOString()
	});
	try {
		const prefix = dev ? 'dev-' : '';
		const collectionName = `${prefix}invoices`;
		// 1. Invoice ステータス更新
		const invoiceRef = db.collection(collectionName).doc(invoiceId);
		const invoiceDoc = await invoiceRef.get();


		const invoiceData = invoiceDoc.data();
		const currentStatus = invoiceData?.status;

		if (currentStatus === "paid") {
			logger.info("Invoice already paid; skipping redirect update", { invoiceId });
			return;  // すでに paid の場合は何もしない
		}

		if (invoiceDoc.exists) {

			logger.info("CALLED2", {
				invoiceId,
				dev,
				timestamp: new Date().toISOString()
			});

			await invoiceRef.update({
				status: "redirect",
				paidAt: new Date(),
				webhook_data: webhookData,
				updatedAt: new Date(),
			});

			// 2. ユーザーカートクリア
			const invoiceData = invoiceDoc.data();
			if (invoiceData?.userId) {
				const userCollectionName = `${prefix}users`;
				await db.doc(`${userCollectionName}/${invoiceData.userId}`).update({
					cart: [],
					lastPurchaseAt: new Date(),
				});

				logger.info("User cart cleared after payment", {
					userId: invoiceData.userId,
					invoiceId,
					collection: userCollectionName,
				});
			}
			// 3. 在庫更新
			logger.info("Checking for stock update", {
				hasCartSnapshot: !!invoiceData?.cartSnapshot,
				hasItems: !!invoiceData?.cartSnapshot?.items,
				itemsLength: invoiceData?.cartSnapshot?.items?.length || 0,
				dev: dev
			});
			if (invoiceData?.cartSnapshot?.items) {
				await updateProductStock(invoiceData.cartSnapshot.items, dev);
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