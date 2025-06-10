// src/shared/utils/openlogiClient.ts
// OpenLogi API クライアント

import * as logger from "firebase-functions/logger";
import { defineString } from "firebase-functions/params";
import { OpenLogiShipmentRequest, OpenLogiResponse } from '../types/openlogi';
import { OPENLOGI_API_CONFIG } from '../config/openlogiConfig';

// 環境変数定義
const openlogiApiKey = defineString("OPENLOGI_API_KEY", {
	description: "OpenLogi API Key for shipment creation",
	default: "",
});

/**
 * OpenLogi API エラーレスポンス型
 */
interface OpenLogiErrorResponse {
	error?: string;
	message?: string;
	details?: any;
	code?: string;
}

/**
 * API呼び出し結果型
 */
export interface OpenLogiApiResult {
	success: boolean;
	data?: OpenLogiResponse;
	error?: {
		type: 'API_ERROR' | 'NETWORK_ERROR' | 'AUTH_ERROR' | 'VALIDATION_ERROR';
		message: string;
		statusCode?: number;
		details?: any;
	};
	requestId?: string;
	processingTime: string;
}

/**
 * OpenLogi API 出荷依頼作成
 */
export async function createOpenLogiShipment(
	shipmentRequest: OpenLogiShipmentRequest
): Promise<OpenLogiApiResult> {
	const startTime = Date.now();
	const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

	try {
		// API Key 取得
		const apiKey = openlogiApiKey.value();
		if (!apiKey) {
			throw new Error("OpenLogi API key not configured");
		}

		logger.info("OpenLogi API request started", {
			requestId,
			endpoint: OPENLOGI_API_CONFIG.BASE_URL + OPENLOGI_API_CONFIG.ENDPOINTS.SHIPMENTS,
			identifier: shipmentRequest.identifier,
			international: shipmentRequest.international
		});

		// API リクエスト準備
		const url = OPENLOGI_API_CONFIG.BASE_URL + OPENLOGI_API_CONFIG.ENDPOINTS.SHIPMENTS;
		const headers = {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${apiKey}`,
			'User-Agent': 'BTCFlavor-GCF/1.0',
			'X-Request-ID': requestId
		};

		// HTTPリクエスト送信
		const response = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(shipmentRequest),
			signal: AbortSignal.timeout(OPENLOGI_API_CONFIG.TIMEOUT)
		});

		const processingTime = `${Date.now() - startTime}ms`;

		// レスポンス処理
		if (!response.ok) {
			// エラーレスポンスの解析
			let errorData: OpenLogiErrorResponse = {};
			try {
				errorData = await response.json();
			} catch (parseError) {
				errorData = { message: 'Failed to parse error response' };
			}

			logger.error("OpenLogi API error response", {
				requestId,
				statusCode: response.status,
				statusText: response.statusText,
				errorData,
				processingTime
			});

			// エラータイプ判定
			let errorType: 'API_ERROR' | 'NETWORK_ERROR' | 'AUTH_ERROR' | 'VALIDATION_ERROR' = 'API_ERROR';
			if (response.status === 401 || response.status === 403) {
				errorType = 'AUTH_ERROR';
			} else if (response.status === 400 || response.status === 422) {
				errorType = 'VALIDATION_ERROR';
			}

			return {
				success: false,
				error: {
					type: errorType,
					message: errorData.message || `HTTP ${response.status}: ${response.statusText}`,
					statusCode: response.status,
					details: errorData
				},
				requestId,
				processingTime
			};
		}

		// 成功レスポンスの解析
		const responseData: OpenLogiResponse = await response.json();

		logger.info("OpenLogi API success response", {
			requestId,
			shipmentId: responseData.id,
			identifier: responseData.identifier,
			status: responseData.status,
			processingTime
		});

		return {
			success: true,
			data: responseData,
			requestId,
			processingTime
		};

	} catch (error: any) {
		const processingTime = `${Date.now() - startTime}ms`;

		logger.error("OpenLogi API request failed", {
			requestId,
			error: error.message,
			stack: error.stack,
			processingTime
		});

		// エラータイプ判定
		let errorType: 'API_ERROR' | 'NETWORK_ERROR' | 'AUTH_ERROR' | 'VALIDATION_ERROR' = 'NETWORK_ERROR';
		if (error.message.includes('timeout') || error.message.includes('signal')) {
			errorType = 'NETWORK_ERROR';
		} else if (error.message.includes('API key')) {
			errorType = 'AUTH_ERROR';
		}

		return {
			success: false,
			error: {
				type: errorType,
				message: error.message,
				details: error.stack
			},
			requestId,
			processingTime
		};
	}
}



/**
 * OpenLogi API接続テスト（実在エンドポイント使用）
 */
export async function checkOpenLogiConnection(): Promise<{
	success: boolean;
	message: string;
	details?: any;
}> {
	try {
		const apiKey = openlogiApiKey.value();
		if (!apiKey) {
			return {
				success: false,
				message: "API key not configured - Please set OPENLOGI_API_KEY"
			};
		}

		logger.info("Testing OpenLogi connection with real endpoint", {
			apiKeyPresent: !!apiKey,
			apiKeyLength: apiKey.length,
			baseUrl: OPENLOGI_API_CONFIG.BASE_URL,
			apiVersion: OPENLOGI_API_CONFIG.API_VERSION
		});

		// 実在するエンドポイントで接続テスト: 商品一覧API
		const url = OPENLOGI_API_CONFIG.BASE_URL + "/items";

		const response = await fetch(url, {
			method: 'GET',  // 商品一覧取得
			headers: {
				'Content-Type': 'application/json',
				'X-Api-Version': OPENLOGI_API_CONFIG.API_VERSION,  // 必須ヘッダー
				'Authorization': `Bearer ${apiKey}`,               // 必須ヘッダー
				'User-Agent': 'BTCFlavor-GCF/1.0'
			},
			signal: AbortSignal.timeout(15000)
		});

		logger.info("OpenLogi API response received", {
			status: response.status,
			statusText: response.statusText,
			url: url,
			headers: {
				'X-Api-Version': OPENLOGI_API_CONFIG.API_VERSION,
				'Authorization': `Bearer ${apiKey.substring(0, 10)}...`
			}
		});

		// ステータスコード分析（OpenLogiドキュメント準拠）
		if (response.status === 200) {
			return {
				success: true,
				message: "Connection successful - API key is valid",
				details: {
					status: response.status,
					statusText: response.statusText,
					environment: "Demo",
					endpoint: "/items",
					note: "商品一覧API接続成功"
				}
			};
		} else if (response.status === 401) {
			return {
				success: false,
				message: "Authentication failed - Invalid API key",
				details: {
					status: response.status,
					statusText: response.statusText,
					error: "unauthorized",
					suggestion: "Check your API key in Demo environment: https://app-demo.openlogi.com/portal/tokens"
				}
			};
		} else if (response.status === 402) {
			return {
				success: false,
				message: "Payment required - Please register payment method",
				details: {
					status: response.status,
					statusText: response.statusText,
					error: "payment_required"
				}
			};
		} else if (response.status === 403) {
			return {
				success: false,
				message: "Forbidden - API token permissions insufficient",
				details: {
					status: response.status,
					statusText: response.statusText,
					error: "forbidden"
				}
			};
		} else if (response.status === 404) {
			return {
				success: false,
				message: "Endpoint not found - Check API endpoint configuration",
				details: {
					status: response.status,
					statusText: response.statusText,
					error: "not_found",
					requestedUrl: url,
					suggestion: "Verify correct API endpoint and version"
				}
			};
		} else if (response.status === 429) {
			return {
				success: false,
				message: "Rate limit exceeded - Too many requests",
				details: {
					status: response.status,
					statusText: response.statusText,
					error: "Too Many Attempts."
				}
			};
		} else {
			return {
				success: false,
				message: `Unexpected response: ${response.status}`,
				details: {
					status: response.status,
					statusText: response.statusText,
					requestedUrl: url
				}
			};
		}

	} catch (error: any) {
		logger.error("Connection test error", {
			error: error.message,
			stack: error.stack
		});

		return {
			success: false,
			message: `Connection test failed: ${error.message}`,
			details: {
				error: error.message,
				suggestion: "Check network connectivity and API endpoint"
			}
		};
	}
}