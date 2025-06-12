// src/shared/utils/internalShipmentProcessor.ts
// 既存のshipmentSubmitter.tsから内部関数を抽出

import * as admin from "firebase-admin";
import {
	convertToOpenLogiFormat,
} from "./openlogiConverter";
import {
	submitOpenLogiShipment
} from "./openlogiApiClient";
import { ERROR_MESSAGES } from "../config/openlogiConfig";

/**
 * 内部出荷処理関数
 * 既存のshipmentSubmitter.tsのロジックを内部関数化
 */
export interface ProcessShipmentResult {
	success: boolean;
	shipmentId?: string;
	error?: string;
	details?: any;           // OpenLogi API の詳細エラー
	apiResponse?: any;       // 生APIレスポンス
	debugInfo?: {           // デバッグ用追加情報
		invoiceData?: any;
		userAddress?: any;
		openlogiPayload?: any;
		processingSteps?: string[];
	};
}
export async function processInvoiceShipmentInternal(
	invoiceId: string, 
	options?: { includeDebugInfo?: boolean }
): Promise<ProcessShipmentResult> {
	try {
		// 🔍 Step 1: Invoice データ取得
		const invoiceDoc = await admin.firestore()
			.collection('invoices')
			.doc(invoiceId)
			.get();

		if (!invoiceDoc.exists) {
			throw new Error(ERROR_MESSAGES.INVOICE_NOT_FOUND);
		}
		const invoiceData = invoiceDoc.data()!;

		// 🔍 Step 2: User Address データ取得
		if (!invoiceData.userId) {
			throw new Error("Missing userId in invoice data");
		}

		let userAddress: any;
		if (invoiceData.shippingSnapshot?.shippingAddress) {
			userAddress = invoiceData.shippingSnapshot.shippingAddress;
		} else {
			const userDoc = await admin.firestore()
				.collection('users')
				.doc(invoiceData.userId)
				.get();
			if (!userDoc.exists) {
				throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
			}
			const userData = userDoc.data()!;
			const userAddresses = userData.address || [];
			userAddress = userAddresses.find((addr: any) => addr.isDefault);
			if (!userAddress) {
				throw new Error(`Default address not found for user: ${invoiceData.userId}`);
			}
		}

		// 🔄 Step 3: OpenLogi形式に変換
		const openlogiPayload = convertToOpenLogiFormat(invoiceData, userAddress);

		// 🚀 Step 4: OpenLogi API呼び出し
		const apiResult = await submitOpenLogiShipment(openlogiPayload, {
			testMode: false,
			includeRawResponse: true
		});

		if (apiResult.success && apiResult.data) {
			const raw = apiResult.data;

			// ランタイムチェック：必須フィールドが存在するか
			if (!raw.id || !raw.identifier || !raw.order_no || !raw.status) {
				throw new Error("OpenLogi API のレスポンスに必須フィールドがありません");
			}

			// 成功時の結果を返す
			return {
				success: true,
				shipmentId: raw.id
			};

		} else {
			// ❌ API呼び出し失敗
			return {
				success: false,
				error: apiResult.error?.message || "Unknown API error",
				details: apiResult.error?.details,  // ← OpenLogi の詳細エラー
				apiResponse: apiResult.apiResponse   // ← 生レスポンス
			};
		}

	} catch (error: any) {
		// エラー時の結果を返す
		return {
			success: false,
			error: error.message
		};
	}
}