// src/shared/utils/openlogiApiClient.ts
// OpenLogi API クライアント（動作実績形式ベース）

import * as logger from "firebase-functions/logger";
import { OpenLogiShipmentRequest } from '../types/openlogi';

/**
 * OpenLogi API 設定（動作実績形式）
 */
const WORKING_API_CONFIG = {
	// ✅ 動作実績のあるエンドポイント
	BASE_URL: "https://api-demo.openlogi.com",
	ENDPOINTS: {
		SHIPMENTS: "/api/shipments"
	},
	// ✅ 動作実績のあるAPIキー（テスト環境用）
	API_KEY: "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiMGE1OTRkM2Q0Y2IwYWY5NTMzNjkzNTU5NjY0M2I1NjllYTdiZjk4NjAxNDY5MDNlNTg0ODBiOTZkYmM1MTJmZDBlYWUxY2NkNGNkYmZkOWQiLCJpYXQiOjE3NDk1MTc4MzcuNzg2MDU0LCJuYmYiOjE3NDk1MTc4MzcuNzg2MDU3LCJleHAiOjE3ODEwNTM4MzcuNzU3MjkzLCJzdWIiOiJkMjVmNTUwNi1jNzNiLTQyOTQtOGQ4Ny0zYzNkZWUyYTU5N2QiLCJzY29wZXMiOltdfQ.Ge3Mqqp-r44aZYeCg3S_NbF4_UKG1xnQjlkco7cOfjPCsxnJTFWrWrvsnCuGtZHHrAkTY3SFjUOIwt_eGeSJ8D9rhS-y8j4XKQVVaEOLta-GCunQwH26Wx3pUJVZ3YMFiq0-ao0QZi9iGopOj5W9OEIzu5w0HRqWJ4C3W0IgClVLax7nYT_3Jx9RG3DjUg57gr9v1iJ1qj6J3sOMR8_TtSr4CZwkIetGzObk6ZELYS1T1_mbiGs74EwqqilmqZk_1_I4vBvdFLjaBT6EYyQ4JmDZ1ljPGTLy7c8AGXBz8Um3lpyHvv4jJw5XO0ziIHYMKb6Z6cVdHUWduPtrxsfWTib-i-jqbF0PQudSz-So4VhwvvJO1DgSkqRSq67eqVqDGcBsxn8SqQgj6Z9aarBEg-9Y2wL8Sn_I2YqSG9IqIcePq_TARSnGiaAvTPF88_FaIHjcbQZegfG3m9Zy1Zu4dBuOvW_MG4TU9kSxLByIGoNrqDylCtybz8O5WhdRd8XdHw2RwpPc_1ZB79yM-FGfo832tgHCrBZzdG2gqSJbnCe4x6aHg81mDUrzEglCBdco8REgRvvBiked6bQTx8NaU6wc38TD5LblZ7feW_V3Kq6sAbSfXW87ZRGpJ-zbCSWq43EheMh8iLTNowO9jO5vqpvyB14xh5-umGm5iQrz674",
	TIMEOUT: 30000
};

/**
 * OpenLogi 出荷依頼APIレスポンス
 */
export interface OpenLogiApiResponse {
	success: boolean;
	data?: {
		id?: string;
		identifier?: string;
		order_no?: string;
		status?: string;
		[key: string]: any;
	};
	error?: {
		type: 'API_ERROR' | 'NETWORK_ERROR' | 'AUTH_ERROR' | 'VALIDATION_ERROR' | 'TIMEOUT_ERROR';
		message: string;
		statusCode?: number;
		details?: any;
	};
	requestDetails: {
		url: string;
		method: string;
		processingTime: string;
		timestamp: string;
	};
	apiResponse?: {
		status: number;
		statusText: string;
		body: any;
		headers?: Record<string, string | null>;
	};
}

/**
 * OpenLogi 出荷依頼API呼び出し（動作実績形式）
 */
export async function submitOpenLogiShipment(
	shipmentRequest: OpenLogiShipmentRequest,
	options?: {
		testMode?: boolean;
		includeRawResponse?: boolean;
	}
): Promise<OpenLogiApiResponse> {
	const startTime = Date.now();
	const timestamp = new Date().toISOString();
	const url = WORKING_API_CONFIG.BASE_URL + WORKING_API_CONFIG.ENDPOINTS.SHIPMENTS;

	try {
		logger.info("OpenLogi shipment API request started", {
			identifier: shipmentRequest.identifier,
			order_no: shipmentRequest.order_no,
			international: shipmentRequest.international,
			itemCount: shipmentRequest.items?.length,
			url,
			testMode: options?.testMode
		});

		// ✅ 動作実績のあるヘッダー構成
		const headers = {
			'Content-Type': 'application/json',
			'X-Api-Version': '1.5',                                    // ✅ 重要：動作に必須
			'Authorization': `Bearer ${WORKING_API_CONFIG.API_KEY}`,   // ✅ 動作実績のあるAPIキー
			'User-Agent': 'GCF-OpenLogi-Shipment/1.0'
		};

		if (options?.testMode) {
			logger.info("Request payload (test mode)", {
				payload: JSON.stringify(shipmentRequest, null, 2)
			});
		}

		// API呼び出し実行
		const apiResponse = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(shipmentRequest),
			signal: AbortSignal.timeout(WORKING_API_CONFIG.TIMEOUT)
		});

		const processingTime = `${Date.now() - startTime}ms`;

		// レスポンス解析
		let responseBody: any;
		const contentType = apiResponse.headers.get('content-type') || '';

		try {
			if (contentType.includes('application/json')) {
				responseBody = await apiResponse.json();
			} else {
				responseBody = await apiResponse.text();
			}
		} catch (parseError) {
			logger.error("Response parsing error", { error: parseError });
			responseBody = "Failed to parse response";
		}

		// 成功判定
		const isSuccess = apiResponse.status >= 200 && apiResponse.status < 300;

		if (isSuccess) {
			// ✅ 成功レスポンス
			logger.info("OpenLogi shipment API success", {
				identifier: shipmentRequest.identifier,
				status: apiResponse.status,
				processingTime,
				shipmentId: responseBody?.id
			});

			return {
				success: true,
				data: responseBody,
				requestDetails: {
					url,
					method: 'POST',
					processingTime,
					timestamp
				},
				...(options?.includeRawResponse && {
					apiResponse: {
						status: apiResponse.status,
						statusText: apiResponse.statusText,
						body: responseBody,
						headers: {
							'content-type': contentType,
							'x-ratelimit-remaining': apiResponse.headers.get('x-ratelimit-remaining')
						}
					}
				})
			};

		} else {
			// ❌ エラーレスポンス
			logger.error("OpenLogi shipment API error", {
				identifier: shipmentRequest.identifier,
				status: apiResponse.status,
				statusText: apiResponse.statusText,
				responseBody,
				processingTime
			});

			// エラータイプ判定
			let errorType: 'API_ERROR' | 'NETWORK_ERROR' | 'AUTH_ERROR' | 'VALIDATION_ERROR' = 'API_ERROR';
			if (apiResponse.status === 401 || apiResponse.status === 403) {
				errorType = 'AUTH_ERROR';
			} else if (apiResponse.status === 400 || apiResponse.status === 422) {
				errorType = 'VALIDATION_ERROR';
			}

			return {
				success: false,
				error: {
					type: errorType,
					message: responseBody?.message || `HTTP ${apiResponse.status}: ${apiResponse.statusText}`,
					statusCode: apiResponse.status,
					details: responseBody
				},
				requestDetails: {
					url,
					method: 'POST',
					processingTime,
					timestamp
				},
				...(options?.includeRawResponse && {
					apiResponse: {
						status: apiResponse.status,
						statusText: apiResponse.statusText,
						body: responseBody,
						headers: {
							'content-type': contentType
						}
					}
				})
			};
		}

	} catch (error: any) {
		const processingTime = `${Date.now() - startTime}ms`;

		logger.error("OpenLogi shipment API request failed", {
			identifier: shipmentRequest?.identifier,
			error: error.message,
			processingTime
		});

		// エラータイプ判定
		let errorType: 'API_ERROR' | 'NETWORK_ERROR' | 'AUTH_ERROR' | 'VALIDATION_ERROR' | 'TIMEOUT_ERROR' = 'NETWORK_ERROR';
		if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
			errorType = 'TIMEOUT_ERROR';
		} else if (error.message.includes('fetch')) {
			errorType = 'NETWORK_ERROR';
		}

		return {
			success: false,
			error: {
				type: errorType,
				message: error.message,
				details: error.stack
			},
			requestDetails: {
				url,
				method: 'POST',
				processingTime,
				timestamp
			}
		};
	}
}

/**
 * OpenLogi APIヘルスチェック（簡易版）
 */
export async function checkOpenLogiHealth(): Promise<{
	success: boolean;
	message: string;
	details?: any;
}> {
	try {
		const healthUrl = WORKING_API_CONFIG.BASE_URL + "/api/items";

		const response = await fetch(healthUrl, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
				'X-Api-Version': '1.5',
				'Authorization': `Bearer ${WORKING_API_CONFIG.API_KEY}`
			},
			signal: AbortSignal.timeout(10000)
		});

		if (response.status === 200) {
			return {
				success: true,
				message: "OpenLogi API connection successful"
			};
		} else {
			return {
				success: false,
				message: `OpenLogi API responded with status ${response.status}`,
				details: {
					status: response.status,
					statusText: response.statusText
				}
			};
		}

	} catch (error: any) {
		return {
			success: false,
			message: `OpenLogi API health check failed: ${error.message}`
		};
	}
}