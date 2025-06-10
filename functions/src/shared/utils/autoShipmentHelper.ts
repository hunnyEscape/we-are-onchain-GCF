// src/shared/utils/autoShipmentHelper.ts
// シンプルな自動出荷ヘルパー関数

import * as admin from "firebase-admin";
import { processInvoiceShipmentInternal } from "./internalShipmentProcessor";

/**
 * 自動出荷処理
 * OpenNode Webhook から呼び出される
 */
export async function triggerAutoShipment(invoiceId: string): Promise<void> {
	try {
		// 重複チェック - 既に出荷済みならスキップ
		const invoiceDoc = await admin.firestore()
			.collection('invoices')
			.doc(invoiceId)
			.get();

		if (!invoiceDoc.exists) {
			return; // Invoice が存在しない場合はスキップ
		}

		const invoiceData = invoiceDoc.data()!;

		// 既に shipmentId があれば重複なのでスキップ
		if (invoiceData.shipmentId) {
			return;
		}

		// 🚀 既存の内部出荷処理を呼び出し
		const result = await processInvoiceShipmentInternal(invoiceId);

		// 成功時のみ shipmentId を保存
		if (result.success && result.shipmentId) {
			await admin.firestore()
				.collection('invoices')
				.doc(invoiceId)
				.update({
					shipmentId: result.shipmentId,
					autoShippedAt: admin.firestore.FieldValue.serverTimestamp()
				});
		}

	} catch (error) {
		// エラーは無視（支払い処理に影響させない）
		// 必要に応じて後で手動出荷
	}
}