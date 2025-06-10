// src/testing/apiIntegration.ts
// OpenLogi API統合テスト関数（Demo環境対応・完全版）

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

import {
	OpenLogiShipmentRequest,
	OpenLogiError
} from "../shared/types/openlogi";
import {
	convertToOpenLogiFormat,
	generateConversionMetadata
} from "../shared/utils/openlogiConverter";
import {
	createOpenLogiShipment,
	checkOpenLogiConnection,
	OpenLogiApiResult
} from "../shared/utils/openlogiClient";
import { ERROR_MESSAGES, isDebugMode, OPENLOGI_API_CONFIG } from "../shared/config/openlogiConfig";

/**
 * API統合テストリクエスト型
 */
interface ApiIntegrationTestRequest {
	invoiceId: string;
	useRealtimeConversion?: boolean;  // true: リアルタイム変換, false: 事前データ使用
	dryRun?: boolean;                 // true: API呼び出しをスキップ
	includeDebugInfo?: boolean;
}

/**
 * API統合テストレスポンス型
 */
interface ApiIntegrationTestResponse {
	success: boolean;
	invoiceId: string;

	// 変換結果
	conversionResult?: {
		openlogiPayload: OpenLogiShipmentRequest;
		conversionMetadata: any;
	};

	// API呼び出し結果
	apiResult?: OpenLogiApiResult;

	// テスト情報
	testInfo: {
		dryRun: boolean;
		useRealtimeConversion: boolean;
		totalProcessingTime: string;
		requestId?: string;
		environment: string;
	};

	debugInfo?: any;
	timestamp: string;
}

/**
 * API統合テストエラーレスポンス型
 */
interface ApiIntegrationErrorResponse {
	success: false;
	invoiceId?: string;
	error: OpenLogiError | 'API_INTEGRATION_ERROR';
	message: string;
	details?: any;
	timestamp: string;
}

/**
 * OpenLogi API統合テスト関数（Demo環境対応）
 * Phase1の変換結果を使用してOpenLogi Demo APIに実際にリクエストを送信
 */
export const testOpenLogiAPIIntegration = onRequest({
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
				error: "API_INTEGRATION_ERROR",
				message: "Only POST method is allowed",
				timestamp: new Date().toISOString()
			} as ApiIntegrationErrorResponse);
			return;
		}

		logger.info("OpenLogi API integration test started (Demo environment)", {
			method: request.method,
			timestamp: new Date().toISOString(),
			userAgent: request.get("User-Agent"),
			apiBaseUrl: OPENLOGI_API_CONFIG.BASE_URL,
			apiVersion: OPENLOGI_API_CONFIG.API_VERSION
		});

		// リクエストパラメータ取得
		const {
			invoiceId: reqInvoiceId,
			useRealtimeConversion = true,
			dryRun = false,
			includeDebugInfo = false
		}: ApiIntegrationTestRequest = request.body;

		invoiceId = reqInvoiceId;

		// 入力バリデーション
		if (!invoiceId || typeof invoiceId !== 'string') {
			const errorResponse: ApiIntegrationErrorResponse = {
				success: false,
				error: "INVALID_INPUT" as OpenLogiError,
				message: "invoiceId is required and must be string",
				timestamp: new Date().toISOString()
			};
			response.status(400).json(errorResponse);
			return;
		}

		logger.info("Processing API integration test", {
			invoiceId,
			useRealtimeConversion,
			dryRun,
			includeDebugInfo,
			environment: "Demo"
		});

		let openlogiPayload: OpenLogiShipmentRequest;
		let conversionMetadata: any;

		if (useRealtimeConversion) {
			// リアルタイム変換
			logger.info("Using realtime conversion", { invoiceId });

			// Invoice データ取得
			const invoiceDoc = await admin.firestore()
				.collection('invoices')
				.doc(invoiceId)
				.get();

			if (!invoiceDoc.exists) {
				throw new Error(ERROR_MESSAGES.INVOICE_NOT_FOUND);
			}

			const invoiceData = invoiceDoc.data();

			// User データ取得
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

			// デフォルト住所特定
			const userAddresses = userData?.address || [];
			const defaultAddress = userAddresses.find((addr: any) => addr.isDefault);

			if (!defaultAddress) {
				throw new Error(`Default address not found for user: ${invoiceData.userId}`);
			}

			// OpenLogi 形式に変換
			openlogiPayload = convertToOpenLogiFormat(invoiceData, defaultAddress);
			conversionMetadata = generateConversionMetadata(invoiceData, defaultAddress, startTime);

			logger.info("Realtime conversion completed", {
				invoiceId,
				shippingType: conversionMetadata.shippingType,
				itemCount: conversionMetadata.itemCount,
				totalAmountJPY: openlogiPayload.total_amount
			});

		} else {
			// 事前変換データを使用する場合（将来的にテストコレクションから取得）
			throw new Error("Pre-converted data usage not implemented yet. Use useRealtimeConversion: true");
		}

		// Dry Run チェック
		let apiResult: OpenLogiApiResult | undefined;

		if (dryRun) {
			logger.info("Dry run mode - skipping actual API call", { invoiceId });

			// Dry runの場合は模擬レスポンス
			apiResult = {
				success: true,
				data: {
					id: `DRYRUN_${Date.now()}`,
					identifier: openlogiPayload.identifier,
					order_no: openlogiPayload.order_no,
					status: "waiting"
				},
				requestId: `dryrun_${Date.now()}`,
				processingTime: "0ms"
			};

		} else {
			logger.info("Making actual OpenLogi Demo API call", {
				invoiceId,
				endpoint: OPENLOGI_API_CONFIG.BASE_URL + OPENLOGI_API_CONFIG.ENDPOINTS.SHIPMENTS
			});

			// 実際のAPI呼び出し
			apiResult = await createOpenLogiShipment(openlogiPayload);
		}

		const totalProcessingTime = Date.now() - startTime;

		if (apiResult.success) {
			logger.info("API integration test completed successfully", {
				invoiceId,
				dryRun,
				shipmentId: apiResult.data?.id,
				totalProcessingTime: `${totalProcessingTime}ms`,
				apiProcessingTime: apiResult.processingTime,
				environment: "Demo"
			});

			const successResponse: ApiIntegrationTestResponse = {
				success: true,
				invoiceId,
				conversionResult: {
					openlogiPayload,
					conversionMetadata
				},
				apiResult,
				testInfo: {
					dryRun,
					useRealtimeConversion,
					totalProcessingTime: `${totalProcessingTime}ms`,
					requestId: apiResult.requestId,
					environment: "Demo"
				},
				debugInfo: includeDebugInfo ? {
					debugMode: isDebugMode(),
					environment: "Demo",
					apiEndpoint: OPENLOGI_API_CONFIG.BASE_URL + OPENLOGI_API_CONFIG.ENDPOINTS.SHIPMENTS,
					apiVersion: OPENLOGI_API_CONFIG.API_VERSION
				} : undefined,
				timestamp: new Date().toISOString()
			};

			response.status(200).json(successResponse);

		} else {
			// API呼び出し失敗
			logger.error("OpenLogi Demo API call failed", {
				invoiceId,
				apiError: apiResult.error,
				totalProcessingTime: `${totalProcessingTime}ms`,
				environment: "Demo"
			});

			const apiErrorResponse: ApiIntegrationTestResponse = {
				success: false,
				invoiceId,
				conversionResult: {
					openlogiPayload,
					conversionMetadata
				},
				apiResult,
				testInfo: {
					dryRun,
					useRealtimeConversion,
					totalProcessingTime: `${totalProcessingTime}ms`,
					requestId: apiResult.requestId,
					environment: "Demo"
				},
				debugInfo: includeDebugInfo ? {
					debugMode: isDebugMode(),
					apiError: apiResult.error,
					environment: "Demo",
					apiEndpoint: OPENLOGI_API_CONFIG.BASE_URL + OPENLOGI_API_CONFIG.ENDPOINTS.SHIPMENTS
				} : undefined,
				timestamp: new Date().toISOString()
			};

			// API エラーの種類に応じてHTTPステータスコード決定
			const statusCode = apiResult.error?.type === 'AUTH_ERROR' ? 401 :
				apiResult.error?.type === 'VALIDATION_ERROR' ? 400 : 500;

			response.status(statusCode).json(apiErrorResponse);
		}

	} catch (error: any) {
		const totalProcessingTime = Date.now() - startTime;

		logger.error("API integration test failed", {
			invoiceId,
			error: error.message,
			stack: error.stack,
			totalProcessingTime: `${totalProcessingTime}ms`,
			environment: "Demo"
		});

		// エラーの種類を判定
		let errorType: OpenLogiError | 'API_INTEGRATION_ERROR' = "API_INTEGRATION_ERROR";
		const errorMessage = error.message.toLowerCase();

		if (errorMessage.includes("invoice not found")) {
			errorType = "INVOICE_NOT_FOUND";
		} else if (errorMessage.includes("user") && errorMessage.includes("not found")) {
			errorType = "USER_NOT_FOUND";
		} else if (errorMessage.includes("address") || errorMessage.includes("recipient")) {
			errorType = "ADDRESS_INVALID";
		} else if (errorMessage.includes("conversion")) {
			errorType = "CONVERSION_FAILED";
		} else if (errorMessage.includes("firestore")) {
			errorType = "FIRESTORE_ERROR";
		}

		const errorResponse: ApiIntegrationErrorResponse = {
			success: false,
			invoiceId,
			error: errorType,
			message: error.message,
			details: isDebugMode() ? {
				stack: error.stack,
				totalProcessingTime: `${totalProcessingTime}ms`,
				environment: "Demo"
			} : undefined,
			timestamp: new Date().toISOString()
		};

		// ステータスコード判定
		let statusCode = 500;
		if (errorType === "INVOICE_NOT_FOUND" || errorType === "USER_NOT_FOUND") {
			statusCode = 404;
		} else if (errorType === "ADDRESS_INVALID") {
			statusCode = 400;
		}

		response.status(statusCode).json(errorResponse);
	}
});

/**
 * OpenLogi API接続テスト関数（Demo環境対応）
 */
export const testOpenLogiConnection = onRequest({
	region: "asia-northeast1",
	memory: "256MiB",
	timeoutSeconds: 30,
	cors: true,
}, async (request, response) => {
	try {
		logger.info("OpenLogi connection test started (Demo environment)", {
			apiBaseUrl: OPENLOGI_API_CONFIG.BASE_URL,
			apiVersion: OPENLOGI_API_CONFIG.API_VERSION
		});

		const connectionResult = await checkOpenLogiConnection();

		const responseData = {
			success: connectionResult.success,
			message: connectionResult.message,
			details: {
				...connectionResult.details,
				environment: "Demo",
				apiEndpoint: OPENLOGI_API_CONFIG.BASE_URL,
				apiVersion: OPENLOGI_API_CONFIG.API_VERSION
			},
			timestamp: new Date().toISOString()
		};

		response.status(connectionResult.success ? 200 : 500).json(responseData);

	} catch (error: any) {
		logger.error("Connection test failed", {
			error: error.message,
			environment: "Demo"
		});

		response.status(500).json({
			success: false,
			message: `Connection test failed: ${error.message}`,
			environment: "Demo",
			timestamp: new Date().toISOString()
		});
	}
});