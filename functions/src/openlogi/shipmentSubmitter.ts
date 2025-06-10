// src/openlogi/shipmentSubmitter.ts
// OpenLogi 出荷依頼統合機能（Invoice → API送信）

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

import {
	ShipmentSubmissionResult,
	ShipmentSubmissionOptions,
	ShipmentApiSuccessResponse
} from "../shared/types/openlogiShipment";
import {
	convertToOpenLogiFormat,
	generateConversionMetadata
} from "../shared/utils/openlogiConverter";
import {
	submitOpenLogiShipment
} from "../shared/utils/openlogiApiClient";
import { ERROR_MESSAGES, isDebugMode } from "../shared/config/openlogiConfig";

export const processInvoiceShipment = onRequest({
	region: "asia-northeast1",
	memory: "512MiB",
	timeoutSeconds: 120,
	cors: true,
}, async (request, response) => {
	const startTime = Date.now();
	let invoiceId: string | undefined;

	try {
		// POSTメソッドのみ受け付け
		if (request.method !== "POST") {
			response.status(405).json({
				success: false,
				invoiceId: "",
				message: "Only POST method is allowed",
				error: {
					type: "VALIDATION_ERROR",
					message: "Invalid HTTP method"
				},
				timestamp: new Date().toISOString()
			} as ShipmentSubmissionResult);
			return;
		}

		logger.info("OpenLogi shipment submission started", {
			method: request.method,
			timestamp: new Date().toISOString(),
			userAgent: request.get("User-Agent")
		});

		// リクエストパラメータ取得
		const {
			invoiceId: reqInvoiceId,
			validateOnly = false,
			includeDebugInfo = false,
			testMode = false
		}: {
			invoiceId: string;
		} & ShipmentSubmissionOptions = request.body;
		invoiceId = reqInvoiceId;

		// 入力バリデーション
		if (!invoiceId || typeof invoiceId !== 'string') {
			response.status(400).json({
				success: false,
				invoiceId: invoiceId || "",
				message: "invoiceId is required and must be string",
				error: {
					type: "VALIDATION_ERROR",
					message: "Missing or invalid invoiceId parameter"
				},
				timestamp: new Date().toISOString()
			} as ShipmentSubmissionResult);
			return;
		}

		logger.info("Processing shipment submission", {
			invoiceId,
			validateOnly,
			includeDebugInfo,
			testMode
		});

		// 🔍 Step 1: Invoice データ取得
		const invoiceDoc = await admin.firestore()
			.collection('invoices')
			.doc(invoiceId)
			.get();

		if (!invoiceDoc.exists) {
			throw new Error(ERROR_MESSAGES.INVOICE_NOT_FOUND);
		}
		const invoiceData = invoiceDoc.data()!;

		logger.info("Invoice data retrieved", {
			invoiceId,
			userId: invoiceData.userId,
			status: invoiceData.status,
			amount_usd: invoiceData.amount_usd,
			hasCartSnapshot: !!invoiceData.cartSnapshot,
			hasShippingSnapshot: !!invoiceData.shippingSnapshot
		});

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
		const conversionMetadata = generateConversionMetadata(invoiceData, userAddress, startTime);

		// バリデーションのみの場合
		if (validateOnly) {
			response.status(200).json({
				success: true,
				invoiceId,
				message: "✅ Validation completed successfully - No API call made",
				timestamp: new Date().toISOString()
			} as ShipmentSubmissionResult);
			return;
		}

		// 🚀 Step 4: OpenLogi API呼び出し
		const apiResult = await submitOpenLogiShipment(openlogiPayload, {
			testMode,
			includeRawResponse: includeDebugInfo
		});
		const totalProcessingTime = `${Date.now() - startTime}ms`;

		if (apiResult.success && apiResult.data) {
			const raw = apiResult.data;

			// ランタイムチェック：必須フィールドが存在するか
			if (!raw.id || !raw.identifier || !raw.order_no || !raw.status) {
				throw new Error("OpenLogi API のレスポンスに必須フィールドがありません");
			}

			// 必須フィールドだけをピックして ShipmentApiSuccessResponse 型に整形
			const shipmentResponse: ShipmentApiSuccessResponse = {
				id: raw.id,
				identifier: raw.identifier,
				order_no: raw.order_no,
				status: raw.status,
				subtotal_amount: raw.subtotal_amount,
				delivery_charge: raw.delivery_charge,
				total_amount: raw.total_amount,
				delivery_carrier: raw.delivery_carrier,
				delivery_method: raw.delivery_method,
				warehouse: raw.warehouse,
				created_at: raw.created_at,
				updated_at: raw.updated_at,
				...raw
			};

			const successResponse: ShipmentSubmissionResult = {
				success: true,
				invoiceId,
				message: "🎉 OpenLogi shipment submission successful!",
				data: {
					shipmentResponse,
					conversionMetadata: {
						invoiceId,
						shippingType: conversionMetadata.shippingType,
						currencyConversion: conversionMetadata.currencyConversion,
						itemCount: conversionMetadata.itemCount,
						processingTime: totalProcessingTime
					},
					requestDetails: apiResult.requestDetails
				},
				timestamp: new Date().toISOString()
			};

			logger.info("Shipment submission completed successfully", {
				invoiceId,
				shipmentId: shipmentResponse.id,
				totalProcessingTime
			});
			response.status(200).json(successResponse);

		} else {
			// ❌ API呼び出し失敗
			response.status(200).json({
				success: false,
				invoiceId,
				message: "❌ OpenLogi API submission failed",
				error: {
					type: "API_ERROR",
					message: apiResult.error?.message || "Unknown API error",
					details: apiResult.error?.details,
					troubleshooting: [
						"Check OpenLogi API key validity",
						"Verify product codes exist in OpenLogi",
						"Validate address format",
						"Check required parameters"
					]
				},
				timestamp: new Date().toISOString()
			} as ShipmentSubmissionResult);
		}

	} catch (error: any) {
		const totalProcessingTime = `${Date.now() - startTime}ms`;
		logger.error("Shipment submission failed", {
			invoiceId,
			error: error.message,
			stack: error.stack,
			totalProcessingTime
		});

		let errorType: 'INVOICE_ERROR' | 'CONVERSION_ERROR' | 'API_ERROR' | 'NETWORK_ERROR' | 'VALIDATION_ERROR' = 'CONVERSION_ERROR';
		const m = error.message.toLowerCase();
		if (m.includes("invoice not found")) errorType = 'INVOICE_ERROR';
		else if (m.includes("user") && m.includes("not found")) errorType = 'INVOICE_ERROR';
		else if (m.includes("address") || m.includes("recipient")) errorType = 'VALIDATION_ERROR';
		else if (m.includes("firestore")) errorType = 'INVOICE_ERROR';
		else if (m.includes("missing") && m.includes("shipping")) errorType = 'VALIDATION_ERROR';
		else if (m.includes("currency") || m.includes("conversion")) errorType = 'CONVERSION_ERROR';

		const errorResponse: ShipmentSubmissionResult = {
			success: false,
			invoiceId: invoiceId || "",
			message: "💥 Shipment submission failed",
			error: {
				type: errorType,
				message: error.message,
				details: isDebugMode() ? {
					stack: error.stack,
					totalProcessingTime
				} : undefined
			},
			timestamp: new Date().toISOString()
		};

		const statusCode = errorType === "INVOICE_ERROR" ? 404
			: errorType === "VALIDATION_ERROR" ? 400 : 500;
		response.status(statusCode).json(errorResponse);
	}
});
