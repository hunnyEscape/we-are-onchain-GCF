// src/shared/utils/autoShipmentHelper.ts
// シンプルな自動出荷ヘルパー関数（ステータス管理付き）

import * as admin from "firebase-admin";
import { processInvoiceShipmentInternal } from "./internalShipmentProcessor";
import { simplifyOpenLogiError } from "./openlogiErrorUtils";

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

		if (result.success && result.shipmentId) {
			// ✅ 成功時の状態保存
			await admin.firestore()
				.collection('invoices')
				.doc(invoiceId)
				.update({
					shipmentId: result.shipmentId,
					autoShippedAt: admin.firestore.FieldValue.serverTimestamp(),
					// OpenLogiステータス管理
					openlogiStatus: "success",
					openlogiShipmentId: result.shipmentId,
					openlogiLastAttempt: admin.firestore.FieldValue.serverTimestamp()
				});
		} else {
			// ❌ 失敗時の状態保存
			const simpleError = simplifyOpenLogiError(result);
			
			await admin.firestore()
				.collection('invoices')
				.doc(invoiceId)
				.update({
					// OpenLogiステータス管理
					openlogiStatus: "failed",
					openlogiError: simpleError,
					openlogiLastAttempt: admin.firestore.FieldValue.serverTimestamp()
				});
		}

	} catch (error) {
		// エラーが発生した場合も状態を記録
		try {
			await admin.firestore()
				.collection('invoices')
				.doc(invoiceId)
				.update({
					openlogiStatus: "failed",
					openlogiError: "処理中にエラーが発生しました",
					openlogiLastAttempt: admin.firestore.FieldValue.serverTimestamp()
				});
		} catch (updateError) {
			// 状態更新も失敗した場合は無視（元のエラーハンドリング方針を維持）
		}
	}
}