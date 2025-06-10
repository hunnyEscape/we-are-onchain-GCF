// src/shared/utils/autoShipmentHelper.ts
// シンプルな自動出荷ヘルパー関数

import * as admin from "firebase-admin";
import {
	convertToOpenLogiFormat,
	generateConversionMetadata
} from "./openlogiConverter";
import {
	submitOpenLogiShipment
} from "./openlogiApiClient";

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

		// User Address 取得
		let userAddress: any;
		if (invoiceData.shippingSnapshot?.shippingAddress) {
			userAddress = invoiceData.shippingSnapshot.shippingAddress;
		} else {
			const userDoc = await admin.firestore()
				.collection('users')
				.doc(invoiceData.userId)
				.get();
			if (!userDoc.exists) {
				return;
			}
			const userData = userDoc.data()!;
			const userAddresses = userData.address || [];
			userAddress = userAddresses.find((addr: any) => addr.isDefault);
			if (!userAddress) {
				return;
			}
		}

		// OpenLogi形式に変換
		const openlogiPayload = convertToOpenLogiFormat(invoiceData, userAddress);

		// OpenLogi API呼び出し
		const apiResult = await submitOpenLogiShipment(openlogiPayload, {
			testMode: false,
			includeRawResponse: false
		});

		// 成功時のみ shipmentId を保存
		if (apiResult.success && apiResult.data) {
			await admin.firestore()
				.collection('invoices')
				.doc(invoiceId)
				.update({
					shipmentId: apiResult.data.id,
					autoShippedAt: admin.firestore.FieldValue.serverTimestamp()
				});
		}

	} catch (error) {
		// エラーは無視（支払い処理に影響させない）
		// 必要に応じて後で手動出荷
	}
}