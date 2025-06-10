-e 
### FILE: ./src/services/firestoreService.ts

import {getFirestore, Timestamp} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {CoinGeckoPrice, CryptoPriceData, CryptoMetadata} from "../types";

/**
 * Firestore service for managing crypto price data
 */
export class FirestoreService {
  private readonly db = getFirestore();

  /**
   * Save cryptocurrency price data to Firestore
   * @param {CoinGeckoPrice[]} prices - Array of price data to save
   * @return {Promise<void>}
   */
  async saveCryptoPrices(prices: CoinGeckoPrice[]): Promise<void> {
    const batch = this.db.batch();

    try {
      for (const price of prices) {
        const priceData: CryptoPriceData = {
          id: price.id,
          symbol: price.symbol.toUpperCase(),
          name: price.name,
          price_usd: price.current_price,
          price_change_24h: price.price_change_24h || 0,
          price_change_percentage_24h: price.price_change_percentage_24h || 0,
          market_cap_usd: price.market_cap || 0,
          volume_24h_usd: price.total_volume || 0,
          last_updated: Timestamp.now(),
          source: "coingecko",
        };

        const docRef = this.db
          .collection("crypto_prices")
          .doc(price.symbol.toUpperCase());

        batch.set(docRef, priceData);

        logger.info("Prepared price data for batch", {
          symbol: priceData.symbol,
          price: priceData.price_usd,
        });
      }

      await batch.commit();

      logger.info("Successfully saved crypto prices to Firestore", {
        count: prices.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error("Failed to save crypto prices to Firestore", {
        error: errorMessage,
        stack: errorStack,
      });
      throw error;
    }
  }

  /**
   * Update metadata document with sync status and additional info
   * @param {string} status - Current sync status
   * @param {object} options - Additional metadata options
   * @return {Promise<void>}
   */
  async updateMetadata(
    status: "success" | "error" | "in_progress",
    options: {
      errorMessage?: string;
      rateLimitRemaining?: number;
      totalApiCalls?: number;
    } = {}
  ): Promise<void> {
    try {
      const metadata: Partial<CryptoMetadata> = {
        last_sync_timestamp: Timestamp.now(),
        sync_status: status,
        update_frequency_minutes: 5,
        supported_currencies: ["BTC", "ETH", "SOL", "AVAX", "SUI"],
      };

      if (options.errorMessage) {
        metadata.error_message = options.errorMessage;
      }

      if (options.rateLimitRemaining !== undefined) {
        metadata.coingecko_rate_limit_remaining = options.rateLimitRemaining;
      }

      if (options.totalApiCalls !== undefined) {
        metadata.total_api_calls_today = options.totalApiCalls;

        // Usage alert for Demo API
        if (options.totalApiCalls > 8000) {
          logger.warn("CoinGecko API usage approaching limit", {
            totalCalls: options.totalApiCalls,
            limit: 10000,
            usagePercentage: (options.totalApiCalls / 10000) * 100,
          });
        }
      }

      await this.db
        .collection("crypto_metadata")
        .doc("config")
        .set(metadata, {merge: true});

      logger.info("Updated metadata", {
        status,
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to update metadata", {
        error: errorMessage,
      });
      // Metadata update failure is not critical, so don't throw
    }
  }

  /**
   * Get the last synchronization timestamp
   * @return {Promise<Date | null>} Last sync time or null if not found
   */
  async getLastSyncTime(): Promise<Date | null> {
    try {
      const doc = await this.db
        .collection("crypto_metadata")
        .doc("config")
        .get();

      if (doc.exists) {
        const data = doc.data() as CryptoMetadata;
        return data.last_sync_timestamp?.toDate() || null;
      }

      return null;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.warn("Could not get last sync time", {error: errorMessage});
      return null;
    }
  }

  /**
   * Clean up old or unwanted crypto price documents
   * @param {string[]} validSymbols - Array of valid currency symbols to keep
   * @return {Promise<void>}
   */
  async cleanupOldPrices(validSymbols: string[]): Promise<void> {
    try {
      const snapshot = await this.db.collection("crypto_prices").get();
      const batch = this.db.batch();
      let deleteCount = 0;

      snapshot.forEach((doc) => {
        if (!validSymbols.includes(doc.id)) {
          batch.delete(doc.ref);
          deleteCount++;
          logger.info("Scheduled for deletion", {symbol: doc.id});
        }
      });

      if (deleteCount > 0) {
        await batch.commit();
        logger.info("Cleaned up old price documents", {deletedCount: deleteCount});
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.warn("Failed to cleanup old prices", {error: errorMessage});
    }
  }
}-e 
### FILE: ./src/services/coinGeckoService.ts

import axios, {AxiosResponse} from "axios";
import * as logger from "firebase-functions/logger";
import {CoinGeckoPrice} from "../types";

export class CoinGeckoService {
  private readonly baseUrl = "https://api.coingecko.com/api/v3";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * 複数の暗号通貨の価格データを取得
   */
  async getCryptoPrices(ids: string[]): Promise<CoinGeckoPrice[]> {
    try {
      const idsString = ids.join(",");
      const url = `${this.baseUrl}/coins/markets`;

      const params = {
        ids: idsString,
        vs_currency: "usd",
        order: "market_cap_desc",
        per_page: ids.length,
        page: 1,
        sparkline: false,
        price_change_percentage: "24h",
        precision: "full",
      };

      // API Key が 'demo' でない場合のみヘッダーに追加
      const headers: any = {
        "Accept": "application/json",
        "User-Agent": "we-are-onchain-gcf/1.0.0",
      };

      if (this.apiKey && this.apiKey !== "demo") {
        headers["x-cg-demo-api-key"] = this.apiKey;
      }

      logger.info("Fetching crypto prices", {
        url,
        params,
        idsCount: ids.length,
      });

      const response: AxiosResponse<CoinGeckoPrice[]> = await axios.get(url, {
        params,
        headers,
        timeout: 30000, // 30秒タイムアウト
      });

      logger.info("CoinGecko API response received", {
        statusCode: response.status,
        dataLength: response.data.length,
        rateLimitRemaining: response.headers["x-ratelimit-remaining"],
      });

      return response.data;
    } catch (error: any) {
      logger.error("CoinGecko API error", {
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      });

      throw new Error(`CoinGecko API failed: ${error.message}`);
    }
  }

  /**
   * APIの使用状況を確認
   */
  async checkApiUsage(): Promise<{
    remaining: number;
    limit: number;
    resetTime?: number;
  }> {
    try {
      const response = await axios.get(`${this.baseUrl}/ping`, {
        headers: this.apiKey !== "demo" ? {
          "x-cg-demo-api-key": this.apiKey,
        } : {},
      });

      return {
        remaining: parseInt(response.headers["x-ratelimit-remaining"] || "30"),
        limit: parseInt(response.headers["x-ratelimit-limit"] || "30"),
        resetTime: parseInt(response.headers["x-ratelimit-reset"]),
      };
    } catch (error: any) {
      logger.warn("Could not check API usage", {error: error.message});
      return {remaining: 30, limit: 30}; // デフォルト値
    }
  }
}
-e 
### FILE: ./src/crypto/priceUpdater.ts

import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { defineString } from "firebase-functions/params";
import { CoinGeckoService } from "../services/coinGeckoService";
import { FirestoreService } from "../services/firestoreService";
import { CRYPTO_CONFIG, API_CONFIG } from "../config/cryptoConfig";

// 環境変数定義
const coinGeckoApiKey = defineString("COINGECKO_API_KEY", {
  description: "CoinGecko API Key",
  default: "demo",
});

/**
 * 5分間隔で暗号通貨価格を更新するScheduled Function
 */
export const updateCryptoPrices = onSchedule({
  schedule: "*/5 * * * *", // 5分間隔
  timeZone: "UTC",
  region: "asia-northeast1",
  memory: "256MiB",
  timeoutSeconds: 300,
  maxInstances: 1,
}, async (event) => {
  const startTime = Date.now();
  const firestoreService = new FirestoreService();

  try {
    logger.info("Starting scheduled crypto price update", {
      timestamp: new Date().toISOString(),
      jobName: event.jobName,
      scheduleTime: event.scheduleTime,
      currencies: CRYPTO_CONFIG.currencies.map((c) => c.symbol),
    });

    // 進行中ステータスに更新
    await firestoreService.updateMetadata("in_progress");

    // CoinGecko API サービス初期化
    const coinGeckoService = new CoinGeckoService(coinGeckoApiKey.value());

    // API使用状況確認
    const apiUsage = await coinGeckoService.checkApiUsage();
    logger.info("CoinGecko API usage status", {
      remaining: apiUsage.remaining,
      limit: apiUsage.limit,
    });

    // レート制限チェック
    if (apiUsage.remaining < API_CONFIG.RATE_LIMIT_BUFFER) {
      logger.warn("API rate limit approaching, skipping this update", {
        remaining: apiUsage.remaining,
        buffer: API_CONFIG.RATE_LIMIT_BUFFER,
      });

      await firestoreService.updateMetadata("error", {
        errorMessage: `Rate limit approaching: ${apiUsage.remaining} calls remaining`,
        rateLimitRemaining: apiUsage.remaining,
      });

      return;
    }

    // 価格データ取得
    const coinIds = CRYPTO_CONFIG.currencies.map((c) => c.id);
    const prices = await coinGeckoService.getCryptoPrices(coinIds);

    if (prices.length === 0) {
      throw new Error("No price data received from CoinGecko API");
    }

    // Firestoreに保存
    await firestoreService.saveCryptoPrices(prices);

    // 成功ステータスに更新
    await firestoreService.updateMetadata("success", {
      rateLimitRemaining: apiUsage.remaining - 1, // APIコールを1回使用
    });

    const duration = Date.now() - startTime;
    logger.info("Crypto price update completed successfully", {
      duration: `${duration}ms`,
      pricesUpdated: prices.length,
      currencies: prices.map((p) => ({
        symbol: p.symbol.toUpperCase(),
        price: p.current_price,
      })),
    });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error("Crypto price update failed", {
      error: error.message,
      stack: error.stack,
      duration: `${duration}ms`,
    });

    // エラーステータスに更新
    await firestoreService.updateMetadata("error", {
      errorMessage: error.message,
    });

    // 関数自体は失敗させない（無限リトライを避けるため）
    // throw error;
  }
});-e 
### FILE: ./src/config/cryptoConfig.ts

import {CryptoConfig} from "../types";

export const CRYPTO_CONFIG: CryptoConfig = {
  currencies: [
    {
      id: "bitcoin",
      symbol: "BTC",
      name: "Bitcoin",
    },
    {
      id: "ethereum",
      symbol: "ETH",
      name: "Ethereum",
    },
    {
      id: "solana",
      symbol: "SOL",
      name: "Solana",
    },
    {
      id: "avalanche",
      symbol: "AVAX",
      name: "Avalanche",
    },
    {
      id: "sui",
      symbol: "SUI",
      name: "Sui",
    },
  ],
};

export const API_CONFIG = {
  UPDATE_INTERVAL_MINUTES: 5,
  TIMEOUT_SECONDS: 30,
  MAX_RETRIES: 2,
  RATE_LIMIT_BUFFER: 5,
  DEMO_API_MONTHLY_LIMIT: 10000,
  DEMO_API_RATE_LIMIT_PER_MINUTE: 30,
  MONTHLY_USAGE_ALERT_THRESHOLD: 8000,
  EMERGENCY_FALLBACK_INTERVAL: 30,
};-e 
### FILE: ./src/testing/dataConverter.ts

// src/testing/dataConverter.ts
// OpenLogi データ変換テスト関数（シンプル版）

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

import { 
  ConversionTestRequest,
  ConversionTestResponse,
  ConversionErrorResponse,
  OpenLogiError
} from "../shared/types/openlogi";
import { 
  convertToOpenLogiFormat,
  generateConversionMetadata
} from "../shared/utils/openlogiConverter";
import { ERROR_MESSAGES, isDebugMode } from "../shared/config/openlogiConfig";

/**
 * OpenLogi データ変換テスト関数（シンプル版）
 * Firestoreからデータを取得してOpenLogi形式に変換し、curlレスポンスで結果を返す
 */
export const testOpenLogiDataConversion = onRequest({
  region: "asia-northeast1",
  memory: "512MiB",
  timeoutSeconds: 60,
  cors: true,
}, async (request, response) => {
  const startTime = Date.now();
  let invoiceId: string | undefined;

  try {
    // POSTメソッドのみ受け付け
    if (request.method !== "POST") {
      response.status(405).json({
        success: false,
        error: "INVALID_INPUT" as OpenLogiError,
        message: "Only POST method is allowed",
        timestamp: new Date().toISOString()
      } as ConversionErrorResponse);
      return;
    }

    logger.info("OpenLogi conversion test started", {
      method: request.method,
      timestamp: new Date().toISOString(),
      userAgent: request.get("User-Agent"),
      contentType: request.get("Content-Type"),
    });

    // リクエストパラメータ取得
    const {
      invoiceId: reqInvoiceId,
      validateOnly = false,
      includeDebugInfo = false
    }: ConversionTestRequest = request.body;

    invoiceId = reqInvoiceId;

    // 入力バリデーション
    if (!invoiceId || typeof invoiceId !== 'string') {
      const errorResponse: ConversionErrorResponse = {
        success: false,
        error: "INVALID_INPUT",
        message: "invoiceId is required and must be string",
        timestamp: new Date().toISOString()
      };
      response.status(400).json(errorResponse);
      return;
    }

    logger.info("Processing conversion test", {
      invoiceId,
      validateOnly,
      includeDebugInfo
    });

    // 1. Invoice データ取得
    const invoiceDoc = await admin.firestore()
      .collection('invoices')
      .doc(invoiceId)
      .get();

    if (!invoiceDoc.exists) {
      throw new Error(ERROR_MESSAGES.INVOICE_NOT_FOUND);
    }

    const invoiceData = invoiceDoc.data();
    logger.info("Invoice data retrieved", {
      invoiceId,
      userId: invoiceData?.userId,
      status: invoiceData?.status,
      amount_usd: invoiceData?.amount_usd
    });

    // 2. User データ取得
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

    // 3. デフォルト住所特定
    const userAddresses = userData?.address || [];
    const defaultAddress = userAddresses.find((addr: any) => addr.isDefault);

    if (!defaultAddress) {
      throw new Error(`Default address not found for user: ${invoiceData.userId}`);
    }

    logger.info("User address data retrieved", {
      invoiceId,
      userId: invoiceData.userId,
      addressCount: userAddresses.length,
      hasDefaultAddress: !!defaultAddress,
      isInternational: defaultAddress.shippingRequest?.international
    });

    // 4. 変換メタデータ生成
    const conversionMetadata = generateConversionMetadata(invoiceData, defaultAddress, startTime);

    // バリデーションのみの場合はここで終了
    if (validateOnly) {
      const validationResponse: ConversionTestResponse = {
        success: true,
        invoiceId,
        conversionResult: {
          openlogiPayload: {} as any, // バリデーションのみなので空
          sourceData: includeDebugInfo ? {
            invoice: invoiceData,
            userAddress: defaultAddress
          } : undefined,
          conversionMetadata
        },
        debugInfo: includeDebugInfo ? {
          validationOnly: true,
          debugMode: isDebugMode(),
          environment: process.env.NODE_ENV || 'unknown'
        } : undefined,
        timestamp: new Date().toISOString()
      };
      
      logger.info("Validation completed successfully", {
        invoiceId,
        shippingType: conversionMetadata.shippingType,
        processingTime: conversionMetadata.processingTime
      });
      
      response.status(200).json(validationResponse);
      return;
    }

    // 5. OpenLogi 形式に変換
    const openlogiPayload = convertToOpenLogiFormat(invoiceData, defaultAddress);

    logger.info("Conversion completed successfully", {
      invoiceId,
      shippingType: conversionMetadata.shippingType,
      itemCount: conversionMetadata.itemCount,
      totalAmountJPY: openlogiPayload.total_amount,
      processingTime: conversionMetadata.processingTime
    });

    // 6. 成功レスポンス生成
    const successResponse: ConversionTestResponse = {
      success: true,
      invoiceId,
      conversionResult: {
        openlogiPayload,
        sourceData: includeDebugInfo ? {
          invoice: {
            id: invoiceData.id,
            sessionId: invoiceData.sessionId,
            userId: invoiceData.userId,
            amount_usd: invoiceData.amount_usd,
            cartSnapshot: invoiceData.cartSnapshot,
            status: invoiceData.status
          },
          userAddress: {
            id: defaultAddress.id,
            shippingFee: defaultAddress.shippingFee,
            shippingRegion: defaultAddress.shippingRegion,
            displayName: defaultAddress.displayName,
            isDefault: defaultAddress.isDefault,
            shippingRequest: defaultAddress.shippingRequest
          }
        } : undefined,
        conversionMetadata
      },
      debugInfo: includeDebugInfo ? {
        debugMode: isDebugMode(),
        environment: process.env.NODE_ENV || 'unknown',
        functionRegion: "asia-northeast1"
      } : undefined,
      timestamp: new Date().toISOString()
    };

    const totalProcessingTime = Date.now() - startTime;
    logger.info("Conversion test completed successfully", {
      invoiceId,
      totalProcessingTime: `${totalProcessingTime}ms`
    });

    response.status(200).json(successResponse);

  } catch (error: any) {
    const totalProcessingTime = Date.now() - startTime;
    
    logger.error("Conversion test failed", {
      invoiceId,
      error: error.message,
      stack: error.stack,
      totalProcessingTime: `${totalProcessingTime}ms`
    });

    // エラーの種類を判定
    let errorType: OpenLogiError = "CONVERSION_FAILED";
    const errorMessage = error.message.toLowerCase();
    
    if (errorMessage.includes("invoice not found")) {
      errorType = "INVOICE_NOT_FOUND";
    } else if (errorMessage.includes("user") && errorMessage.includes("not found")) {
      errorType = "USER_NOT_FOUND";
    } else if (errorMessage.includes("address") || errorMessage.includes("recipient")) {
      errorType = "ADDRESS_INVALID";
    } else if (errorMessage.includes("firestore")) {
      errorType = "FIRESTORE_ERROR";
    } else if (errorMessage.includes("missing") && errorMessage.includes("shipping")) {
      errorType = "MISSING_SHIPPING_REQUEST";
    } else if (errorMessage.includes("currency") || errorMessage.includes("conversion")) {
      errorType = "CURRENCY_CONVERSION_ERROR";
    }

    const errorResponse: ConversionErrorResponse = {
      success: false,
      invoiceId,
      error: errorType,
      message: error.message,
      details: isDebugMode() ? {
        stack: error.stack,
        totalProcessingTime: `${totalProcessingTime}ms`
      } : undefined,
      timestamp: new Date().toISOString()
    };

    // ステータスコード判定を修正
    let statusCode = 500; // デフォルト
    if (errorType === "INVOICE_NOT_FOUND" || errorType === "USER_NOT_FOUND") {
      statusCode = 404;
    } else if (errorType === "ADDRESS_INVALID" || errorType === "MISSING_SHIPPING_REQUEST") {
      statusCode = 400;
    }
                      
    response.status(statusCode).json(errorResponse);
  }
});-e 
### FILE: ./src/testing/simpleConnectionTest.ts

// src/testing/simpleConnectionTest.ts
// 商品ID指定版OpenLogi接続テスト

import { onRequest } from "firebase-functions/v2/https";

/**
 * 商品ID指定版OpenLogi接続テスト
 */
export const simpleOpenLogiTest = onRequest({
	region: "asia-northeast1",
	memory: "256MiB",
	timeoutSeconds: 30,
	cors: true,
}, async (request, response) => {

	try {
		// 🔑 APIキー（実際のキーに置き換えてください）
		const API_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiMGE1OTRkM2Q0Y2IwYWY5NTMzNjkzNTU5NjY0M2I1NjllYTdiZjk4NjAxNDY5MDNlNTg0ODBiOTZkYmM1MTJmZDBlYWUxY2NkNGNkYmZkOWQiLCJpYXQiOjE3NDk1MTc4MzcuNzg2MDU0LCJuYmYiOjE3NDk1MTc4MzcuNzg2MDU3LCJleHAiOjE3ODEwNTM4MzcuNzU3MjkzLCJzdWIiOiJkMjVmNTUwNi1jNzNiLTQyOTQtOGQ4Ny0zYzNkZWUyYTU5N2QiLCJzY29wZXMiOltdfQ.Ge3Mqqp-r44aZYeCg3S_NbF4_UKG1xnQjlkco7cOfjPCsxnJTFWrWrvsnCuGtZHHrAkTY3SFjUOIwt_eGeSJ8D9rhS-y8j4XKQVVaEOLta-GCunQwH26Wx3pUJVZ3YMFiq0-ao0QZi9iGopOj5W9OEIzu5w0HRqWJ4C3W0IgClVLax7nYT_3Jx9RG3DjUg57gr9v1iJ1qj6J3sOMR8_TtSr4CZwkIetGzObk6ZELYS1T1_mbiGs74EwqqilmqZk_1_I4vBvdFLjaBT6EYyQ4JmDZ1ljPGTLy7c8AGXBz8Um3lpyHvv4jJw5XO0ziIHYMKb6Z6cVdHUWduPtrxsfWTib-i-jqbF0PQudSz-So4VhwvvJO1DgSkqRSq67eqVqDGcBsxn8SqQgj6Z9aarBEg-9Y2wL8Sn_I2YqSG9IqIcePq_TARSnGiaAvTPF88_FaIHjcbQZegfG3m9Zy1Zu4dBuOvW_MG4TU9kSxLByIGoNrqDylCtybz8O5WhdRd8XdHw2RwpPc_1ZB79yM-FGfo832tgHCrBZzdG2gqSJbnCe4x6aHg81mDUrzEglCBdco8REgRvvBiked6bQTx8NaU6wc38TD5LblZ7feW_V3Kq6sAbSfXW87ZRGpJ-zbCSWq43EheMh8iLTNowO9jO5vqpvyB14xh5-umGm5iQrz674";

		// 🎯 正しいエンドポイント + 商品ID指定
		const baseUrl = "https://api-demo.openlogi.com/api/items";

		// 📦 テストする商品ID（在庫商品から）
		const testProductIds = [
			"1",                    // 商品ID（数値）
			"protein-stick-trio"    // 商品コード
		];

		console.log("Testing OpenLogi items API with product IDs...");
		console.log("Base URL:", baseUrl);
		console.log("API Key length:", API_KEY.length);
		console.log("Test product IDs:", testProductIds);

		const results = [];

		// 🔄 各商品IDでテスト
		for (const productId of testProductIds) {
			try {
				// クエリパラメータ付きURL
				const url = `${baseUrl}?id=${productId}&stock=1`;
				console.log(`Testing: ${url}`);

				const apiResponse = await fetch(url, {
					method: 'GET',
					headers: {
						'Content-Type': 'application/json',
						'X-Api-Version': '1.5',
						'Authorization': `Bearer ${API_KEY}`,
						'User-Agent': 'GCF-OpenLogi-Test/1.0'
					},
					signal: AbortSignal.timeout(15000)
				});

				let responseBody;
				try {
					responseBody = await apiResponse.json();
				} catch (e) {
					responseBody = await apiResponse.text();
				}

				console.log(`${productId} → ${apiResponse.status}`, responseBody);

				results.push({
					productId: productId,
					url: url,
					status: apiResponse.status,
					statusText: apiResponse.statusText,
					success: apiResponse.status === 200,
					body: responseBody,
					headers: {
						'content-type': apiResponse.headers.get('content-type'),
						'x-ratelimit-remaining': apiResponse.headers.get('x-ratelimit-remaining')
					}
				});

				// 200が見つかったら詳細ログ
				if (apiResponse.status === 200) {
					console.log(`✅ SUCCESS with product ID: ${productId}`);
					console.log("Response data:", JSON.stringify(responseBody, null, 2));
				}

			} catch (error: any) {
				console.log(`❌ ERROR with product ID ${productId}: ${error.message}`);
				results.push({
					productId: productId,
					status: 'ERROR',
					error: error.message,
					success: false
				});
			}
		}

		// 📊 結果集計
		const successfulRequests = results.filter(r => r.success);

		// 📝 レスポンス生成
		if (successfulRequests.length > 0) {
			response.status(200).json({
				message: `🎉 OpenLogi API接続成功！ ${successfulRequests.length}個の商品IDで成功`,
				success: true,
				endpoint: baseUrl,
				successfulProductIds: successfulRequests.map(r => r.productId),
				detailResults: successfulRequests,
				apiInfo: {
					authenticated: true,
					correctEndpoint: baseUrl,
					requiredParameter: "商品ID（idパラメータ）が必須"
				},
				timestamp: new Date().toISOString()
			});
		} else {
			response.status(200).json({
				message: "❌ 商品IDでのアクセス失敗 - エンドポイントは正しいが商品IDが不正",
				success: false,
				endpoint: baseUrl,
				testedProductIds: testProductIds,
				allResults: results,
				apiInfo: {
					authenticated: true,
					correctEndpoint: baseUrl,
					issue: "商品IDの形式が不正の可能性"
				},
				timestamp: new Date().toISOString()
			});
		}

	} catch (error: any) {
		console.error("Overall test error:", error);

		response.status(200).json({
			success: false,
			message: "💥 テスト実行失敗",
			error: error.message,
			timestamp: new Date().toISOString()
		});
	}
});-e 
### FILE: ./src/testing/openLogiShipmentTest.ts

// src/testing/openLogiShipmentTest.ts
// OpenLogi出荷依頼API呼び出しテスト

import { onRequest } from "firebase-functions/v2/https";

/**
 * OpenLogi出荷依頼API呼び出しテスト
 */
export const testOpenLogiShipment = onRequest({
	region: "asia-northeast1",
	memory: "256MiB",
	timeoutSeconds: 60,
	cors: true,
}, async (request, response) => {

	try {
		// 🔑 APIキー（テスト環境用）
		const API_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiMGE1OTRkM2Q0Y2IwYWY5NTMzNjkzNTU5NjY0M2I1NjllYTdiZjk4NjAxNDY5MDNlNTg0ODBiOTZkYmM1MTJmZDBlYWUxY2NkNGNkYmZkOWQiLCJpYXQiOjE3NDk1MTc4MzcuNzg2MDU0LCJuYmYiOjE3NDk1MTc4MzcuNzg2MDU3LCJleHAiOjE3ODEwNTM4MzcuNzU3MjkzLCJzdWIiOiJkMjVmNTUwNi1jNzNiLTQyOTQtOGQ4Ny0zYzNkZWUyYTU5N2QiLCJzY29wZXMiOltdfQ.Ge3Mqqp-r44aZYeCg3S_NbF4_UKG1xnQjlkco7cOfjPCsxnJTFWrWrvsnCuGtZHHrAkTY3SFjUOIwt_eGeSJ8D9rhS-y8j4XKQVVaEOLta-GCunQwH26Wx3pUJVZ3YMFiq0-ao0QZi9iGopOj5W9OEIzu5w0HRqWJ4C3W0IgClVLax7nYT_3Jx9RG3DjUg57gr9v1iJ1qj6J3sOMR8_TtSr4CZwkIetGzObk6ZELYS1T1_mbiGs74EwqqilmqZk_1_I4vBvdFLjaBT6EYyQ4JmDZ1ljPGTLy7c8AGXBz8Um3lpyHvv4jJw5XO0ziIHYMKb6Z6cVdHUWduPtrxsfWTib-i-jqbF0PQudSz-So4VhwvvJO1DgSkqRSq67eqVqDGcBsxn8SqQgj6Z9aarBEg-9Y2wL8Sn_I2YqSG9IqIcePq_TARSnGiaAvTPF88_FaIHjcbQZegfG3m9Zy1Zu4dBuOvW_MG4TU9kSxLByIGoNrqDylCtybz8O5WhdRd8XdHw2RwpPc_1ZB79yM-FGfo832tgHCrBZzdG2gqSJbnCe4x6aHg81mDUrzEglCBdco8REgRvvBiked6bQTx8NaU6wc38TD5LblZ7feW_V3Kq6sAbSfXW87ZRGpJ-zbCSWq43EheMh8iLTNowO9jO5vqpvyB14xh5-umGm5iQrz674";

		// 🎯 OpenLogi出荷依頼APIエンドポイント
		const apiUrl = "https://api-demo.openlogi.com/api/shipments";

		// 📦 ハードコードされた出荷依頼データ
		const shipmentPayload = {
			// 🔑 基本情報
			"identifier": "365130d0-9cd2-4a51-9a8e-68eae151b4",  // 1. 識別番号
			"order_no": "session_mbosyus8_fx9fe22dgp",              // 2. 注文番号

			// 💰 金額情報
			"subtotal_amount": 30,     // 3. 納品書 小計
			"delivery_charge": 15,     // 4. 納品書 配送料
			"handling_charge": 0,      // 5. 納品書 手数料
			"discount_amount": 0,      // 6. 納品書 割引額
			"total_amount": 45,        // 7. 納品書 合計

			// 🎁 梱包・ラッピング
			"cushioning_unit": "ORDER",        // 8. 緩衝材単位
			"cushioning_type": "BUBBLE_PACK",  // 9. 緩衝材種別
			"gift_wrapping_unit": null,        // 10. ギフトラッピング単位
			"gift_wrapping_type": null,        // 11. ギフトラッピングタイプ
			// "gift_sender_name": null,        // 12. ギフト贈り主氏名（未使用）
			// "bundled_items": null,           // 13. 同梱指定（未使用）

			// 📧 連絡先・通知
			"shipping_email": null,            // 14. 配送先連絡メールアドレス

			// 📄 明細書設定
			"delivery_note_type": "NOT_INCLUDE_PII",  // 15. 明細書の同梱設定
			"price_on_delivery_note": true,           // 16. 明細書への金額印字指定
			"message": "お買い上げありがとうございます。BTCプロテインをお楽しみください！",  // 17. 明細書メッセージ

			// ⏸️ 処理制御
			"suspend": false,  // 18. 保留フラグ
			// "shipping_date": null,           // 19. 出荷希望日（未使用）
			// "tax": null,                     // 20. 消費税（未使用）
			// "total_with_normal_tax": null,   // 21. 合計通常税率（未使用）
			// "total_with_reduced_tax": null,  // 22. 合計軽減税率（未使用）

			// 🏷️ ラベル設定
			//"label_note": "健康食品・プロテインバー",     // ラベル品名（より具体的に）

			// 🚚 配送設定
			"delivery_carrier": "YAMATO",      // 23. 配送会社
			// "delivery_time_slot": null,      // 24. 希望時間指定（未使用）
			// "delivery_date": null,           // 25. 配達希望日（未使用）

			// 💳 代金引換
			"cash_on_delivery": false,         // 26. 代金引換指定
			// "total_for_cash_on_delivery": null,  // 27. 代金引換総計（未使用）
			// "tax_for_cash_on_delivery": null,    // 28. 代金引換消費税（未使用）

			// 📦 配送方法・倉庫
			"delivery_method": "HOME_BOX",     // 29. 配送便指定
			// "delivery_options": null,        // 30. 受取人からの希望（未使用）
			// "warehouse": "OPL",             // 31. 倉庫コード（エラーのため標準倉庫を使用）

			// 🛍️ 商品リスト
			"items": [                         // 32. 配送商品リスト
				{
					"code": "protein-stick-trio",               // 商品ID（確実に存在する）
					"quantity": 1
				}
			],

			// 🌐 国際配送
			"international": false,            // 33. 海外発送指定
			// "delivery_service": null,        // 34. 配送サービス（国際配送時のみ）
			// "currency_code": null,           // 35. 海外発送用通貨コード（国際配送時のみ）
			// "insurance": null,               // 36. 海外発送用損害保証制度（国際配送時のみ）

			// ⚙️ その他設定
			"backorder_if_unavailable": true,  // 37. 出荷単位の出荷予約フラグ
			// "purpose": null,                 // 38. 輸出目的（国際配送時のみ）
			"allocate_priority": 3,            // 39. 引当優先順位（修正: 50→3 実際の上限は3）

			// 📮 住所情報
			"sender": {                        // 40. 発送元住所
				"postcode": "170-0013",
				"prefecture": "東京都",
				"address1": "豊島区東池袋1-34-5",
				"address2": "いちご東池袋ビル9F",
				"name": "BTC Flavor株式会社",
				"company": "BTC Flavor株式会社",
				"division": "配送部",
				"phone": "03-1234-5678"
			},
			"recipient": {                     // 41. 発送先住所（確実に動作する形式に変更）
				"postcode": "170-0014",        // 豊島区池袋の郵便番号
				"phone": "09013988216",
				"address2": "サンシャインビル10F",
				"prefecture": "東京都",
				"name": "Kohei Yamanes",
				"address1": "豊島区池袋2-1-1"  // senderと近い、確実に存在する住所
			}

			// "apply_rule": false             // 42. 出荷ルール適用フラグ（未使用）
		};

		console.log("=== OpenLogi出荷依頼APIテスト開始 ===");
		console.log("API URL:", apiUrl);
		console.log("Payload:", JSON.stringify(shipmentPayload, null, 2));

		// 🚀 OpenLogi API呼び出し
		const startTime = Date.now();

		const apiResponse = await fetch(apiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Api-Version': '1.5',
				'Authorization': `Bearer ${API_KEY}`,
				'User-Agent': 'GCF-OpenLogi-Shipment-Test/1.0'
			},
			body: JSON.stringify(shipmentPayload),
			signal: AbortSignal.timeout(30000)
		});

		const processingTime = Date.now() - startTime;

		// 📥 レスポンス処理
		let responseBody;
		const contentType = apiResponse.headers.get('content-type') || '';

		try {
			if (contentType.includes('application/json')) {
				responseBody = await apiResponse.json();
			} else {
				responseBody = await apiResponse.text();
			}
		} catch (e) {
			console.error("Response parsing error:", e);
			responseBody = "Failed to parse response";
		}

		console.log(`API Response [${apiResponse.status}]:`, responseBody);

		// 📊 結果判定とレスポンス生成
		const isSuccess = apiResponse.status >= 200 && apiResponse.status < 300;

		if (isSuccess) {
			// ✅ 成功時
			response.status(200).json({
				success: true,
				message: "🎉 OpenLogi出荷依頼API呼び出し成功！",
				apiResponse: {
					status: apiResponse.status,
					statusText: apiResponse.statusText,
					body: responseBody,
					headers: {
						'content-type': contentType,
						'x-ratelimit-remaining': apiResponse.headers.get('x-ratelimit-remaining')
					}
				},
				requestDetails: {
					url: apiUrl,
					method: 'POST',
					payload: shipmentPayload,
					processingTime: `${processingTime}ms`
				},
				timestamp: new Date().toISOString()
			});

		} else {
			// ❌ エラー時
			response.status(200).json({
				success: false,
				message: `❌ OpenLogi API呼び出し失敗 [${apiResponse.status}]`,
				error: {
					status: apiResponse.status,
					statusText: apiResponse.statusText,
					body: responseBody,
					headers: {
						'content-type': contentType
					}
				},
				requestDetails: {
					url: apiUrl,
					method: 'POST',
					payload: shipmentPayload,
					processingTime: `${processingTime}ms`
				},
				troubleshooting: {
					commonIssues: [
						"APIキーの有効性確認",
						"商品IDの存在確認",
						"住所フォーマットの確認",
						"必須パラメータの確認"
					]
				},
				timestamp: new Date().toISOString()
			});
		}

	} catch (error: any) {
		console.error("=== テスト実行エラー ===", error);

		response.status(200).json({
			success: false,
			message: "💥 テスト実行中にエラーが発生しました",
			error: {
				message: error.message,
				type: error.constructor.name,
				stack: error.stack
			},
			timestamp: new Date().toISOString()
		});
	}
});-e 
### FILE: ./src/testing/apiIntegration.ts

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
});-e 
### FILE: ./src/shared/types/openlogi.ts

// src/shared/types/openlogi.ts
// OpenLogi API型定義

// 基本的な住所情報（国内）
export interface DomesticRecipient {
  name: string;
  prefecture: string;
  address1: string;
  address2?: string;
  postcode: string;
  phone: string;
  company?: string;
  division?: string;
}

// 国際配送用住所情報
export interface InternationalRecipient {
  name: string;
  region_code: string;
  state: string;
  city: string;
  address1: string;
  address2?: string;
  postcode: string;
  phone: string;
  company?: string;
}

// 商品情報
export interface OpenLogiItem {
  product_id: string;
  quantity: number;
}

// 配送オプション
export interface DeliveryOptions {
  box_delivery?: boolean;
  fragile_item?: boolean;
}

// 基本の出荷依頼データ
export interface BaseShipmentRequest {
  identifier: string;
  order_no: string;
  warehouse?: string;
  suspend?: boolean;
  backorder_if_unavailable?: boolean;
  
  // 金額情報
  subtotal_amount?: number;
  delivery_charge?: number;
  handling_charge?: number;
  discount_amount?: number;
  total_amount?: number;
  tax?: number;
  
  // 梱包・明細書設定
  cushioning_unit?: "ORDER" | "ITEM";
  cushioning_type?: "BUBBLE_PACK" | "BUBBLE_DOUBLE_PACK";
  gift_wrapping_unit?: "ORDER" | "ITEM";
  gift_wrapping_type?: "NAVY" | "RED";
  gift_sender_name?: string;
  delivery_note_type?: "NOT_INCLUDE_PII" | "NONE";
  price_on_delivery_note?: boolean;
  message?: string;
  shipping_email?: string;
  
  // 日時指定
  shipping_date?: string;
  delivery_date?: string;
  
  // その他
  allocate_priority?: number;
  apply_rule?: boolean;
  cash_on_delivery?: boolean;
  delivery_options?: DeliveryOptions;
  
  // 必須項目
  items: OpenLogiItem[];
  international: boolean;
}

// 国内配送リクエスト
export interface DomesticShipmentRequest extends BaseShipmentRequest {
  international: false;
  recipient: DomesticRecipient;
  delivery_carrier?: "YAMATO" | "SAGAWA";
  delivery_method?: "POST_EXPRESS" | "HOME_BOX";
  delivery_time_slot?: "AM" | "12" | "14" | "16" | "18" | "19";
}

// 国際配送リクエスト
export interface InternationalShipmentRequest extends BaseShipmentRequest {
  international: true;
  recipient: InternationalRecipient;
  delivery_service: "SAGAWA-HIKYAKU-YU-PACKET" | "SAGAWA-TAKUHAIBIN" | "SAGAWA-COOLBIN" | 
                   "YAMATO-NEKOPOSU" | "YAMATO-TAKKYUBIN" | "YAMATO-COOLBIN" |
                   "JAPANPOST-EMS" | "JAPANPOST-EPACKET" | "JAPANPOST-YU-PACKET" |
                   "FEDEX-PRIORITY" | "FEDEX-CONNECT-PLUS" | "DHL-EXPRESS";
  currency_code: string;
  insurance: boolean;
  purpose?: "GIFT" | "DOCUMENTS" | "COMMERCIAL_SAMPLE" | "SALE_OF_GOODS" | "RETURNED_GOODS" | "OTHERS";
}

// Union型
export type OpenLogiShipmentRequest = DomesticShipmentRequest | InternationalShipmentRequest;

// APIレスポンス（詳細版）
export interface OpenLogiResponse {
  id: string;                           // 出荷依頼ID（例: "TS001-S000001"）
  identifier: string;                   // 識別番号
  order_no: string;                     // 注文番号
  status: string;                       // ステータス（例: "waiting", "processing", "shipped"）
  
  // 金額情報
  subtotal_amount?: number;
  delivery_charge?: number;
  handling_charge?: number;
  discount_amount?: number;
  total_amount?: number;
  
  // 配送情報
  delivery_carrier?: string;
  delivery_method?: string;
  delivery_time_slot?: string;
  delivery_date?: string;
  assigned_shipping_date?: string;
  
  // その他
  warehouse?: string;
  suspend?: boolean;
  message?: string;
  
  // メタデータ
  created_at?: string;
  updated_at?: string;
}

// エラー型
export type OpenLogiError = 
  | 'INVOICE_NOT_FOUND'
  | 'USER_NOT_FOUND' 
  | 'ADDRESS_INVALID'
  | 'CONVERSION_FAILED'
  | 'FIRESTORE_ERROR'
  | 'INVALID_INPUT'
  | 'MISSING_SHIPPING_REQUEST'
  | 'CURRENCY_CONVERSION_ERROR';

// 変換テストリクエスト（シンプル版）
export interface ConversionTestRequest {
  invoiceId: string;
  validateOnly?: boolean;
  includeDebugInfo?: boolean;
}

// 変換メタデータ
export interface ConversionMetadata {
  shippingType: 'domestic' | 'international';
  currencyConversion: {
    originalUSD: number;
    convertedJPY: number;
    exchangeRate: number;
  };
  itemCount: number;
  processingTime: string;
}

// 変換結果（シンプル版）
export interface ConversionResult {
  openlogiPayload: OpenLogiShipmentRequest;
  sourceData?: {
    invoice: any;
    userAddress: any;
  };
  conversionMetadata: ConversionMetadata;
}

// 成功レスポンス（シンプル版）
export interface ConversionTestResponse {
  success: true;
  invoiceId: string;
  conversionResult: ConversionResult;
  debugInfo?: any;
  timestamp: string;
}

// エラーレスポンス
export interface ConversionErrorResponse {
  success: false;
  invoiceId?: string;
  error: OpenLogiError;
  message: string;
  details?: any;
  timestamp: string;
}-e 
### FILE: ./src/shared/config/firebase.ts

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Firebase Admin初期化
initializeApp();

// Firestore インスタンスをエクスポート
export const db = getFirestore();-e 
### FILE: ./src/shared/config/openlogiConfig.ts

// src/shared/config/openlogiConfig.ts
// OpenLogi API設定値

import { DomesticRecipient } from '../types/openlogi';

// API設定（OpenLogi Demo環境）
export const OPENLOGI_API_CONFIG = {
	// 🧪 Demo環境: https://api-demo.openlogi.com
	// 本番環境: https://api.openlogi.com  
	BASE_URL: "https://api-demo.openlogi.com",  // ✅ Demo環境URL
	ENDPOINTS: {
		SHIPMENTS: "/shipments"
	},
	API_VERSION: "1.5",                         // ✅ APIバージョン
	TIMEOUT: 60000, // 60秒（推奨接続タイムアウト）
};

// 基本設定
export const OPENLOGI_DEFAULTS = {
	WAREHOUSE_CODE: "OPL",
	USD_TO_JPY_RATE: 150, // デフォルト為替レート（要定期更新）

	// 会社発送元住所
	SENDER_ADDRESS: {
		postcode: "170-0013",
		prefecture: "東京都",
		address1: "豊島区東池袋1-34-5",
		address2: "いちご東池袋ビル9F",
		name: "BTC Flavor株式会社",
		company: "BTC Flavor株式会社",
		division: "配送部",
		phone: "03-1234-5678"
	} as DomesticRecipient,

	// 梱包設定
	PACKAGING_DEFAULTS: {
		cushioning_unit: "ORDER" as const,
		cushioning_type: "BUBBLE_PACK" as const,
		gift_wrapping_unit: null,
		gift_wrapping_type: null,
		delivery_method: "HOME_BOX" as const
	},

	// 明細書・通知設定
	INVOICE_DEFAULTS: {
		delivery_note_type: "NOT_INCLUDE_PII" as const,
		price_on_delivery_note: true,
		message: "お買い上げありがとうございます。BTCプロテインをお楽しみください！",
		shipping_email: null // プライバシー重視でメール通知なし
	},

	// システム制御設定
	SYSTEM_DEFAULTS: {
		suspend: false,
		backorder_if_unavailable: true,
		apply_rule: false,
		allocate_priority: 50,
		cash_on_delivery: false,
		handling_charge: 0,
		discount_amount: 0
	},

	// 国際配送デフォルト
	INTERNATIONAL_DEFAULTS: {
		delivery_service: "JAPANPOST-EMS" as const,
		currency_code: "JPY",
		insurance: true,
		purpose: "SALE_OF_GOODS" as const
	}
};

// バリデーションルール
export const VALIDATION_RULES = {
	INVOICE_REQUIRED_FIELDS: ['id', 'sessionId', 'userId', 'cartSnapshot', 'amount_usd'],
	CART_SNAPSHOT_REQUIRED_FIELDS: ['items', 'subtotal'],
	CART_ITEM_REQUIRED_FIELDS: ['id', 'quantity'],
	SHIPPING_REQUEST_REQUIRED_FIELDS: ['international', 'recipient'],
	RECIPIENT_REQUIRED_FIELDS: ['name', 'address1', 'postcode', 'phone'],

	// 数値制限
	MAX_AMOUNT_JPY: 999999999,
	MIN_AMOUNT_JPY: 1,
	MAX_ITEMS: 100,
	MAX_MESSAGE_LENGTH: 500
};

// エラーメッセージ
export const ERROR_MESSAGES = {
	INVOICE_NOT_FOUND: "Invoice not found",
	USER_NOT_FOUND: "User data not found",
	ADDRESS_INVALID: "Invalid or missing address data",
	MISSING_SHIPPING_REQUEST: "Missing shippingRequest in address",
	CONVERSION_FAILED: "Failed to convert data to OpenLogi format",
	FIRESTORE_ERROR: "Firestore operation failed",
	INVALID_INPUT: "Invalid input parameters",
	CURRENCY_CONVERSION_ERROR: "Currency conversion failed"
};

// 通貨換算ヘルパー
export function convertUSDToJPY(usdAmount: number, rate: number = OPENLOGI_DEFAULTS.USD_TO_JPY_RATE): number {
	if (typeof usdAmount !== 'number' || usdAmount < 0) {
		throw new Error('Invalid USD amount');
	}
	if (typeof rate !== 'number' || rate <= 0) {
		throw new Error('Invalid exchange rate');
	}
	return Math.round(usdAmount * rate);
}

// 商品ID変換（将来的にマッピングが必要な場合）
export function mapProductId(cartItemId: string): string {
	// 現在は1:1マッピング（OpenLogiの商品コードと一致）
	return cartItemId;
}

// デバッグモード判定
export function isDebugMode(): boolean {
	return process.env.FUNCTIONS_EMULATOR === 'true' || process.env.NODE_ENV === 'development';
}-e 
### FILE: ./src/shared/utils/paymentHelpers.ts

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


		const invoiceData = invoiceDoc.data();
		const currentStatus = invoiceData?.status;
		
		if (currentStatus === "paid") {
			logger.info("Invoice already paid; skipping redirect update", { invoiceId });
			return;  // すでに paid の場合は何もしない
		}

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
}-e 
### FILE: ./src/shared/utils/openlogiClient.ts

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
}-e 
### FILE: ./src/shared/utils/openlogiConverter.ts

// src/shared/utils/openlogiConverter.ts
// OpenLogi形式への変換ロジック

import * as logger from "firebase-functions/logger";
import {
	OpenLogiShipmentRequest,
	DomesticShipmentRequest,
	InternationalShipmentRequest,
	ConversionMetadata
} from '../types/openlogi';
import {
	OPENLOGI_DEFAULTS,
	VALIDATION_RULES,
	ERROR_MESSAGES,
	convertUSDToJPY,
	mapProductId
} from '../config/openlogiConfig';

/**
 * バリデーション関数群
 */

export function validateInvoiceData(invoiceData: any): void {
	if (!invoiceData) {
		throw new Error(ERROR_MESSAGES.INVOICE_NOT_FOUND);
	}

	// 必須フィールドチェック
	for (const field of VALIDATION_RULES.INVOICE_REQUIRED_FIELDS) {
		if (!invoiceData[field]) {
			throw new Error(`Missing required invoice field: ${field}`);
		}
	}

	// cartSnapshotのバリデーション
	const cartSnapshot = invoiceData.cartSnapshot;
	for (const field of VALIDATION_RULES.CART_SNAPSHOT_REQUIRED_FIELDS) {
		if (!cartSnapshot[field]) {
			throw new Error(`Missing required cartSnapshot field: ${field}`);
		}
	}

	// 商品アイテムのバリデーション
	if (!Array.isArray(cartSnapshot.items) || cartSnapshot.items.length === 0) {
		throw new Error("Cart items must be a non-empty array");
	}

	if (cartSnapshot.items.length > VALIDATION_RULES.MAX_ITEMS) {
		throw new Error(`Too many items: ${cartSnapshot.items.length} (max: ${VALIDATION_RULES.MAX_ITEMS})`);
	}

	// 各商品アイテムのバリデーション
	cartSnapshot.items.forEach((item: any, index: number) => {
		for (const field of VALIDATION_RULES.CART_ITEM_REQUIRED_FIELDS) {
			if (!item[field]) {
				throw new Error(`Missing required field '${field}' in cart item ${index}`);
			}
		}

		if (typeof item.quantity !== 'number' || item.quantity <= 0) {
			throw new Error(`Invalid quantity for item ${index}: ${item.quantity}`);
		}
	});

	// 金額バリデーション
	if (typeof invoiceData.amount_usd !== 'number' || invoiceData.amount_usd <= 0) {
		throw new Error(`Invalid amount_usd: ${invoiceData.amount_usd}`);
	}
}

export function validateUserAddress(userAddress: any): void {
	if (!userAddress) {
		throw new Error(ERROR_MESSAGES.ADDRESS_INVALID);
	}

	if (!userAddress.shippingRequest) {
		throw new Error(ERROR_MESSAGES.MISSING_SHIPPING_REQUEST);
	}

	const shippingRequest = userAddress.shippingRequest;

	// 必須フィールドチェック
	for (const field of VALIDATION_RULES.SHIPPING_REQUEST_REQUIRED_FIELDS) {
		if (shippingRequest[field] === undefined) {
			throw new Error(`Missing required shippingRequest field: ${field}`);
		}
	}

	// recipient情報のバリデーション
	const recipient = shippingRequest.recipient;
	if (!recipient) {
		throw new Error("Missing recipient information");
	}

	for (const field of VALIDATION_RULES.RECIPIENT_REQUIRED_FIELDS) {
		if (!recipient[field]) {
			throw new Error(`Missing required recipient field: ${field}`);
		}
	}

	// 国際配送の場合の追加バリデーション
	if (shippingRequest.international) {
		if (!recipient.region_code) {
			throw new Error("Missing region_code for international shipping");
		}
		if (!recipient.city) {
			throw new Error("Missing city for international shipping");
		}
	} else {
		// 国内配送の場合
		if (!recipient.prefecture) {
			throw new Error("Missing prefecture for domestic shipping");
		}
	}
}

/**
 * 変換メタデータ生成
 */
export function generateConversionMetadata(
	invoiceData: any,
	userAddress: any,
	processingStartTime: number
): ConversionMetadata {
	const processingTime = Date.now() - processingStartTime;
	const exchangeRate = OPENLOGI_DEFAULTS.USD_TO_JPY_RATE;

	return {
		shippingType: userAddress.shippingRequest.international ? 'international' : 'domestic',
		currencyConversion: {
			originalUSD: invoiceData.amount_usd,
			convertedJPY: convertUSDToJPY(invoiceData.amount_usd, exchangeRate),
			exchangeRate
		},
		itemCount: invoiceData.cartSnapshot.items.length,
		processingTime: `${processingTime}ms`
	};
}

/**
 * 商品リスト変換
 */
export function convertCartItemsToOpenLogiItems(cartItems: any[]): any[] {
	return cartItems.map(item => ({
		product_id: mapProductId(item.id),
		quantity: item.quantity
	}));
}

/**
 * 基本リクエストデータ生成
 */
export function generateBaseRequest(invoiceData: any, userAddress: any): any {
	const exchangeRate = OPENLOGI_DEFAULTS.USD_TO_JPY_RATE;

	return {
		// 基本識別情報
		identifier: invoiceData.id,
		order_no: invoiceData.sessionId,
		warehouse: OPENLOGI_DEFAULTS.WAREHOUSE_CODE,

		// 金額情報（USD→JPY変換）
		subtotal_amount: convertUSDToJPY(invoiceData.cartSnapshot.subtotal, exchangeRate),
		delivery_charge: convertUSDToJPY(userAddress.shippingFee || 0, exchangeRate),
		total_amount: convertUSDToJPY(invoiceData.amount_usd, exchangeRate),

		// 商品リスト
		items: convertCartItemsToOpenLogiItems(invoiceData.cartSnapshot.items),

		// 配送先住所
		recipient: userAddress.shippingRequest.recipient,

		// デフォルト設定適用
		...OPENLOGI_DEFAULTS.PACKAGING_DEFAULTS,
		...OPENLOGI_DEFAULTS.INVOICE_DEFAULTS,
		...OPENLOGI_DEFAULTS.SYSTEM_DEFAULTS,

		// 発送元住所
		sender: OPENLOGI_DEFAULTS.SENDER_ADDRESS
	};
}

/**
 * 国内配送リクエスト生成
 */
export function generateDomesticRequest(baseRequest: any, shippingRequest: any): DomesticShipmentRequest {
	return {
		...baseRequest,
		international: false,
		delivery_carrier: shippingRequest.delivery_carrier || "YAMATO",
		delivery_method: shippingRequest.delivery_method || "HOME_BOX",
		delivery_time_slot: shippingRequest.delivery_time_slot
	};
}

/**
 * 国際配送リクエスト生成
 */
export function generateInternationalRequest(baseRequest: any, shippingRequest: any): InternationalShipmentRequest {
	return {
		...baseRequest,
		international: true,
		delivery_service: shippingRequest.delivery_service || OPENLOGI_DEFAULTS.INTERNATIONAL_DEFAULTS.delivery_service,
		currency_code: OPENLOGI_DEFAULTS.INTERNATIONAL_DEFAULTS.currency_code,
		insurance: shippingRequest.insurance ?? OPENLOGI_DEFAULTS.INTERNATIONAL_DEFAULTS.insurance,
		purpose: shippingRequest.purpose || OPENLOGI_DEFAULTS.INTERNATIONAL_DEFAULTS.purpose
	};
}

/**
 * メイン変換関数
 */
export function convertToOpenLogiFormat(
	invoiceData: any,
	userAddress: any
): OpenLogiShipmentRequest {
	const startTime = Date.now();

	try {
		// バリデーション
		validateInvoiceData(invoiceData);
		validateUserAddress(userAddress);

		logger.info("Starting OpenLogi conversion", {
			invoiceId: invoiceData.id,
			isInternational: userAddress.shippingRequest.international,
			itemCount: invoiceData.cartSnapshot.items.length
		});

		// 基本リクエストデータ生成
		const baseRequest = generateBaseRequest(invoiceData, userAddress);

		// 国内/国際配送で分岐
		const shippingRequest = userAddress.shippingRequest;
		let openlogiRequest: OpenLogiShipmentRequest;

		if (shippingRequest.international) {
			openlogiRequest = generateInternationalRequest(baseRequest, shippingRequest);
			logger.info("Generated international shipping request", {
				invoiceId: invoiceData.id,
				deliveryService: openlogiRequest.delivery_service,
				destination: openlogiRequest.recipient.region_code
			});
		} else {
			openlogiRequest = generateDomesticRequest(baseRequest, shippingRequest);
			logger.info("Generated domestic shipping request", {
				invoiceId: invoiceData.id,
				deliveryCarrier: openlogiRequest.delivery_carrier,
				prefecture: openlogiRequest.recipient.prefecture
			});
		}

		// 最終バリデーション
		validateGeneratedRequest(openlogiRequest);

		const processingTime = Date.now() - startTime;
		logger.info("OpenLogi conversion completed", {
			invoiceId: invoiceData.id,
			processingTime: `${processingTime}ms`
		});

		return openlogiRequest;

	} catch (error: any) {
		const processingTime = Date.now() - startTime;
		logger.error("OpenLogi conversion failed", {
			invoiceId: invoiceData?.id,
			error: error.message,
			processingTime: `${processingTime}ms`
		});
		throw error;
	}
}

/**
 * 生成されたリクエストの最終バリデーション
 */
function validateGeneratedRequest(request: OpenLogiShipmentRequest): void {
	// 金額範囲チェック
	if (request.total_amount && (request.total_amount > VALIDATION_RULES.MAX_AMOUNT_JPY || request.total_amount < VALIDATION_RULES.MIN_AMOUNT_JPY)) {
		throw new Error(`Total amount out of range: ${request.total_amount}`);
	}

	// メッセージ長さチェック
	if (request.message && request.message.length > VALIDATION_RULES.MAX_MESSAGE_LENGTH) {
		throw new Error(`Message too long: ${request.message.length} characters (max: ${VALIDATION_RULES.MAX_MESSAGE_LENGTH})`);
	}

	// 必須フィールド最終チェック
	if (!request.identifier || !request.order_no || !request.items || request.items.length === 0) {
		throw new Error("Missing required fields in generated request");
	}
}-e 
### FILE: ./src/shared/middleware/security.ts

import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import { db } from "../config/firebase";

export interface WebhookVerificationResult {
  isValid: boolean;
  invoiceId?: string;
  status?: string;
  webhookData?: any;
  errorMessage?: string;
}

/**
 * OpenNode Webhook署名検証
 */
export function verifyWebhookSignature(
  invoiceId: string,
  receivedHash: string,
  apiKey: string
): boolean {
  try {
    // HMAC-SHA256で署名を再計算
    const calculatedHash = crypto
      .createHmac("sha256", apiKey)
      .update(invoiceId)
      .digest("hex");

    // 署名検証
    const isValid = receivedHash === calculatedHash;

    if (isValid) {
      logger.info("✅ Webhook signature verified successfully", {
        invoiceId,
        hashPrefix: calculatedHash.substring(0, 16) + "...",
      });
    } else {
      logger.error("Webhook signature verification failed", {
        invoiceId,
        receivedHash: receivedHash.substring(0, 16) + "...",
        calculatedHash: calculatedHash.substring(0, 16) + "...",
        lengthMatch: receivedHash.length === calculatedHash.length,
      });
    }

    return isValid;
  } catch (error: any) {
    logger.error("Webhook signature verification error", {
      error: error.message,
      invoiceId,
    });
    return false;
  }
}

/**
 * Webhook検証（基本フィールドチェック + 署名検証）
 */
export function verifyWebhookPayload(
  webhookData: any,
  apiKey: string
): WebhookVerificationResult {
  const { id: invoiceId, hashed_order: receivedHash, status } = webhookData;

  logger.info("Webhook payload for verification", {
    invoiceId,
    status,
    hasHashedOrder: !!receivedHash,
    payloadKeys: Object.keys(webhookData || {}),
  });

  // 必須フィールドチェック
  if (!invoiceId || !receivedHash) {
    const errorMessage = "Missing required verification fields";
    logger.warn(errorMessage, {
      hasInvoiceId: !!invoiceId,
      hasHashedOrder: !!receivedHash,
    });

    return {
      isValid: false,
      errorMessage,
    };
  }

  // 署名検証
  const isSignatureValid = verifyWebhookSignature(invoiceId, receivedHash, apiKey);

  return {
    isValid: isSignatureValid,
    invoiceId,
    status,
    webhookData,
    errorMessage: isSignatureValid ? undefined : "Invalid webhook signature",
  };
}

/**
 * セキュアログをFirestoreに保存
 */
export async function saveSecureWebhookLog(
  verification: WebhookVerificationResult,
  request: any,
  processingTime: number,
  processedAction: string,
  apiKey: string
): Promise<string> {
  try {
    const timestamp = new Date();
    const docId = verification.isValid
      ? `SECURE-${timestamp.toISOString().replace(/[:.]/g, "-")}`
      : `SECURE-ERROR-${timestamp.toISOString().replace(/[:.]/g, "-")}`;

    const logData = {
      receivedAt: timestamp,
      webhookData: verification.webhookData,
      verificationResult: {
        signatureValid: verification.isValid,
        invoiceId: verification.invoiceId,
        status: verification.status,
        processedAction,
        errorMessage: verification.errorMessage,
      },
      source: verification.isValid ? "opennode-verified" : "opennode-security-error",
      method: request.method,
      headers: {
        contentType: request.get("Content-Type"),
        userAgent: request.get("User-Agent"),
      },
      metadata: {
        processingTime: `${processingTime}ms`,
        success: verification.isValid,
        apiKeyUsed: apiKey.substring(0, 8) + "***",
      },
    };

    await db.collection("SecureWebhookLogs").doc(docId).set(logData);

    logger.info("Secure webhook log saved", {
      documentId: docId,
      success: verification.isValid,
    });

    return docId;
  } catch (error: any) {
    logger.error("Failed to save secure webhook log", {
      error: error.message,
    });
    throw error;
  }
}-e 
### FILE: ./src/types.ts

// CoinGecko API Response Types
export interface CoinGeckoPrice {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  fully_diluted_valuation: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  market_cap_change_24h: number;
  market_cap_change_percentage_24h: number;
  circulating_supply: number;
  total_supply: number;
  max_supply: number;
  ath: number;
  ath_change_percentage: number;
  ath_date: string;
  atl: number;
  atl_change_percentage: number;
  atl_date: string;
  roi: any;
  last_updated: string;
}

// Firestore Document Types
export interface CryptoPriceData {
  id: string;
  symbol: string;
  name: string;
  price_usd: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  market_cap_usd: number;
  volume_24h_usd: number;
  last_updated: FirebaseFirestore.Timestamp;
  source: "coingecko";
}

export interface CryptoMetadata {
  supported_currencies: string[];
  update_frequency_minutes: number;
  last_sync_timestamp: FirebaseFirestore.Timestamp;
  sync_status: "success" | "error" | "in_progress";
  error_message?: string;
  coingecko_rate_limit_remaining?: number;
  total_api_calls_today?: number;
}

// Configuration
export interface CryptoConfig {
  currencies: {
    id: string; // CoinGecko ID
    symbol: string; // Symbol for Firestore
    name: string; // Display name
  }[];
}
-e 
### FILE: ./src/webhook/opennode.ts

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { defineString } from "firebase-functions/params";
import {
  verifyWebhookPayload,
  saveSecureWebhookLog,
} from "../shared/middleware/security";
import {
  processPaymentSuccess,
  processPaymentExpired,
  updateInvoiceStatus,
} from "../shared/utils/paymentHelpers";

// 環境変数定義
const opennodeApiKey = defineString("OPENNODE_API_KEY", {
  description: "OpenNode API Key for webhook verification",
  default: "",
});

/**
 * セキュリティ検証付きOpenNode Webhook処理関数
 * HMAC-SHA256署名検証を実装
 */
export const opennodeWebhookSecure = onRequest({
  region: "asia-northeast1",
  memory: "256MiB",
  timeoutSeconds: 60,
  cors: true,
}, async (request, response) => {
  const startTime = Date.now();

  try {
    logger.info("OpenNode Secure Webhook received", {
      method: request.method,
      timestamp: new Date().toISOString(),
      userAgent: request.get("User-Agent"),
      contentType: request.get("Content-Type"),
    });

    // POSTメソッドのみ受け付け
    if (request.method !== "POST") {
      logger.warn("Invalid HTTP method for secure webhook", {
        method: request.method,
        ip: request.ip,
      });

      response.status(405).json({
        error: "Method not allowed",
        message: "Only POST method is allowed",
      });
      return;
    }

    // API Key チェック
    const apiKey = opennodeApiKey.value();
    if (!apiKey) {
      logger.error("OpenNode API key not configured");
      response.status(500).json({
        error: "API key not configured",
      });
      return;
    }

    // Webhook検証
    const verification = verifyWebhookPayload(request.body, apiKey);

    if (!verification.isValid) {
      const statusCode = verification.errorMessage?.includes("Missing required") ? 400 : 401;
      
      response.status(statusCode).json({
        error: verification.errorMessage,
        message: statusCode === 401 ? "Webhook verification failed - not from OpenNode" : undefined,
        details: statusCode === 400 ? {
          invoiceId: !!verification.invoiceId,
          hashedOrder: !!request.body.hashed_order,
        } : undefined,
      });

      // エラーログ保存
      await saveSecureWebhookLog(
        verification,
        request,
        Date.now() - startTime,
        "verification_failed",
        apiKey
      );
      return;
    }

    // 支払いステータス処理
    let processedAction = "none";
    const { invoiceId, status, webhookData } = verification;

    if (status === "paid") {
      // 支払い完了処理
      await processPaymentSuccess(invoiceId!, webhookData);
      processedAction = "payment_completed";
      
      logger.info("💰 Payment processing completed", {
        invoiceId,
        amount: webhookData.price,
        fee: webhookData.fee,
      });

    } else if (status === "expired") {
      // 期限切れ処理
      await processPaymentExpired(invoiceId!, webhookData);
      processedAction = "payment_expired";
      
      logger.info("⏰ Payment expired", {
        invoiceId,
      });

    } else {
      // その他のステータス更新
      await updateInvoiceStatus(invoiceId!, status!, webhookData);
      processedAction = `status_updated_${status}`;
      
      logger.info("📝 Invoice status updated", {
        invoiceId,
        newStatus: status,
      });
    }

    // セキュア処理ログを保存
    const logDocId = await saveSecureWebhookLog(
      verification,
      request,
      Date.now() - startTime,
      processedAction,
      apiKey
    );

    const duration = Date.now() - startTime;

    logger.info("Secure webhook processing completed", {
      documentId: logDocId,
      invoiceId,
      status,
      processedAction,
      duration: `${duration}ms`,
    });

    // OpenNodeに成功レスポンス返却
    response.status(200).json({
      success: true,
      message: "Secure webhook processed successfully",
      data: {
        invoiceId,
        status,
        processedAction,
        verificationPassed: true,
        timestamp: new Date().toISOString(),
        processingTime: `${duration}ms`,
      },
    });

  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    logger.error("Secure webhook processing failed", {
      error: error.message,
      stack: error.stack,
      duration: `${duration}ms`,
    });

    response.status(500).json({
      error: "Secure webhook processing failed",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});-e 
### FILE: ./src/index.ts

// Firebase Admin初期化（最初に実行される）
import "./shared/config/firebase";

// 各機能モジュールからエクスポート
export { opennodeWebhookSecure } from "./webhook/opennode";
export { updateCryptoPrices } from "./crypto/priceUpdater";

// 🆕 OpenLogi テスト関数エクスポート
export { testOpenLogiDataConversion } from "./testing/dataConverter";
/*

curl -X POST \
  https://testopenlogidataconversion-spcu6fqyiq-an.a.run.app \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceId": "365130d0-9cd2-4a51-9a8e-68eae4151b4f"
  }'

*/

// 🆕 Phase2: OpenLogi API統合テスト関数エクスポート
export { testOpenLogiAPIIntegration, testOpenLogiConnection } from "./testing/apiIntegration";
/*
curl -X POST https://testopenlogiconnection-spcu6fqyiq-an.a.run.app

curl -X POST \
  https://testopenlogiapiintegration-spcu6fqyiq-an.a.run.app \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceId": "365130d0-9cd2-4a51-9a8e-68eae4151b4f",
    "dryRun": false,
    "includeDebugInfo": true
  }'

curl -X GET \
  https://api-demo.openlogi.com/api/items \
  -H "Content-Type: application/json" \
  -H "X-Api-Version: 1.5" \
  -H "Authorization: eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiMGE1OTRkM2Q0Y2IwYWY5NTMzNjkzNTU5NjY0M2I1NjllYTdiZjk4NjAxNDY5MDNlNTg0ODBiOTZkYmM1MTJmZDBlYWUxY2NkNGNkYmZkOWQiLCJpYXQiOjE3NDk1MTc4MzcuNzg2MDU0LCJuYmYiOjE3NDk1MTc4MzcuNzg2MDU3LCJleHAiOjE3ODEwNTM4MzcuNzU3MjkzLCJzdWIiOiJkMjVmNTUwNi1jNzNiLTQyOTQtOGQ4Ny0zYzNkZWUyYTU5N2QiLCJzY29wZXMiOltdfQ.Ge3Mqqp-r44aZYeCg3S_NbF4_UKG1xnQjlkco7cOfjPCsxnJTFWrWrvsnCuGtZHHrAkTY3SFjUOIwt_eGeSJ8D9rhS-y8j4XKQVVaEOLta-GCunQwH26Wx3pUJVZ3YMFiq0-ao0QZi9iGopOj5W9OEIzu5w0HRqWJ4C3W0IgClVLax7nYT_3Jx9RG3DjUg57gr9v1iJ1qj6J3sOMR8_TtSr4CZwkIetGzObk6ZELYS1T1_mbiGs74EwqqilmqZk_1_I4vBvdFLjaBT6EYyQ4JmDZ1ljPGTLy7c8AGXBz8Um3lpyHvv4jJw5XO0ziIHYMKb6Z6cVdHUWduPtrxsfWTib-i-jqbF0PQudSz-So4VhwvvJO1DgSkqRSq67eqVqDGcBsxn8SqQgj6Z9aarBEg-9Y2wL8Sn_I2YqSG9IqIcePq_TARSnGiaAvTPF88_FaIHjcbQZegfG3m9Zy1Zu4dBuOvW_MG4TU9kSxLByIGoNrqDylCtybz8O5WhdRd8XdHw2RwpPc_1ZB79yM-FGfo832tgHCrBZzdG2gqSJbnCe4x6aHg81mDUrzEglCBdco8REgRvvBiked6bQTx8NaU6wc38TD5LblZ7feW_V3Kq6sAbSfXW87ZRGpJ-zbCSWq43EheMh8iLTNowO9jO5vqpvyB14xh5-umGm5iQrz674" \
  -v

*/

export {simpleOpenLogiTest} from './testing/simpleConnectionTest';
//npx firebase deploy --only functions:simpleOpenLogiTest
//curl -X POST https://simpleopenlogitest-spcu6fqyiq-an.a.run.app

export {testOpenLogiShipment} from './testing/openLogiShipmentTest';
//npx firebase deploy --only functions:testOpenLogiShipment
//curl -X POST https://testopenlogishipment-spcu6fqyiq-an.a.run.app-e 
### FILE: ./lib/services/coinGeckoService.js

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoinGeckoService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger = __importStar(require("firebase-functions/logger"));
class CoinGeckoService {
    constructor(apiKey) {
        this.baseUrl = "https://api.coingecko.com/api/v3";
        this.apiKey = apiKey;
    }
    /**
     * 複数の暗号通貨の価格データを取得
     */
    async getCryptoPrices(ids) {
        var _a, _b, _c;
        try {
            const idsString = ids.join(",");
            const url = `${this.baseUrl}/coins/markets`;
            const params = {
                ids: idsString,
                vs_currency: "usd",
                order: "market_cap_desc",
                per_page: ids.length,
                page: 1,
                sparkline: false,
                price_change_percentage: "24h",
                precision: "full",
            };
            // API Key が 'demo' でない場合のみヘッダーに追加
            const headers = {
                "Accept": "application/json",
                "User-Agent": "we-are-onchain-gcf/1.0.0",
            };
            if (this.apiKey && this.apiKey !== "demo") {
                headers["x-cg-demo-api-key"] = this.apiKey;
            }
            logger.info("Fetching crypto prices", {
                url,
                params,
                idsCount: ids.length,
            });
            const response = await axios_1.default.get(url, {
                params,
                headers,
                timeout: 30000, // 30秒タイムアウト
            });
            logger.info("CoinGecko API response received", {
                statusCode: response.status,
                dataLength: response.data.length,
                rateLimitRemaining: response.headers["x-ratelimit-remaining"],
            });
            return response.data;
        }
        catch (error) {
            logger.error("CoinGecko API error", {
                error: error.message,
                status: (_a = error.response) === null || _a === void 0 ? void 0 : _a.status,
                statusText: (_b = error.response) === null || _b === void 0 ? void 0 : _b.statusText,
                data: (_c = error.response) === null || _c === void 0 ? void 0 : _c.data,
            });
            throw new Error(`CoinGecko API failed: ${error.message}`);
        }
    }
    /**
     * APIの使用状況を確認
     */
    async checkApiUsage() {
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/ping`, {
                headers: this.apiKey !== "demo" ? {
                    "x-cg-demo-api-key": this.apiKey,
                } : {},
            });
            return {
                remaining: parseInt(response.headers["x-ratelimit-remaining"] || "30"),
                limit: parseInt(response.headers["x-ratelimit-limit"] || "30"),
                resetTime: parseInt(response.headers["x-ratelimit-reset"]),
            };
        }
        catch (error) {
            logger.warn("Could not check API usage", { error: error.message });
            return { remaining: 30, limit: 30 }; // デフォルト値
        }
    }
}
exports.CoinGeckoService = CoinGeckoService;
//# sourceMappingURL=coinGeckoService.js.map-e 
### FILE: ./lib/services/firestoreService.js

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FirestoreService = void 0;
const firestore_1 = require("firebase-admin/firestore");
const logger = __importStar(require("firebase-functions/logger"));
/**
 * Firestore service for managing crypto price data
 */
class FirestoreService {
    constructor() {
        this.db = (0, firestore_1.getFirestore)();
    }
    /**
     * Save cryptocurrency price data to Firestore
     * @param {CoinGeckoPrice[]} prices - Array of price data to save
     * @return {Promise<void>}
     */
    async saveCryptoPrices(prices) {
        const batch = this.db.batch();
        try {
            for (const price of prices) {
                const priceData = {
                    id: price.id,
                    symbol: price.symbol.toUpperCase(),
                    name: price.name,
                    price_usd: price.current_price,
                    price_change_24h: price.price_change_24h || 0,
                    price_change_percentage_24h: price.price_change_percentage_24h || 0,
                    market_cap_usd: price.market_cap || 0,
                    volume_24h_usd: price.total_volume || 0,
                    last_updated: firestore_1.Timestamp.now(),
                    source: "coingecko",
                };
                const docRef = this.db
                    .collection("crypto_prices")
                    .doc(price.symbol.toUpperCase());
                batch.set(docRef, priceData);
                logger.info("Prepared price data for batch", {
                    symbol: priceData.symbol,
                    price: priceData.price_usd,
                });
            }
            await batch.commit();
            logger.info("Successfully saved crypto prices to Firestore", {
                count: prices.length,
                timestamp: new Date().toISOString(),
            });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.error("Failed to save crypto prices to Firestore", {
                error: errorMessage,
                stack: errorStack,
            });
            throw error;
        }
    }
    /**
     * Update metadata document with sync status and additional info
     * @param {string} status - Current sync status
     * @param {object} options - Additional metadata options
     * @return {Promise<void>}
     */
    async updateMetadata(status, options = {}) {
        try {
            const metadata = {
                last_sync_timestamp: firestore_1.Timestamp.now(),
                sync_status: status,
                update_frequency_minutes: 5,
                supported_currencies: ["BTC", "ETH", "SOL", "AVAX", "SUI"],
            };
            if (options.errorMessage) {
                metadata.error_message = options.errorMessage;
            }
            if (options.rateLimitRemaining !== undefined) {
                metadata.coingecko_rate_limit_remaining = options.rateLimitRemaining;
            }
            if (options.totalApiCalls !== undefined) {
                metadata.total_api_calls_today = options.totalApiCalls;
                // Usage alert for Demo API
                if (options.totalApiCalls > 8000) {
                    logger.warn("CoinGecko API usage approaching limit", {
                        totalCalls: options.totalApiCalls,
                        limit: 10000,
                        usagePercentage: (options.totalApiCalls / 10000) * 100,
                    });
                }
            }
            await this.db
                .collection("crypto_metadata")
                .doc("config")
                .set(metadata, { merge: true });
            logger.info("Updated metadata", {
                status,
                timestamp: new Date().toISOString(),
            });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logger.error("Failed to update metadata", {
                error: errorMessage,
            });
            // Metadata update failure is not critical, so don't throw
        }
    }
    /**
     * Get the last synchronization timestamp
     * @return {Promise<Date | null>} Last sync time or null if not found
     */
    async getLastSyncTime() {
        var _a;
        try {
            const doc = await this.db
                .collection("crypto_metadata")
                .doc("config")
                .get();
            if (doc.exists) {
                const data = doc.data();
                return ((_a = data.last_sync_timestamp) === null || _a === void 0 ? void 0 : _a.toDate()) || null;
            }
            return null;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logger.warn("Could not get last sync time", { error: errorMessage });
            return null;
        }
    }
    /**
     * Clean up old or unwanted crypto price documents
     * @param {string[]} validSymbols - Array of valid currency symbols to keep
     * @return {Promise<void>}
     */
    async cleanupOldPrices(validSymbols) {
        try {
            const snapshot = await this.db.collection("crypto_prices").get();
            const batch = this.db.batch();
            let deleteCount = 0;
            snapshot.forEach((doc) => {
                if (!validSymbols.includes(doc.id)) {
                    batch.delete(doc.ref);
                    deleteCount++;
                    logger.info("Scheduled for deletion", { symbol: doc.id });
                }
            });
            if (deleteCount > 0) {
                await batch.commit();
                logger.info("Cleaned up old price documents", { deletedCount: deleteCount });
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logger.warn("Failed to cleanup old prices", { error: errorMessage });
        }
    }
}
exports.FirestoreService = FirestoreService;
//# sourceMappingURL=firestoreService.js.map-e 
### FILE: ./lib/crypto/priceUpdater.js

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCryptoPrices = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const logger = __importStar(require("firebase-functions/logger"));
const params_1 = require("firebase-functions/params");
const coinGeckoService_1 = require("../services/coinGeckoService");
const firestoreService_1 = require("../services/firestoreService");
const cryptoConfig_1 = require("../config/cryptoConfig");
// 環境変数定義
const coinGeckoApiKey = (0, params_1.defineString)("COINGECKO_API_KEY", {
    description: "CoinGecko API Key",
    default: "demo",
});
/**
 * 5分間隔で暗号通貨価格を更新するScheduled Function
 */
exports.updateCryptoPrices = (0, scheduler_1.onSchedule)({
    schedule: "*/5 * * * *",
    timeZone: "UTC",
    region: "asia-northeast1",
    memory: "256MiB",
    timeoutSeconds: 300,
    maxInstances: 1,
}, async (event) => {
    const startTime = Date.now();
    const firestoreService = new firestoreService_1.FirestoreService();
    try {
        logger.info("Starting scheduled crypto price update", {
            timestamp: new Date().toISOString(),
            jobName: event.jobName,
            scheduleTime: event.scheduleTime,
            currencies: cryptoConfig_1.CRYPTO_CONFIG.currencies.map((c) => c.symbol),
        });
        // 進行中ステータスに更新
        await firestoreService.updateMetadata("in_progress");
        // CoinGecko API サービス初期化
        const coinGeckoService = new coinGeckoService_1.CoinGeckoService(coinGeckoApiKey.value());
        // API使用状況確認
        const apiUsage = await coinGeckoService.checkApiUsage();
        logger.info("CoinGecko API usage status", {
            remaining: apiUsage.remaining,
            limit: apiUsage.limit,
        });
        // レート制限チェック
        if (apiUsage.remaining < cryptoConfig_1.API_CONFIG.RATE_LIMIT_BUFFER) {
            logger.warn("API rate limit approaching, skipping this update", {
                remaining: apiUsage.remaining,
                buffer: cryptoConfig_1.API_CONFIG.RATE_LIMIT_BUFFER,
            });
            await firestoreService.updateMetadata("error", {
                errorMessage: `Rate limit approaching: ${apiUsage.remaining} calls remaining`,
                rateLimitRemaining: apiUsage.remaining,
            });
            return;
        }
        // 価格データ取得
        const coinIds = cryptoConfig_1.CRYPTO_CONFIG.currencies.map((c) => c.id);
        const prices = await coinGeckoService.getCryptoPrices(coinIds);
        if (prices.length === 0) {
            throw new Error("No price data received from CoinGecko API");
        }
        // Firestoreに保存
        await firestoreService.saveCryptoPrices(prices);
        // 成功ステータスに更新
        await firestoreService.updateMetadata("success", {
            rateLimitRemaining: apiUsage.remaining - 1, // APIコールを1回使用
        });
        const duration = Date.now() - startTime;
        logger.info("Crypto price update completed successfully", {
            duration: `${duration}ms`,
            pricesUpdated: prices.length,
            currencies: prices.map((p) => ({
                symbol: p.symbol.toUpperCase(),
                price: p.current_price,
            })),
        });
    }
    catch (error) {
        const duration = Date.now() - startTime;
        logger.error("Crypto price update failed", {
            error: error.message,
            stack: error.stack,
            duration: `${duration}ms`,
        });
        // エラーステータスに更新
        await firestoreService.updateMetadata("error", {
            errorMessage: error.message,
        });
        // 関数自体は失敗させない（無限リトライを避けるため）
        // throw error;
    }
});
//# sourceMappingURL=priceUpdater.js.map-e 
### FILE: ./lib/crypto/index.js

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCryptoPrices = void 0;
// src/crypto/index.ts
var scheduledUpdate_1 = require("./scheduledUpdate");
Object.defineProperty(exports, "updateCryptoPrices", { enumerable: true, get: function () { return scheduledUpdate_1.updateCryptoPrices; } });
//# sourceMappingURL=index.js.map-e 
### FILE: ./lib/crypto/scheduledUpdate.js

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCryptoPrices = void 0;
// src/crypto/scheduledUpdate.ts
const scheduler_1 = require("firebase-functions/v2/scheduler");
const logger = __importStar(require("firebase-functions/logger"));
const params_1 = require("firebase-functions/params");
const coinGeckoService_1 = require("../services/coinGeckoService");
const firestoreService_1 = require("../services/firestoreService");
const cryptoConfig_1 = require("../config/cryptoConfig");
// 環境変数定義
const coinGeckoApiKey = (0, params_1.defineString)("COINGECKO_API_KEY", {
    description: "CoinGecko API Key",
    default: "demo",
});
/**
 * 5分間隔で暗号通貨価格を更新するScheduled Function
 */
exports.updateCryptoPrices = (0, scheduler_1.onSchedule)({
    schedule: "*/5 * * * *",
    timeZone: "UTC",
    region: "asia-northeast1",
    memory: "256MiB",
    timeoutSeconds: 300,
    maxInstances: 1,
}, async (event) => {
    const startTime = Date.now();
    const firestoreService = new firestoreService_1.FirestoreService();
    try {
        logger.info("Starting scheduled crypto price update", {
            timestamp: new Date().toISOString(),
            jobName: event.jobName,
            scheduleTime: event.scheduleTime,
            currencies: cryptoConfig_1.CRYPTO_CONFIG.currencies.map((c) => c.symbol),
        });
        // 進行中ステータスに更新
        await firestoreService.updateMetadata("in_progress");
        // CoinGecko API サービス初期化
        const coinGeckoService = new coinGeckoService_1.CoinGeckoService(coinGeckoApiKey.value());
        // API使用状況確認
        const apiUsage = await coinGeckoService.checkApiUsage();
        logger.info("CoinGecko API usage status", {
            remaining: apiUsage.remaining,
            limit: apiUsage.limit,
        });
        // レート制限チェック
        if (apiUsage.remaining < cryptoConfig_1.API_CONFIG.RATE_LIMIT_BUFFER) {
            logger.warn("API rate limit approaching, skipping this update", {
                remaining: apiUsage.remaining,
                buffer: cryptoConfig_1.API_CONFIG.RATE_LIMIT_BUFFER,
            });
            await firestoreService.updateMetadata("error", {
                errorMessage: `Rate limit approaching: ${apiUsage.remaining} calls remaining`,
                rateLimitRemaining: apiUsage.remaining,
            });
            return;
        }
        // 価格データ取得
        const coinIds = cryptoConfig_1.CRYPTO_CONFIG.currencies.map((c) => c.id);
        const prices = await coinGeckoService.getCryptoPrices(coinIds);
        if (prices.length === 0) {
            throw new Error("No price data received from CoinGecko API");
        }
        // Firestoreに保存
        await firestoreService.saveCryptoPrices(prices);
        // 成功ステータスに更新
        await firestoreService.updateMetadata("success", {
            rateLimitRemaining: apiUsage.remaining - 1, // APIコールを1回使用
        });
        const duration = Date.now() - startTime;
        logger.info("Crypto price update completed successfully", {
            duration: `${duration}ms`,
            pricesUpdated: prices.length,
            currencies: prices.map((p) => ({
                symbol: p.symbol.toUpperCase(),
                price: p.current_price,
            })),
        });
    }
    catch (error) {
        const duration = Date.now() - startTime;
        logger.error("Crypto price update failed", {
            error: error.message,
            stack: error.stack,
            duration: `${duration}ms`,
        });
        // エラーステータスに更新
        await firestoreService.updateMetadata("error", {
            errorMessage: error.message,
        });
        // 関数自体は失敗させない（無限リトライを避けるため）
        // throw error;
    }
});
//# sourceMappingURL=scheduledUpdate.js.map-e 
### FILE: ./lib/openlogiSync/index.js

"use strict";
//# sourceMappingURL=index.js.map-e 
### FILE: ./lib/inventory/index.js

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthCheck = exports.getInventory = exports.syncWithOpenLogi = exports.updateInventory = void 0;
// src/inventory/index.ts
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const logger = __importStar(require("firebase-functions/logger"));
const openlogiService_1 = require("../openlogi/openlogiService");
const inventoryService_1 = require("../openlogi/inventoryService");
// Secret Manager から設定を取得
const openlogiApiKey = (0, params_1.defineSecret)("OPENLOGI_API_KEY");
const openlogiBaseUrl = (0, params_1.defineSecret)("OPENLOGI_BASE_URL");
/**
 * 在庫手動更新API
 * POST /updateInventory
 * Body: { productId: string, stock: number }
 */
exports.updateInventory = (0, https_1.onRequest)({
    secrets: [openlogiApiKey, openlogiBaseUrl],
    cors: true,
}, async (request, response) => {
    try {
        // POSTメソッドのみ許可
        if (request.method !== "POST") {
            response.status(405).json({
                success: false,
                error: "Method not allowed. Use POST."
            });
            return;
        }
        const body = request.body;
        logger.info("Update inventory request received", {
            productId: body.productId,
            stock: body.stock,
        });
        // サービス初期化
        const openlogiService = new openlogiService_1.OpenlogiService(openlogiBaseUrl.value(), openlogiApiKey.value());
        const inventoryService = new inventoryService_1.InventoryService(openlogiService);
        // 在庫更新実行
        const result = await inventoryService.updateInventory(body);
        if (result.success) {
            response.status(200).json(result);
        }
        else {
            response.status(400).json(result);
        }
    }
    catch (error) {
        logger.error("Update inventory endpoint error", {
            error: error.message,
            stack: error.stack,
        });
        response.status(500).json({
            success: false,
            error: "Internal server error",
        });
    }
});
/**
 * OpenLogi在庫同期API
 * POST /syncWithOpenLogi
 * Body: { productId: string }
 */
exports.syncWithOpenLogi = (0, https_1.onRequest)({
    secrets: [openlogiApiKey, openlogiBaseUrl],
    cors: true,
}, async (request, response) => {
    try {
        // POSTメソッドのみ許可
        if (request.method !== "POST") {
            response.status(405).json({
                success: false,
                error: "Method not allowed. Use POST."
            });
            return;
        }
        const body = request.body;
        logger.info("Sync with OpenLogi request received", {
            productId: body.productId,
        });
        // サービス初期化
        const openlogiService = new openlogiService_1.OpenlogiService(openlogiBaseUrl.value(), openlogiApiKey.value());
        const inventoryService = new inventoryService_1.InventoryService(openlogiService);
        // 同期実行
        const result = await inventoryService.syncWithOpenLogi(body);
        if (result.success) {
            response.status(200).json(result);
        }
        else {
            response.status(400).json(result);
        }
    }
    catch (error) {
        logger.error("Sync with OpenLogi endpoint error", {
            error: error.message,
            stack: error.stack,
        });
        response.status(500).json({
            success: false,
            error: "Internal server error",
        });
    }
});
/**
 * 在庫情報取得API
 * GET /getInventory?productId=xxx
 */
exports.getInventory = (0, https_1.onRequest)({
    secrets: [openlogiApiKey, openlogiBaseUrl],
    cors: true,
}, async (request, response) => {
    try {
        // GETメソッドのみ許可
        if (request.method !== "GET") {
            response.status(405).json({
                success: false,
                error: "Method not allowed. Use GET."
            });
            return;
        }
        const productId = request.query.productId;
        if (!productId) {
            response.status(400).json({
                success: false,
                error: "productId query parameter required",
            });
            return;
        }
        logger.info("Get inventory request received", {
            productId,
        });
        // サービス初期化
        const openlogiService = new openlogiService_1.OpenlogiService(openlogiBaseUrl.value(), openlogiApiKey.value());
        const inventoryService = new inventoryService_1.InventoryService(openlogiService);
        // 在庫取得実行
        const result = await inventoryService.getInventory(productId);
        if (result.success) {
            response.status(200).json(result);
        }
        else {
            response.status(400).json(result);
        }
    }
    catch (error) {
        logger.error("Get inventory endpoint error", {
            error: error.message,
            stack: error.stack,
        });
        response.status(500).json({
            success: false,
            error: "Internal server error",
        });
    }
});
/**
 * OpenLogi API疎通確認
 * GET /healthCheck
 */
exports.healthCheck = (0, https_1.onRequest)({
    secrets: [openlogiApiKey, openlogiBaseUrl],
    cors: true,
}, async (request, response) => {
    try {
        logger.info("Health check request received");
        // サービス初期化
        const openlogiService = new openlogiService_1.OpenlogiService(openlogiBaseUrl.value(), openlogiApiKey.value());
        // 疎通確認実行
        const isHealthy = await openlogiService.healthCheck();
        response.status(200).json({
            success: true,
            message: "Health check completed",
            data: {
                openlogiApi: isHealthy ? "healthy" : "unhealthy",
                timestamp: new Date().toISOString(),
            },
        });
    }
    catch (error) {
        logger.error("Health check endpoint error", {
            error: error.message,
        });
        response.status(500).json({
            success: false,
            error: "Internal server error",
            data: {
                openlogiApi: "error",
                timestamp: new Date().toISOString(),
            },
        });
    }
});
//# sourceMappingURL=index.js.map-e 
### FILE: ./lib/types.js

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map-e 
### FILE: ./lib/index.js

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testOpenLogiShipment = exports.simpleOpenLogiTest = exports.testOpenLogiConnection = exports.testOpenLogiAPIIntegration = exports.testOpenLogiDataConversion = exports.updateCryptoPrices = exports.opennodeWebhookSecure = void 0;
// Firebase Admin初期化（最初に実行される）
require("./shared/config/firebase");
// 各機能モジュールからエクスポート
var opennode_1 = require("./webhook/opennode");
Object.defineProperty(exports, "opennodeWebhookSecure", { enumerable: true, get: function () { return opennode_1.opennodeWebhookSecure; } });
var priceUpdater_1 = require("./crypto/priceUpdater");
Object.defineProperty(exports, "updateCryptoPrices", { enumerable: true, get: function () { return priceUpdater_1.updateCryptoPrices; } });
// 🆕 OpenLogi テスト関数エクスポート
var dataConverter_1 = require("./testing/dataConverter");
Object.defineProperty(exports, "testOpenLogiDataConversion", { enumerable: true, get: function () { return dataConverter_1.testOpenLogiDataConversion; } });
/*

curl -X POST \
  https://testopenlogidataconversion-spcu6fqyiq-an.a.run.app \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceId": "365130d0-9cd2-4a51-9a8e-68eae4151b4f"
  }'

*/
// 🆕 Phase2: OpenLogi API統合テスト関数エクスポート
var apiIntegration_1 = require("./testing/apiIntegration");
Object.defineProperty(exports, "testOpenLogiAPIIntegration", { enumerable: true, get: function () { return apiIntegration_1.testOpenLogiAPIIntegration; } });
Object.defineProperty(exports, "testOpenLogiConnection", { enumerable: true, get: function () { return apiIntegration_1.testOpenLogiConnection; } });
/*
curl -X POST https://testopenlogiconnection-spcu6fqyiq-an.a.run.app

curl -X POST \
  https://testopenlogiapiintegration-spcu6fqyiq-an.a.run.app \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceId": "365130d0-9cd2-4a51-9a8e-68eae4151b4f",
    "dryRun": false,
    "includeDebugInfo": true
  }'

curl -X GET \
  https://api-demo.openlogi.com/api/items \
  -H "Content-Type: application/json" \
  -H "X-Api-Version: 1.5" \
  -H "Authorization: eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiMGE1OTRkM2Q0Y2IwYWY5NTMzNjkzNTU5NjY0M2I1NjllYTdiZjk4NjAxNDY5MDNlNTg0ODBiOTZkYmM1MTJmZDBlYWUxY2NkNGNkYmZkOWQiLCJpYXQiOjE3NDk1MTc4MzcuNzg2MDU0LCJuYmYiOjE3NDk1MTc4MzcuNzg2MDU3LCJleHAiOjE3ODEwNTM4MzcuNzU3MjkzLCJzdWIiOiJkMjVmNTUwNi1jNzNiLTQyOTQtOGQ4Ny0zYzNkZWUyYTU5N2QiLCJzY29wZXMiOltdfQ.Ge3Mqqp-r44aZYeCg3S_NbF4_UKG1xnQjlkco7cOfjPCsxnJTFWrWrvsnCuGtZHHrAkTY3SFjUOIwt_eGeSJ8D9rhS-y8j4XKQVVaEOLta-GCunQwH26Wx3pUJVZ3YMFiq0-ao0QZi9iGopOj5W9OEIzu5w0HRqWJ4C3W0IgClVLax7nYT_3Jx9RG3DjUg57gr9v1iJ1qj6J3sOMR8_TtSr4CZwkIetGzObk6ZELYS1T1_mbiGs74EwqqilmqZk_1_I4vBvdFLjaBT6EYyQ4JmDZ1ljPGTLy7c8AGXBz8Um3lpyHvv4jJw5XO0ziIHYMKb6Z6cVdHUWduPtrxsfWTib-i-jqbF0PQudSz-So4VhwvvJO1DgSkqRSq67eqVqDGcBsxn8SqQgj6Z9aarBEg-9Y2wL8Sn_I2YqSG9IqIcePq_TARSnGiaAvTPF88_FaIHjcbQZegfG3m9Zy1Zu4dBuOvW_MG4TU9kSxLByIGoNrqDylCtybz8O5WhdRd8XdHw2RwpPc_1ZB79yM-FGfo832tgHCrBZzdG2gqSJbnCe4x6aHg81mDUrzEglCBdco8REgRvvBiked6bQTx8NaU6wc38TD5LblZ7feW_V3Kq6sAbSfXW87ZRGpJ-zbCSWq43EheMh8iLTNowO9jO5vqpvyB14xh5-umGm5iQrz674" \
  -v

*/
var simpleConnectionTest_1 = require("./testing/simpleConnectionTest");
Object.defineProperty(exports, "simpleOpenLogiTest", { enumerable: true, get: function () { return simpleConnectionTest_1.simpleOpenLogiTest; } });
//npx firebase deploy --only functions:simpleOpenLogiTest
//curl -X POST https://simpleopenlogitest-spcu6fqyiq-an.a.run.app
var openLogiShipmentTest_1 = require("./testing/openLogiShipmentTest");
Object.defineProperty(exports, "testOpenLogiShipment", { enumerable: true, get: function () { return openLogiShipmentTest_1.testOpenLogiShipment; } });
//npx firebase deploy --only functions:testOpenLogiShipment
//curl -X POST https://testopenlogishipment-spcu6fqyiq-an.a.run.app
//# sourceMappingURL=index.js.map-e 
### FILE: ./lib/config/cryptoConfig.js

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.API_CONFIG = exports.CRYPTO_CONFIG = void 0;
exports.CRYPTO_CONFIG = {
    currencies: [
        {
            id: "bitcoin",
            symbol: "BTC",
            name: "Bitcoin",
        },
        {
            id: "ethereum",
            symbol: "ETH",
            name: "Ethereum",
        },
        {
            id: "solana",
            symbol: "SOL",
            name: "Solana",
        },
        {
            id: "avalanche",
            symbol: "AVAX",
            name: "Avalanche",
        },
        {
            id: "sui",
            symbol: "SUI",
            name: "Sui",
        },
    ],
};
exports.API_CONFIG = {
    UPDATE_INTERVAL_MINUTES: 5,
    TIMEOUT_SECONDS: 30,
    MAX_RETRIES: 2,
    RATE_LIMIT_BUFFER: 5,
    DEMO_API_MONTHLY_LIMIT: 10000,
    DEMO_API_RATE_LIMIT_PER_MINUTE: 30,
    MONTHLY_USAGE_ALERT_THRESHOLD: 8000,
    EMERGENCY_FALLBACK_INTERVAL: 30,
};
//# sourceMappingURL=cryptoConfig.js.map-e 
### FILE: ./lib/openlogi/types.js

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map-e 
### FILE: ./lib/openlogi/inventoryService.js

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryService = void 0;
// src/openlogi/inventoryService.ts
const firestore_1 = require("firebase-admin/firestore");
const logger = __importStar(require("firebase-functions/logger"));
class InventoryService {
    constructor(openlogiService) {
        this.firestore = (0, firestore_1.getFirestore)();
        this.openlogiService = openlogiService;
    }
    /**
     * 在庫を手動更新
     */
    async updateInventory(request) {
        try {
            const { productId, stock } = request;
            // バリデーション
            if (!productId || typeof stock !== 'number' || stock < 0) {
                throw new Error("Invalid request: productId required and stock must be non-negative number");
            }
            logger.info("Updating inventory", { productId, stock });
            // Firestoreから商品情報取得
            const productRef = this.firestore.collection('product').doc(productId);
            const productDoc = await productRef.get();
            if (!productDoc.exists) {
                throw new Error(`Product not found: ${productId}`);
            }
            // 在庫情報更新
            const updateData = {
                stock: stock,
                'physicalStock.total': stock,
                'physicalStock.available': stock,
                'physicalStock.lastSynced': firestore_1.Timestamp.now(),
                updatedAt: firestore_1.Timestamp.now(),
            };
            await productRef.update(updateData);
            // 更新後の情報を取得
            const updatedDoc = await productRef.get();
            const updatedProduct = updatedDoc.data();
            logger.info("Inventory updated successfully", {
                productId,
                physicalStock: updatedProduct.physicalStock,
            });
            return {
                success: true,
                message: "Inventory updated successfully",
                data: {
                    productId,
                    physicalStock: {
                        total: updatedProduct.physicalStock.total,
                        available: updatedProduct.physicalStock.available,
                        shipping: updatedProduct.physicalStock.shipping,
                        requesting: updatedProduct.physicalStock.requesting,
                        lastSynced: updatedProduct.physicalStock.lastSynced.toDate().toISOString(),
                    },
                },
            };
        }
        catch (error) {
            logger.error("Update inventory failed", {
                error: error.message,
                request,
            });
            return {
                success: false,
                error: error.message,
            };
        }
    }
    /**
     * OpenLogiと在庫同期
     */
    async syncWithOpenLogi(request) {
        var _a;
        try {
            const { productId } = request;
            if (!productId) {
                throw new Error("Invalid request: productId required");
            }
            logger.info("Syncing inventory with OpenLogi", { productId });
            // Firestoreから商品情報取得
            const productRef = this.firestore.collection('product').doc(productId);
            const productDoc = await productRef.get();
            if (!productDoc.exists) {
                throw new Error(`Product not found: ${productId}`);
            }
            const product = productDoc.data();
            // 同期状態を「進行中」に更新
            await productRef.update({
                'openLogi.syncStatus': 'in_progress',
                'openLogi.lastSynced': firestore_1.Timestamp.now(),
            });
            let openlogiItem;
            try {
                // OpenLogiから在庫情報取得
                if ((_a = product.registration) === null || _a === void 0 ? void 0 : _a.code) {
                    // 商品コードが設定されている場合
                    // アカウントIDは設定から取得する想定（ここでは仮値）
                    const accountId = "your-account-id"; // 実際は環境変数等から取得
                    openlogiItem = await this.openlogiService.getItemByCode(accountId, product.registration.code);
                }
                else if (product.id) {
                    // 商品IDで取得
                    openlogiItem = await this.openlogiService.getItemById(product.id);
                }
                else {
                    throw new Error("No OpenLogi identifier found");
                }
                if (!openlogiItem.stock) {
                    throw new Error("No stock information from OpenLogi");
                }
                // Firestoreの在庫情報を更新
                const updateData = {
                    'physicalStock.total': openlogiItem.stock.quantity,
                    'physicalStock.available': openlogiItem.stock.available,
                    'physicalStock.shipping': openlogiItem.stock.shipping,
                    'physicalStock.requesting': openlogiItem.stock.requesting,
                    'physicalStock.lastSynced': firestore_1.Timestamp.now(),
                    'openLogi.syncStatus': 'success',
                    'openLogi.lastSynced': firestore_1.Timestamp.now(),
                    'openLogi.errorMessage': null,
                    stock: openlogiItem.stock.available,
                    updatedAt: firestore_1.Timestamp.now(),
                };
                await productRef.update(updateData);
                logger.info("Inventory synced successfully", {
                    productId,
                    openlogiStock: openlogiItem.stock,
                });
                return {
                    success: true,
                    message: "Inventory synced with OpenLogi successfully",
                    data: {
                        productId,
                        physicalStock: {
                            total: openlogiItem.stock.quantity,
                            available: openlogiItem.stock.available,
                            shipping: openlogiItem.stock.shipping,
                            requesting: openlogiItem.stock.requesting,
                            lastSynced: new Date().toISOString(),
                        },
                    },
                };
            }
            catch (openlogiError) {
                // OpenLogi APIエラーの場合、同期状態をエラーに更新
                await productRef.update({
                    'openLogi.syncStatus': 'error',
                    'openLogi.errorMessage': openlogiError.message,
                    'openLogi.lastSynced': firestore_1.Timestamp.now(),
                });
                throw openlogiError;
            }
        }
        catch (error) {
            logger.error("Sync with OpenLogi failed", {
                error: error.message,
                request,
            });
            return {
                success: false,
                error: error.message,
            };
        }
    }
    /**
     * 商品の在庫情報取得
     */
    async getInventory(productId) {
        try {
            if (!productId) {
                throw new Error("Invalid request: productId required");
            }
            logger.info("Getting inventory", { productId });
            const productRef = this.firestore.collection('product').doc(productId);
            const productDoc = await productRef.get();
            if (!productDoc.exists) {
                throw new Error(`Product not found: ${productId}`);
            }
            const product = productDoc.data();
            return {
                success: true,
                data: {
                    productId,
                    physicalStock: {
                        total: product.physicalStock.total,
                        available: product.physicalStock.available,
                        shipping: product.physicalStock.shipping,
                        requesting: product.physicalStock.requesting,
                        lastSynced: product.physicalStock.lastSynced.toDate().toISOString(),
                    },
                },
            };
        }
        catch (error) {
            logger.error("Get inventory failed", {
                error: error.message,
                productId,
            });
            return {
                success: false,
                error: error.message,
            };
        }
    }
}
exports.InventoryService = InventoryService;
//# sourceMappingURL=inventoryService.js.map-e 
### FILE: ./lib/openlogi/openlogiService.js

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenlogiService = void 0;
// src/openlogi/openlogiService.ts
const axios_1 = __importDefault(require("axios"));
const logger = __importStar(require("firebase-functions/logger"));
class OpenlogiService {
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }
    /**
     * 商品情報を取得（在庫情報含む）
     */
    async getItemById(itemId) {
        var _a, _b, _c;
        try {
            const url = `${this.baseUrl}/api/items/${itemId}`;
            logger.info("Fetching item from OpenLogi", {
                url,
                itemId,
            });
            const response = await axios_1.default.get(url, {
                headers: this.getHeaders(),
                params: {
                    stock: 1, // 在庫情報を含める
                },
                timeout: 30000,
            });
            logger.info("OpenLogi API response received", {
                statusCode: response.status,
                itemId: response.data.id,
                stock: response.data.stock,
            });
            return response.data;
        }
        catch (error) {
            logger.error("OpenLogi API error", {
                error: error.message,
                status: (_a = error.response) === null || _a === void 0 ? void 0 : _a.status,
                statusText: (_b = error.response) === null || _b === void 0 ? void 0 : _b.statusText,
                data: (_c = error.response) === null || _c === void 0 ? void 0 : _c.data,
                itemId,
            });
            throw new Error(`OpenLogi API failed: ${error.message}`);
        }
    }
    /**
     * 商品コードで商品情報を取得
     */
    async getItemByCode(accountId, code) {
        var _a, _b, _c;
        try {
            const url = `${this.baseUrl}/api/items/${accountId}/${code}`;
            logger.info("Fetching item by code from OpenLogi", {
                url,
                accountId,
                code,
            });
            const response = await axios_1.default.get(url, {
                headers: this.getHeaders(),
                params: {
                    stock: 1, // 在庫情報を含める
                },
                timeout: 30000,
            });
            logger.info("OpenLogi API response received", {
                statusCode: response.status,
                itemId: response.data.id,
                code: response.data.code,
                stock: response.data.stock,
            });
            return response.data;
        }
        catch (error) {
            logger.error("OpenLogi API error", {
                error: error.message,
                status: (_a = error.response) === null || _a === void 0 ? void 0 : _a.status,
                statusText: (_b = error.response) === null || _b === void 0 ? void 0 : _b.statusText,
                data: (_c = error.response) === null || _c === void 0 ? void 0 : _c.data,
                accountId,
                code,
            });
            throw new Error(`OpenLogi API failed: ${error.message}`);
        }
    }
    /**
     * 商品を登録
     */
    async createItem(item) {
        var _a, _b, _c;
        try {
            const url = `${this.baseUrl}/api/items`;
            logger.info("Creating item in OpenLogi", {
                url,
                code: item.code,
            });
            const response = await axios_1.default.post(url, item, {
                headers: this.getHeaders(),
                timeout: 30000,
            });
            logger.info("OpenLogi item created", {
                statusCode: response.status,
                itemId: response.data.id,
                code: response.data.code,
            });
            return response.data;
        }
        catch (error) {
            logger.error("OpenLogi create item error", {
                error: error.message,
                status: (_a = error.response) === null || _a === void 0 ? void 0 : _a.status,
                statusText: (_b = error.response) === null || _b === void 0 ? void 0 : _b.statusText,
                data: (_c = error.response) === null || _c === void 0 ? void 0 : _c.data,
                item,
            });
            throw new Error(`OpenLogi create item failed: ${error.message}`);
        }
    }
    /**
     * 共通ヘッダーを生成
     */
    getHeaders() {
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Api-Version": "1.5",
            "Authorization": `Bearer ${this.apiKey}`,
            "User-Agent": "we-are-onchain-gcf/1.0.0",
        };
    }
    /**
     * APIの疎通確認
     */
    async healthCheck() {
        var _a, _b, _c;
        try {
            // 商品一覧を空で取得してAPI疎通確認
            const url = `${this.baseUrl}/api/items`;
            await axios_1.default.get(url, {
                headers: this.getHeaders(),
                params: {
                    id: "test", // 存在しないIDで疎通確認
                },
                timeout: 10000,
            });
            return true;
        }
        catch (error) {
            logger.warn("OpenLogi health check failed", {
                error: error.message,
                status: (_a = error.response) === null || _a === void 0 ? void 0 : _a.status,
            });
            // 400番台エラーなら接続はOK
            if (((_b = error.response) === null || _b === void 0 ? void 0 : _b.status) >= 400 && ((_c = error.response) === null || _c === void 0 ? void 0 : _c.status) < 500) {
                return true;
            }
            return false;
        }
    }
}
exports.OpenlogiService = OpenlogiService;
//# sourceMappingURL=openlogiService.js.map-e 
### FILE: ./lib/utils/paymentHelpers.js

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateInvoiceStatus = exports.processPaymentExpired = exports.processPaymentSuccess = void 0;
// src/utils/paymentHelpers.ts
const firestore_1 = require("firebase-admin/firestore");
const logger = __importStar(require("firebase-functions/logger"));
const db = (0, firestore_1.getFirestore)();
/**
 * 支払い成功処理
 */
async function processPaymentSuccess(invoiceId, webhookData) {
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
            if (invoiceData === null || invoiceData === void 0 ? void 0 : invoiceData.userId) {
                await db.doc(`users/${invoiceData.userId}`).update({
                    cart: [],
                    lastPurchaseAt: new Date(),
                });
                logger.info("User cart cleared after payment", {
                    userId: invoiceData.userId,
                    invoiceId,
                });
            }
        }
        else {
            logger.warn("Invoice not found for payment processing", {
                invoiceId,
            });
        }
    }
    catch (error) {
        logger.error("Payment success processing failed", {
            invoiceId,
            error: error.message,
        });
        throw error;
    }
}
exports.processPaymentSuccess = processPaymentSuccess;
/**
 * 支払い期限切れ処理
 */
async function processPaymentExpired(invoiceId, webhookData) {
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
    }
    catch (error) {
        logger.error("Payment expiry processing failed", {
            invoiceId,
            error: error.message,
        });
        throw error;
    }
}
exports.processPaymentExpired = processPaymentExpired;
/**
 * Invoice ステータス更新
 */
async function updateInvoiceStatus(invoiceId, status, webhookData) {
    try {
        const invoiceRef = db.collection("invoices").doc(invoiceId);
        await invoiceRef.update({
            status,
            webhook_data: webhookData,
            updatedAt: new Date(),
        });
    }
    catch (error) {
        logger.error("Invoice status update failed", {
            invoiceId,
            status,
            error: error.message,
        });
        throw error;
    }
}
exports.updateInvoiceStatus = updateInvoiceStatus;
//# sourceMappingURL=paymentHelpers.js.map-e 
### FILE: ./lib/testing/apiIntegration.js

"use strict";
// src/testing/apiIntegration.ts
// OpenLogi API統合テスト関数（Demo環境対応・完全版）
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testOpenLogiConnection = exports.testOpenLogiAPIIntegration = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const admin = __importStar(require("firebase-admin"));
const openlogiConverter_1 = require("../shared/utils/openlogiConverter");
const openlogiClient_1 = require("../shared/utils/openlogiClient");
const openlogiConfig_1 = require("../shared/config/openlogiConfig");
/**
 * OpenLogi API統合テスト関数（Demo環境対応）
 * Phase1の変換結果を使用してOpenLogi Demo APIに実際にリクエストを送信
 */
exports.testOpenLogiAPIIntegration = (0, https_1.onRequest)({
    region: "asia-northeast1",
    memory: "512MiB",
    timeoutSeconds: 120,
    cors: true,
}, async (request, response) => {
    var _a, _b, _c;
    const startTime = Date.now();
    let invoiceId;
    try {
        // POSTメソッドのみ受け付け
        if (request.method !== "POST") {
            response.status(405).json({
                success: false,
                error: "API_INTEGRATION_ERROR",
                message: "Only POST method is allowed",
                timestamp: new Date().toISOString()
            });
            return;
        }
        logger.info("OpenLogi API integration test started (Demo environment)", {
            method: request.method,
            timestamp: new Date().toISOString(),
            userAgent: request.get("User-Agent"),
            apiBaseUrl: openlogiConfig_1.OPENLOGI_API_CONFIG.BASE_URL,
            apiVersion: openlogiConfig_1.OPENLOGI_API_CONFIG.API_VERSION
        });
        // リクエストパラメータ取得
        const { invoiceId: reqInvoiceId, useRealtimeConversion = true, dryRun = false, includeDebugInfo = false } = request.body;
        invoiceId = reqInvoiceId;
        // 入力バリデーション
        if (!invoiceId || typeof invoiceId !== 'string') {
            const errorResponse = {
                success: false,
                error: "INVALID_INPUT",
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
        let openlogiPayload;
        let conversionMetadata;
        if (useRealtimeConversion) {
            // リアルタイム変換
            logger.info("Using realtime conversion", { invoiceId });
            // Invoice データ取得
            const invoiceDoc = await admin.firestore()
                .collection('invoices')
                .doc(invoiceId)
                .get();
            if (!invoiceDoc.exists) {
                throw new Error(openlogiConfig_1.ERROR_MESSAGES.INVOICE_NOT_FOUND);
            }
            const invoiceData = invoiceDoc.data();
            // User データ取得
            if (!(invoiceData === null || invoiceData === void 0 ? void 0 : invoiceData.userId)) {
                throw new Error("Missing userId in invoice data");
            }
            const userDoc = await admin.firestore()
                .collection('users')
                .doc(invoiceData.userId)
                .get();
            if (!userDoc.exists) {
                throw new Error(openlogiConfig_1.ERROR_MESSAGES.USER_NOT_FOUND);
            }
            const userData = userDoc.data();
            // デフォルト住所特定
            const userAddresses = (userData === null || userData === void 0 ? void 0 : userData.address) || [];
            const defaultAddress = userAddresses.find((addr) => addr.isDefault);
            if (!defaultAddress) {
                throw new Error(`Default address not found for user: ${invoiceData.userId}`);
            }
            // OpenLogi 形式に変換
            openlogiPayload = (0, openlogiConverter_1.convertToOpenLogiFormat)(invoiceData, defaultAddress);
            conversionMetadata = (0, openlogiConverter_1.generateConversionMetadata)(invoiceData, defaultAddress, startTime);
            logger.info("Realtime conversion completed", {
                invoiceId,
                shippingType: conversionMetadata.shippingType,
                itemCount: conversionMetadata.itemCount,
                totalAmountJPY: openlogiPayload.total_amount
            });
        }
        else {
            // 事前変換データを使用する場合（将来的にテストコレクションから取得）
            throw new Error("Pre-converted data usage not implemented yet. Use useRealtimeConversion: true");
        }
        // Dry Run チェック
        let apiResult;
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
        }
        else {
            logger.info("Making actual OpenLogi Demo API call", {
                invoiceId,
                endpoint: openlogiConfig_1.OPENLOGI_API_CONFIG.BASE_URL + openlogiConfig_1.OPENLOGI_API_CONFIG.ENDPOINTS.SHIPMENTS
            });
            // 実際のAPI呼び出し
            apiResult = await (0, openlogiClient_1.createOpenLogiShipment)(openlogiPayload);
        }
        const totalProcessingTime = Date.now() - startTime;
        if (apiResult.success) {
            logger.info("API integration test completed successfully", {
                invoiceId,
                dryRun,
                shipmentId: (_a = apiResult.data) === null || _a === void 0 ? void 0 : _a.id,
                totalProcessingTime: `${totalProcessingTime}ms`,
                apiProcessingTime: apiResult.processingTime,
                environment: "Demo"
            });
            const successResponse = {
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
                    debugMode: (0, openlogiConfig_1.isDebugMode)(),
                    environment: "Demo",
                    apiEndpoint: openlogiConfig_1.OPENLOGI_API_CONFIG.BASE_URL + openlogiConfig_1.OPENLOGI_API_CONFIG.ENDPOINTS.SHIPMENTS,
                    apiVersion: openlogiConfig_1.OPENLOGI_API_CONFIG.API_VERSION
                } : undefined,
                timestamp: new Date().toISOString()
            };
            response.status(200).json(successResponse);
        }
        else {
            // API呼び出し失敗
            logger.error("OpenLogi Demo API call failed", {
                invoiceId,
                apiError: apiResult.error,
                totalProcessingTime: `${totalProcessingTime}ms`,
                environment: "Demo"
            });
            const apiErrorResponse = {
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
                    debugMode: (0, openlogiConfig_1.isDebugMode)(),
                    apiError: apiResult.error,
                    environment: "Demo",
                    apiEndpoint: openlogiConfig_1.OPENLOGI_API_CONFIG.BASE_URL + openlogiConfig_1.OPENLOGI_API_CONFIG.ENDPOINTS.SHIPMENTS
                } : undefined,
                timestamp: new Date().toISOString()
            };
            // API エラーの種類に応じてHTTPステータスコード決定
            const statusCode = ((_b = apiResult.error) === null || _b === void 0 ? void 0 : _b.type) === 'AUTH_ERROR' ? 401 :
                ((_c = apiResult.error) === null || _c === void 0 ? void 0 : _c.type) === 'VALIDATION_ERROR' ? 400 : 500;
            response.status(statusCode).json(apiErrorResponse);
        }
    }
    catch (error) {
        const totalProcessingTime = Date.now() - startTime;
        logger.error("API integration test failed", {
            invoiceId,
            error: error.message,
            stack: error.stack,
            totalProcessingTime: `${totalProcessingTime}ms`,
            environment: "Demo"
        });
        // エラーの種類を判定
        let errorType = "API_INTEGRATION_ERROR";
        const errorMessage = error.message.toLowerCase();
        if (errorMessage.includes("invoice not found")) {
            errorType = "INVOICE_NOT_FOUND";
        }
        else if (errorMessage.includes("user") && errorMessage.includes("not found")) {
            errorType = "USER_NOT_FOUND";
        }
        else if (errorMessage.includes("address") || errorMessage.includes("recipient")) {
            errorType = "ADDRESS_INVALID";
        }
        else if (errorMessage.includes("conversion")) {
            errorType = "CONVERSION_FAILED";
        }
        else if (errorMessage.includes("firestore")) {
            errorType = "FIRESTORE_ERROR";
        }
        const errorResponse = {
            success: false,
            invoiceId,
            error: errorType,
            message: error.message,
            details: (0, openlogiConfig_1.isDebugMode)() ? {
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
        }
        else if (errorType === "ADDRESS_INVALID") {
            statusCode = 400;
        }
        response.status(statusCode).json(errorResponse);
    }
});
/**
 * OpenLogi API接続テスト関数（Demo環境対応）
 */
exports.testOpenLogiConnection = (0, https_1.onRequest)({
    region: "asia-northeast1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true,
}, async (request, response) => {
    try {
        logger.info("OpenLogi connection test started (Demo environment)", {
            apiBaseUrl: openlogiConfig_1.OPENLOGI_API_CONFIG.BASE_URL,
            apiVersion: openlogiConfig_1.OPENLOGI_API_CONFIG.API_VERSION
        });
        const connectionResult = await (0, openlogiClient_1.checkOpenLogiConnection)();
        const responseData = {
            success: connectionResult.success,
            message: connectionResult.message,
            details: Object.assign(Object.assign({}, connectionResult.details), { environment: "Demo", apiEndpoint: openlogiConfig_1.OPENLOGI_API_CONFIG.BASE_URL, apiVersion: openlogiConfig_1.OPENLOGI_API_CONFIG.API_VERSION }),
            timestamp: new Date().toISOString()
        };
        response.status(connectionResult.success ? 200 : 500).json(responseData);
    }
    catch (error) {
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
//# sourceMappingURL=apiIntegration.js.map-e 
### FILE: ./lib/testing/openLogiShipmentTest.js

"use strict";
// src/testing/openLogiShipmentTest.ts
// OpenLogi出荷依頼API呼び出しテスト
Object.defineProperty(exports, "__esModule", { value: true });
exports.testOpenLogiShipment = void 0;
const https_1 = require("firebase-functions/v2/https");
/**
 * OpenLogi出荷依頼API呼び出しテスト
 */
exports.testOpenLogiShipment = (0, https_1.onRequest)({
    region: "asia-northeast1",
    memory: "256MiB",
    timeoutSeconds: 60,
    cors: true,
}, async (request, response) => {
    try {
        // 🔑 APIキー（テスト環境用）
        const API_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiMGE1OTRkM2Q0Y2IwYWY5NTMzNjkzNTU5NjY0M2I1NjllYTdiZjk4NjAxNDY5MDNlNTg0ODBiOTZkYmM1MTJmZDBlYWUxY2NkNGNkYmZkOWQiLCJpYXQiOjE3NDk1MTc4MzcuNzg2MDU0LCJuYmYiOjE3NDk1MTc4MzcuNzg2MDU3LCJleHAiOjE3ODEwNTM4MzcuNzU3MjkzLCJzdWIiOiJkMjVmNTUwNi1jNzNiLTQyOTQtOGQ4Ny0zYzNkZWUyYTU5N2QiLCJzY29wZXMiOltdfQ.Ge3Mqqp-r44aZYeCg3S_NbF4_UKG1xnQjlkco7cOfjPCsxnJTFWrWrvsnCuGtZHHrAkTY3SFjUOIwt_eGeSJ8D9rhS-y8j4XKQVVaEOLta-GCunQwH26Wx3pUJVZ3YMFiq0-ao0QZi9iGopOj5W9OEIzu5w0HRqWJ4C3W0IgClVLax7nYT_3Jx9RG3DjUg57gr9v1iJ1qj6J3sOMR8_TtSr4CZwkIetGzObk6ZELYS1T1_mbiGs74EwqqilmqZk_1_I4vBvdFLjaBT6EYyQ4JmDZ1ljPGTLy7c8AGXBz8Um3lpyHvv4jJw5XO0ziIHYMKb6Z6cVdHUWduPtrxsfWTib-i-jqbF0PQudSz-So4VhwvvJO1DgSkqRSq67eqVqDGcBsxn8SqQgj6Z9aarBEg-9Y2wL8Sn_I2YqSG9IqIcePq_TARSnGiaAvTPF88_FaIHjcbQZegfG3m9Zy1Zu4dBuOvW_MG4TU9kSxLByIGoNrqDylCtybz8O5WhdRd8XdHw2RwpPc_1ZB79yM-FGfo832tgHCrBZzdG2gqSJbnCe4x6aHg81mDUrzEglCBdco8REgRvvBiked6bQTx8NaU6wc38TD5LblZ7feW_V3Kq6sAbSfXW87ZRGpJ-zbCSWq43EheMh8iLTNowO9jO5vqpvyB14xh5-umGm5iQrz674";
        // 🎯 OpenLogi出荷依頼APIエンドポイント
        const apiUrl = "https://api-demo.openlogi.com/api/shipments";
        // 📦 ハードコードされた出荷依頼データ
        const shipmentPayload = {
            // 🔑 基本情報
            "identifier": "365130d0-9cd2-4a51-9a8e-68eae4151b4",
            "order_no": "session_mbosyus8_fx9fe22dgpm",
            // 💰 金額情報
            "subtotal_amount": 30,
            "delivery_charge": 15,
            "handling_charge": 0,
            "discount_amount": 0,
            "total_amount": 45,
            // 🎁 梱包・ラッピング
            "cushioning_unit": "ORDER",
            "cushioning_type": "BUBBLE_PACK",
            "gift_wrapping_unit": null,
            "gift_wrapping_type": null,
            // "gift_sender_name": null,        // 12. ギフト贈り主氏名（未使用）
            // "bundled_items": null,           // 13. 同梱指定（未使用）
            // 📧 連絡先・通知
            "shipping_email": null,
            // 📄 明細書設定
            "delivery_note_type": "NOT_INCLUDE_PII",
            "price_on_delivery_note": true,
            "message": "お買い上げありがとうございます。BTCプロテインをお楽しみください！",
            // ⏸️ 処理制御
            "suspend": false,
            // "shipping_date": null,           // 19. 出荷希望日（未使用）
            // "tax": null,                     // 20. 消費税（未使用）
            // "total_with_normal_tax": null,   // 21. 合計通常税率（未使用）
            // "total_with_reduced_tax": null,  // 22. 合計軽減税率（未使用）
            // 🏷️ ラベル設定
            //"label_note": "健康食品・プロテインバー",     // ラベル品名（より具体的に）
            // 🚚 配送設定
            "delivery_carrier": "YAMATO",
            // "delivery_time_slot": null,      // 24. 希望時間指定（未使用）
            // "delivery_date": null,           // 25. 配達希望日（未使用）
            // 💳 代金引換
            "cash_on_delivery": false,
            // "total_for_cash_on_delivery": null,  // 27. 代金引換総計（未使用）
            // "tax_for_cash_on_delivery": null,    // 28. 代金引換消費税（未使用）
            // 📦 配送方法・倉庫
            "delivery_method": "HOME_BOX",
            // "delivery_options": null,        // 30. 受取人からの希望（未使用）
            // "warehouse": "OPL",             // 31. 倉庫コード（エラーのため標準倉庫を使用）
            // 🛍️ 商品リスト
            "items": [
                {
                    "code": "protein-stick-trio",
                    "quantity": 1
                }
            ],
            // 🌐 国際配送
            "international": false,
            // "delivery_service": null,        // 34. 配送サービス（国際配送時のみ）
            // "currency_code": null,           // 35. 海外発送用通貨コード（国際配送時のみ）
            // "insurance": null,               // 36. 海外発送用損害保証制度（国際配送時のみ）
            // ⚙️ その他設定
            "backorder_if_unavailable": true,
            // "purpose": null,                 // 38. 輸出目的（国際配送時のみ）
            "allocate_priority": 3,
            // 📮 住所情報
            "sender": {
                "postcode": "170-0013",
                "prefecture": "東京都",
                "address1": "豊島区東池袋1-34-5",
                "address2": "いちご東池袋ビル9F",
                "name": "BTC Flavor株式会社",
                "company": "BTC Flavor株式会社",
                "division": "配送部",
                "phone": "03-1234-5678"
            },
            "recipient": {
                "postcode": "170-0014",
                "phone": "09013988216",
                "address2": "サンシャインビル10F",
                "prefecture": "東京都",
                "name": "Kohei Yamanes",
                "address1": "豊島区池袋2-1-1" // senderと近い、確実に存在する住所
            }
            // "apply_rule": false             // 42. 出荷ルール適用フラグ（未使用）
        };
        console.log("=== OpenLogi出荷依頼APIテスト開始 ===");
        console.log("API URL:", apiUrl);
        console.log("Payload:", JSON.stringify(shipmentPayload, null, 2));
        // 🚀 OpenLogi API呼び出し
        const startTime = Date.now();
        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Version': '1.5',
                'Authorization': `Bearer ${API_KEY}`,
                'User-Agent': 'GCF-OpenLogi-Shipment-Test/1.0'
            },
            body: JSON.stringify(shipmentPayload),
            signal: AbortSignal.timeout(30000)
        });
        const processingTime = Date.now() - startTime;
        // 📥 レスポンス処理
        let responseBody;
        const contentType = apiResponse.headers.get('content-type') || '';
        try {
            if (contentType.includes('application/json')) {
                responseBody = await apiResponse.json();
            }
            else {
                responseBody = await apiResponse.text();
            }
        }
        catch (e) {
            console.error("Response parsing error:", e);
            responseBody = "Failed to parse response";
        }
        console.log(`API Response [${apiResponse.status}]:`, responseBody);
        // 📊 結果判定とレスポンス生成
        const isSuccess = apiResponse.status >= 200 && apiResponse.status < 300;
        if (isSuccess) {
            // ✅ 成功時
            response.status(200).json({
                success: true,
                message: "🎉 OpenLogi出荷依頼API呼び出し成功！",
                apiResponse: {
                    status: apiResponse.status,
                    statusText: apiResponse.statusText,
                    body: responseBody,
                    headers: {
                        'content-type': contentType,
                        'x-ratelimit-remaining': apiResponse.headers.get('x-ratelimit-remaining')
                    }
                },
                requestDetails: {
                    url: apiUrl,
                    method: 'POST',
                    payload: shipmentPayload,
                    processingTime: `${processingTime}ms`
                },
                timestamp: new Date().toISOString()
            });
        }
        else {
            // ❌ エラー時
            response.status(200).json({
                success: false,
                message: `❌ OpenLogi API呼び出し失敗 [${apiResponse.status}]`,
                error: {
                    status: apiResponse.status,
                    statusText: apiResponse.statusText,
                    body: responseBody,
                    headers: {
                        'content-type': contentType
                    }
                },
                requestDetails: {
                    url: apiUrl,
                    method: 'POST',
                    payload: shipmentPayload,
                    processingTime: `${processingTime}ms`
                },
                troubleshooting: {
                    commonIssues: [
                        "APIキーの有効性確認",
                        "商品IDの存在確認",
                        "住所フォーマットの確認",
                        "必須パラメータの確認"
                    ]
                },
                timestamp: new Date().toISOString()
            });
        }
    }
    catch (error) {
        console.error("=== テスト実行エラー ===", error);
        response.status(200).json({
            success: false,
            message: "💥 テスト実行中にエラーが発生しました",
            error: {
                message: error.message,
                type: error.constructor.name,
                stack: error.stack
            },
            timestamp: new Date().toISOString()
        });
    }
});
//# sourceMappingURL=openLogiShipmentTest.js.map-e 
### FILE: ./lib/testing/dataConverter.js

"use strict";
// src/testing/dataConverter.ts
// OpenLogi データ変換テスト関数（シンプル版）
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testOpenLogiDataConversion = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const admin = __importStar(require("firebase-admin"));
const openlogiConverter_1 = require("../shared/utils/openlogiConverter");
const openlogiConfig_1 = require("../shared/config/openlogiConfig");
/**
 * OpenLogi データ変換テスト関数（シンプル版）
 * Firestoreからデータを取得してOpenLogi形式に変換し、curlレスポンスで結果を返す
 */
exports.testOpenLogiDataConversion = (0, https_1.onRequest)({
    region: "asia-northeast1",
    memory: "512MiB",
    timeoutSeconds: 60,
    cors: true,
}, async (request, response) => {
    var _a;
    const startTime = Date.now();
    let invoiceId;
    try {
        // POSTメソッドのみ受け付け
        if (request.method !== "POST") {
            response.status(405).json({
                success: false,
                error: "INVALID_INPUT",
                message: "Only POST method is allowed",
                timestamp: new Date().toISOString()
            });
            return;
        }
        logger.info("OpenLogi conversion test started", {
            method: request.method,
            timestamp: new Date().toISOString(),
            userAgent: request.get("User-Agent"),
            contentType: request.get("Content-Type"),
        });
        // リクエストパラメータ取得
        const { invoiceId: reqInvoiceId, validateOnly = false, includeDebugInfo = false } = request.body;
        invoiceId = reqInvoiceId;
        // 入力バリデーション
        if (!invoiceId || typeof invoiceId !== 'string') {
            const errorResponse = {
                success: false,
                error: "INVALID_INPUT",
                message: "invoiceId is required and must be string",
                timestamp: new Date().toISOString()
            };
            response.status(400).json(errorResponse);
            return;
        }
        logger.info("Processing conversion test", {
            invoiceId,
            validateOnly,
            includeDebugInfo
        });
        // 1. Invoice データ取得
        const invoiceDoc = await admin.firestore()
            .collection('invoices')
            .doc(invoiceId)
            .get();
        if (!invoiceDoc.exists) {
            throw new Error(openlogiConfig_1.ERROR_MESSAGES.INVOICE_NOT_FOUND);
        }
        const invoiceData = invoiceDoc.data();
        logger.info("Invoice data retrieved", {
            invoiceId,
            userId: invoiceData === null || invoiceData === void 0 ? void 0 : invoiceData.userId,
            status: invoiceData === null || invoiceData === void 0 ? void 0 : invoiceData.status,
            amount_usd: invoiceData === null || invoiceData === void 0 ? void 0 : invoiceData.amount_usd
        });
        // 2. User データ取得
        if (!(invoiceData === null || invoiceData === void 0 ? void 0 : invoiceData.userId)) {
            throw new Error("Missing userId in invoice data");
        }
        const userDoc = await admin.firestore()
            .collection('users')
            .doc(invoiceData.userId)
            .get();
        if (!userDoc.exists) {
            throw new Error(openlogiConfig_1.ERROR_MESSAGES.USER_NOT_FOUND);
        }
        const userData = userDoc.data();
        // 3. デフォルト住所特定
        const userAddresses = (userData === null || userData === void 0 ? void 0 : userData.address) || [];
        const defaultAddress = userAddresses.find((addr) => addr.isDefault);
        if (!defaultAddress) {
            throw new Error(`Default address not found for user: ${invoiceData.userId}`);
        }
        logger.info("User address data retrieved", {
            invoiceId,
            userId: invoiceData.userId,
            addressCount: userAddresses.length,
            hasDefaultAddress: !!defaultAddress,
            isInternational: (_a = defaultAddress.shippingRequest) === null || _a === void 0 ? void 0 : _a.international
        });
        // 4. 変換メタデータ生成
        const conversionMetadata = (0, openlogiConverter_1.generateConversionMetadata)(invoiceData, defaultAddress, startTime);
        // バリデーションのみの場合はここで終了
        if (validateOnly) {
            const validationResponse = {
                success: true,
                invoiceId,
                conversionResult: {
                    openlogiPayload: {},
                    sourceData: includeDebugInfo ? {
                        invoice: invoiceData,
                        userAddress: defaultAddress
                    } : undefined,
                    conversionMetadata
                },
                debugInfo: includeDebugInfo ? {
                    validationOnly: true,
                    debugMode: (0, openlogiConfig_1.isDebugMode)(),
                    environment: process.env.NODE_ENV || 'unknown'
                } : undefined,
                timestamp: new Date().toISOString()
            };
            logger.info("Validation completed successfully", {
                invoiceId,
                shippingType: conversionMetadata.shippingType,
                processingTime: conversionMetadata.processingTime
            });
            response.status(200).json(validationResponse);
            return;
        }
        // 5. OpenLogi 形式に変換
        const openlogiPayload = (0, openlogiConverter_1.convertToOpenLogiFormat)(invoiceData, defaultAddress);
        logger.info("Conversion completed successfully", {
            invoiceId,
            shippingType: conversionMetadata.shippingType,
            itemCount: conversionMetadata.itemCount,
            totalAmountJPY: openlogiPayload.total_amount,
            processingTime: conversionMetadata.processingTime
        });
        // 6. 成功レスポンス生成
        const successResponse = {
            success: true,
            invoiceId,
            conversionResult: {
                openlogiPayload,
                sourceData: includeDebugInfo ? {
                    invoice: {
                        id: invoiceData.id,
                        sessionId: invoiceData.sessionId,
                        userId: invoiceData.userId,
                        amount_usd: invoiceData.amount_usd,
                        cartSnapshot: invoiceData.cartSnapshot,
                        status: invoiceData.status
                    },
                    userAddress: {
                        id: defaultAddress.id,
                        shippingFee: defaultAddress.shippingFee,
                        shippingRegion: defaultAddress.shippingRegion,
                        displayName: defaultAddress.displayName,
                        isDefault: defaultAddress.isDefault,
                        shippingRequest: defaultAddress.shippingRequest
                    }
                } : undefined,
                conversionMetadata
            },
            debugInfo: includeDebugInfo ? {
                debugMode: (0, openlogiConfig_1.isDebugMode)(),
                environment: process.env.NODE_ENV || 'unknown',
                functionRegion: "asia-northeast1"
            } : undefined,
            timestamp: new Date().toISOString()
        };
        const totalProcessingTime = Date.now() - startTime;
        logger.info("Conversion test completed successfully", {
            invoiceId,
            totalProcessingTime: `${totalProcessingTime}ms`
        });
        response.status(200).json(successResponse);
    }
    catch (error) {
        const totalProcessingTime = Date.now() - startTime;
        logger.error("Conversion test failed", {
            invoiceId,
            error: error.message,
            stack: error.stack,
            totalProcessingTime: `${totalProcessingTime}ms`
        });
        // エラーの種類を判定
        let errorType = "CONVERSION_FAILED";
        const errorMessage = error.message.toLowerCase();
        if (errorMessage.includes("invoice not found")) {
            errorType = "INVOICE_NOT_FOUND";
        }
        else if (errorMessage.includes("user") && errorMessage.includes("not found")) {
            errorType = "USER_NOT_FOUND";
        }
        else if (errorMessage.includes("address") || errorMessage.includes("recipient")) {
            errorType = "ADDRESS_INVALID";
        }
        else if (errorMessage.includes("firestore")) {
            errorType = "FIRESTORE_ERROR";
        }
        else if (errorMessage.includes("missing") && errorMessage.includes("shipping")) {
            errorType = "MISSING_SHIPPING_REQUEST";
        }
        else if (errorMessage.includes("currency") || errorMessage.includes("conversion")) {
            errorType = "CURRENCY_CONVERSION_ERROR";
        }
        const errorResponse = {
            success: false,
            invoiceId,
            error: errorType,
            message: error.message,
            details: (0, openlogiConfig_1.isDebugMode)() ? {
                stack: error.stack,
                totalProcessingTime: `${totalProcessingTime}ms`
            } : undefined,
            timestamp: new Date().toISOString()
        };
        // ステータスコード判定を修正
        let statusCode = 500; // デフォルト
        if (errorType === "INVOICE_NOT_FOUND" || errorType === "USER_NOT_FOUND") {
            statusCode = 404;
        }
        else if (errorType === "ADDRESS_INVALID" || errorType === "MISSING_SHIPPING_REQUEST") {
            statusCode = 400;
        }
        response.status(statusCode).json(errorResponse);
    }
});
//# sourceMappingURL=dataConverter.js.map-e 
### FILE: ./lib/testing/simpleConnectionTest.js

"use strict";
// src/testing/simpleConnectionTest.ts
// 商品ID指定版OpenLogi接続テスト
Object.defineProperty(exports, "__esModule", { value: true });
exports.simpleOpenLogiTest = void 0;
const https_1 = require("firebase-functions/v2/https");
/**
 * 商品ID指定版OpenLogi接続テスト
 */
exports.simpleOpenLogiTest = (0, https_1.onRequest)({
    region: "asia-northeast1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true,
}, async (request, response) => {
    try {
        // 🔑 APIキー（実際のキーに置き換えてください）
        const API_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiMGE1OTRkM2Q0Y2IwYWY5NTMzNjkzNTU5NjY0M2I1NjllYTdiZjk4NjAxNDY5MDNlNTg0ODBiOTZkYmM1MTJmZDBlYWUxY2NkNGNkYmZkOWQiLCJpYXQiOjE3NDk1MTc4MzcuNzg2MDU0LCJuYmYiOjE3NDk1MTc4MzcuNzg2MDU3LCJleHAiOjE3ODEwNTM4MzcuNzU3MjkzLCJzdWIiOiJkMjVmNTUwNi1jNzNiLTQyOTQtOGQ4Ny0zYzNkZWUyYTU5N2QiLCJzY29wZXMiOltdfQ.Ge3Mqqp-r44aZYeCg3S_NbF4_UKG1xnQjlkco7cOfjPCsxnJTFWrWrvsnCuGtZHHrAkTY3SFjUOIwt_eGeSJ8D9rhS-y8j4XKQVVaEOLta-GCunQwH26Wx3pUJVZ3YMFiq0-ao0QZi9iGopOj5W9OEIzu5w0HRqWJ4C3W0IgClVLax7nYT_3Jx9RG3DjUg57gr9v1iJ1qj6J3sOMR8_TtSr4CZwkIetGzObk6ZELYS1T1_mbiGs74EwqqilmqZk_1_I4vBvdFLjaBT6EYyQ4JmDZ1ljPGTLy7c8AGXBz8Um3lpyHvv4jJw5XO0ziIHYMKb6Z6cVdHUWduPtrxsfWTib-i-jqbF0PQudSz-So4VhwvvJO1DgSkqRSq67eqVqDGcBsxn8SqQgj6Z9aarBEg-9Y2wL8Sn_I2YqSG9IqIcePq_TARSnGiaAvTPF88_FaIHjcbQZegfG3m9Zy1Zu4dBuOvW_MG4TU9kSxLByIGoNrqDylCtybz8O5WhdRd8XdHw2RwpPc_1ZB79yM-FGfo832tgHCrBZzdG2gqSJbnCe4x6aHg81mDUrzEglCBdco8REgRvvBiked6bQTx8NaU6wc38TD5LblZ7feW_V3Kq6sAbSfXW87ZRGpJ-zbCSWq43EheMh8iLTNowO9jO5vqpvyB14xh5-umGm5iQrz674";
        // 🎯 正しいエンドポイント + 商品ID指定
        const baseUrl = "https://api-demo.openlogi.com/api/items";
        // 📦 テストする商品ID（在庫商品から）
        const testProductIds = [
            "1",
            "protein-stick-trio" // 商品コード
        ];
        console.log("Testing OpenLogi items API with product IDs...");
        console.log("Base URL:", baseUrl);
        console.log("API Key length:", API_KEY.length);
        console.log("Test product IDs:", testProductIds);
        const results = [];
        // 🔄 各商品IDでテスト
        for (const productId of testProductIds) {
            try {
                // クエリパラメータ付きURL
                const url = `${baseUrl}?id=${productId}&stock=1`;
                console.log(`Testing: ${url}`);
                const apiResponse = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Api-Version': '1.5',
                        'Authorization': `Bearer ${API_KEY}`,
                        'User-Agent': 'GCF-OpenLogi-Test/1.0'
                    },
                    signal: AbortSignal.timeout(15000)
                });
                let responseBody;
                try {
                    responseBody = await apiResponse.json();
                }
                catch (e) {
                    responseBody = await apiResponse.text();
                }
                console.log(`${productId} → ${apiResponse.status}`, responseBody);
                results.push({
                    productId: productId,
                    url: url,
                    status: apiResponse.status,
                    statusText: apiResponse.statusText,
                    success: apiResponse.status === 200,
                    body: responseBody,
                    headers: {
                        'content-type': apiResponse.headers.get('content-type'),
                        'x-ratelimit-remaining': apiResponse.headers.get('x-ratelimit-remaining')
                    }
                });
                // 200が見つかったら詳細ログ
                if (apiResponse.status === 200) {
                    console.log(`✅ SUCCESS with product ID: ${productId}`);
                    console.log("Response data:", JSON.stringify(responseBody, null, 2));
                }
            }
            catch (error) {
                console.log(`❌ ERROR with product ID ${productId}: ${error.message}`);
                results.push({
                    productId: productId,
                    status: 'ERROR',
                    error: error.message,
                    success: false
                });
            }
        }
        // 📊 結果集計
        const successfulRequests = results.filter(r => r.success);
        // 📝 レスポンス生成
        if (successfulRequests.length > 0) {
            response.status(200).json({
                message: `🎉 OpenLogi API接続成功！ ${successfulRequests.length}個の商品IDで成功`,
                success: true,
                endpoint: baseUrl,
                successfulProductIds: successfulRequests.map(r => r.productId),
                detailResults: successfulRequests,
                apiInfo: {
                    authenticated: true,
                    correctEndpoint: baseUrl,
                    requiredParameter: "商品ID（idパラメータ）が必須"
                },
                timestamp: new Date().toISOString()
            });
        }
        else {
            response.status(200).json({
                message: "❌ 商品IDでのアクセス失敗 - エンドポイントは正しいが商品IDが不正",
                success: false,
                endpoint: baseUrl,
                testedProductIds: testProductIds,
                allResults: results,
                apiInfo: {
                    authenticated: true,
                    correctEndpoint: baseUrl,
                    issue: "商品IDの形式が不正の可能性"
                },
                timestamp: new Date().toISOString()
            });
        }
    }
    catch (error) {
        console.error("Overall test error:", error);
        response.status(200).json({
            success: false,
            message: "💥 テスト実行失敗",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});
//# sourceMappingURL=simpleConnectionTest.js.map-e 
### FILE: ./lib/shared/types/openlogi.js

"use strict";
// src/shared/types/openlogi.ts
// OpenLogi API型定義
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=openlogi.js.map-e 
### FILE: ./lib/shared/config/openlogiConfig.js

"use strict";
// src/shared/config/openlogiConfig.ts
// OpenLogi API設定値
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDebugMode = exports.mapProductId = exports.convertUSDToJPY = exports.ERROR_MESSAGES = exports.VALIDATION_RULES = exports.OPENLOGI_DEFAULTS = exports.OPENLOGI_API_CONFIG = void 0;
// API設定（OpenLogi Demo環境）
exports.OPENLOGI_API_CONFIG = {
    // 🧪 Demo環境: https://api-demo.openlogi.com
    // 本番環境: https://api.openlogi.com  
    BASE_URL: "https://api-demo.openlogi.com",
    ENDPOINTS: {
        SHIPMENTS: "/shipments"
    },
    API_VERSION: "1.5",
    TIMEOUT: 60000, // 60秒（推奨接続タイムアウト）
};
// 基本設定
exports.OPENLOGI_DEFAULTS = {
    WAREHOUSE_CODE: "OPL",
    USD_TO_JPY_RATE: 150,
    // 会社発送元住所
    SENDER_ADDRESS: {
        postcode: "170-0013",
        prefecture: "東京都",
        address1: "豊島区東池袋1-34-5",
        address2: "いちご東池袋ビル9F",
        name: "BTC Flavor株式会社",
        company: "BTC Flavor株式会社",
        division: "配送部",
        phone: "03-1234-5678"
    },
    // 梱包設定
    PACKAGING_DEFAULTS: {
        cushioning_unit: "ORDER",
        cushioning_type: "BUBBLE_PACK",
        gift_wrapping_unit: null,
        gift_wrapping_type: null,
        delivery_method: "HOME_BOX"
    },
    // 明細書・通知設定
    INVOICE_DEFAULTS: {
        delivery_note_type: "NOT_INCLUDE_PII",
        price_on_delivery_note: true,
        message: "お買い上げありがとうございます。BTCプロテインをお楽しみください！",
        shipping_email: null // プライバシー重視でメール通知なし
    },
    // システム制御設定
    SYSTEM_DEFAULTS: {
        suspend: false,
        backorder_if_unavailable: true,
        apply_rule: false,
        allocate_priority: 50,
        cash_on_delivery: false,
        handling_charge: 0,
        discount_amount: 0
    },
    // 国際配送デフォルト
    INTERNATIONAL_DEFAULTS: {
        delivery_service: "JAPANPOST-EMS",
        currency_code: "JPY",
        insurance: true,
        purpose: "SALE_OF_GOODS"
    }
};
// バリデーションルール
exports.VALIDATION_RULES = {
    INVOICE_REQUIRED_FIELDS: ['id', 'sessionId', 'userId', 'cartSnapshot', 'amount_usd'],
    CART_SNAPSHOT_REQUIRED_FIELDS: ['items', 'subtotal'],
    CART_ITEM_REQUIRED_FIELDS: ['id', 'quantity'],
    SHIPPING_REQUEST_REQUIRED_FIELDS: ['international', 'recipient'],
    RECIPIENT_REQUIRED_FIELDS: ['name', 'address1', 'postcode', 'phone'],
    // 数値制限
    MAX_AMOUNT_JPY: 999999999,
    MIN_AMOUNT_JPY: 1,
    MAX_ITEMS: 100,
    MAX_MESSAGE_LENGTH: 500
};
// エラーメッセージ
exports.ERROR_MESSAGES = {
    INVOICE_NOT_FOUND: "Invoice not found",
    USER_NOT_FOUND: "User data not found",
    ADDRESS_INVALID: "Invalid or missing address data",
    MISSING_SHIPPING_REQUEST: "Missing shippingRequest in address",
    CONVERSION_FAILED: "Failed to convert data to OpenLogi format",
    FIRESTORE_ERROR: "Firestore operation failed",
    INVALID_INPUT: "Invalid input parameters",
    CURRENCY_CONVERSION_ERROR: "Currency conversion failed"
};
// 通貨換算ヘルパー
function convertUSDToJPY(usdAmount, rate = exports.OPENLOGI_DEFAULTS.USD_TO_JPY_RATE) {
    if (typeof usdAmount !== 'number' || usdAmount < 0) {
        throw new Error('Invalid USD amount');
    }
    if (typeof rate !== 'number' || rate <= 0) {
        throw new Error('Invalid exchange rate');
    }
    return Math.round(usdAmount * rate);
}
exports.convertUSDToJPY = convertUSDToJPY;
// 商品ID変換（将来的にマッピングが必要な場合）
function mapProductId(cartItemId) {
    // 現在は1:1マッピング（OpenLogiの商品コードと一致）
    return cartItemId;
}
exports.mapProductId = mapProductId;
// デバッグモード判定
function isDebugMode() {
    return process.env.FUNCTIONS_EMULATOR === 'true' || process.env.NODE_ENV === 'development';
}
exports.isDebugMode = isDebugMode;
//# sourceMappingURL=openlogiConfig.js.map-e 
### FILE: ./lib/shared/config/firebase.js

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
// Firebase Admin初期化
(0, app_1.initializeApp)();
// Firestore インスタンスをエクスポート
exports.db = (0, firestore_1.getFirestore)();
//# sourceMappingURL=firebase.js.map-e 
### FILE: ./lib/shared/utils/paymentHelpers.js

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateInvoiceStatus = exports.processPaymentExpired = exports.processPaymentSuccess = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
/**
 * 支払い成功処理
 */
async function processPaymentSuccess(invoiceId, webhookData) {
    try {
        // 1. Invoice ステータス更新
        const invoiceRef = firebase_1.db.collection("invoices").doc(invoiceId);
        const invoiceDoc = await invoiceRef.get();
        const invoiceData = invoiceDoc.data();
        const currentStatus = invoiceData === null || invoiceData === void 0 ? void 0 : invoiceData.status;
        if (currentStatus === "paid") {
            logger.info("Invoice already paid; skipping redirect update", { invoiceId });
            return; // すでに paid の場合は何もしない
        }
        if (invoiceDoc.exists) {
            await invoiceRef.update({
                status: "redirect",
                paidAt: new Date(),
                webhook_data: webhookData,
                updatedAt: new Date(),
            });
            // 2. ユーザーカートクリア
            const invoiceData = invoiceDoc.data();
            if (invoiceData === null || invoiceData === void 0 ? void 0 : invoiceData.userId) {
                await firebase_1.db.doc(`users/${invoiceData.userId}`).update({
                    cart: [],
                    lastPurchaseAt: new Date(),
                });
                logger.info("User cart cleared after payment", {
                    userId: invoiceData.userId,
                    invoiceId,
                });
            }
        }
        else {
            logger.warn("Invoice not found for payment processing", {
                invoiceId,
            });
        }
    }
    catch (error) {
        logger.error("Payment success processing failed", {
            invoiceId,
            error: error.message,
        });
        throw error;
    }
}
exports.processPaymentSuccess = processPaymentSuccess;
/**
 * 支払い期限切れ処理
 */
async function processPaymentExpired(invoiceId, webhookData) {
    try {
        const invoiceRef = firebase_1.db.collection("invoices").doc(invoiceId);
        const invoiceDoc = await invoiceRef.get();
        if (invoiceDoc.exists) {
            await invoiceRef.update({
                status: "expired",
                expiredAt: new Date(),
                webhook_data: webhookData,
                updatedAt: new Date(),
            });
        }
    }
    catch (error) {
        logger.error("Payment expiry processing failed", {
            invoiceId,
            error: error.message,
        });
        throw error;
    }
}
exports.processPaymentExpired = processPaymentExpired;
/**
 * Invoice ステータス更新
 */
async function updateInvoiceStatus(invoiceId, status, webhookData) {
    try {
        const invoiceRef = firebase_1.db.collection("invoices").doc(invoiceId);
        await invoiceRef.update({
            status,
            webhook_data: webhookData,
            updatedAt: new Date(),
        });
    }
    catch (error) {
        logger.error("Invoice status update failed", {
            invoiceId,
            status,
            error: error.message,
        });
        throw error;
    }
}
exports.updateInvoiceStatus = updateInvoiceStatus;
//# sourceMappingURL=paymentHelpers.js.map-e 
### FILE: ./lib/shared/utils/openlogiConverter.js

"use strict";
// src/shared/utils/openlogiConverter.ts
// OpenLogi形式への変換ロジック
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertToOpenLogiFormat = exports.generateInternationalRequest = exports.generateDomesticRequest = exports.generateBaseRequest = exports.convertCartItemsToOpenLogiItems = exports.generateConversionMetadata = exports.validateUserAddress = exports.validateInvoiceData = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const openlogiConfig_1 = require("../config/openlogiConfig");
/**
 * バリデーション関数群
 */
function validateInvoiceData(invoiceData) {
    if (!invoiceData) {
        throw new Error(openlogiConfig_1.ERROR_MESSAGES.INVOICE_NOT_FOUND);
    }
    // 必須フィールドチェック
    for (const field of openlogiConfig_1.VALIDATION_RULES.INVOICE_REQUIRED_FIELDS) {
        if (!invoiceData[field]) {
            throw new Error(`Missing required invoice field: ${field}`);
        }
    }
    // cartSnapshotのバリデーション
    const cartSnapshot = invoiceData.cartSnapshot;
    for (const field of openlogiConfig_1.VALIDATION_RULES.CART_SNAPSHOT_REQUIRED_FIELDS) {
        if (!cartSnapshot[field]) {
            throw new Error(`Missing required cartSnapshot field: ${field}`);
        }
    }
    // 商品アイテムのバリデーション
    if (!Array.isArray(cartSnapshot.items) || cartSnapshot.items.length === 0) {
        throw new Error("Cart items must be a non-empty array");
    }
    if (cartSnapshot.items.length > openlogiConfig_1.VALIDATION_RULES.MAX_ITEMS) {
        throw new Error(`Too many items: ${cartSnapshot.items.length} (max: ${openlogiConfig_1.VALIDATION_RULES.MAX_ITEMS})`);
    }
    // 各商品アイテムのバリデーション
    cartSnapshot.items.forEach((item, index) => {
        for (const field of openlogiConfig_1.VALIDATION_RULES.CART_ITEM_REQUIRED_FIELDS) {
            if (!item[field]) {
                throw new Error(`Missing required field '${field}' in cart item ${index}`);
            }
        }
        if (typeof item.quantity !== 'number' || item.quantity <= 0) {
            throw new Error(`Invalid quantity for item ${index}: ${item.quantity}`);
        }
    });
    // 金額バリデーション
    if (typeof invoiceData.amount_usd !== 'number' || invoiceData.amount_usd <= 0) {
        throw new Error(`Invalid amount_usd: ${invoiceData.amount_usd}`);
    }
}
exports.validateInvoiceData = validateInvoiceData;
function validateUserAddress(userAddress) {
    if (!userAddress) {
        throw new Error(openlogiConfig_1.ERROR_MESSAGES.ADDRESS_INVALID);
    }
    if (!userAddress.shippingRequest) {
        throw new Error(openlogiConfig_1.ERROR_MESSAGES.MISSING_SHIPPING_REQUEST);
    }
    const shippingRequest = userAddress.shippingRequest;
    // 必須フィールドチェック
    for (const field of openlogiConfig_1.VALIDATION_RULES.SHIPPING_REQUEST_REQUIRED_FIELDS) {
        if (shippingRequest[field] === undefined) {
            throw new Error(`Missing required shippingRequest field: ${field}`);
        }
    }
    // recipient情報のバリデーション
    const recipient = shippingRequest.recipient;
    if (!recipient) {
        throw new Error("Missing recipient information");
    }
    for (const field of openlogiConfig_1.VALIDATION_RULES.RECIPIENT_REQUIRED_FIELDS) {
        if (!recipient[field]) {
            throw new Error(`Missing required recipient field: ${field}`);
        }
    }
    // 国際配送の場合の追加バリデーション
    if (shippingRequest.international) {
        if (!recipient.region_code) {
            throw new Error("Missing region_code for international shipping");
        }
        if (!recipient.city) {
            throw new Error("Missing city for international shipping");
        }
    }
    else {
        // 国内配送の場合
        if (!recipient.prefecture) {
            throw new Error("Missing prefecture for domestic shipping");
        }
    }
}
exports.validateUserAddress = validateUserAddress;
/**
 * 変換メタデータ生成
 */
function generateConversionMetadata(invoiceData, userAddress, processingStartTime) {
    const processingTime = Date.now() - processingStartTime;
    const exchangeRate = openlogiConfig_1.OPENLOGI_DEFAULTS.USD_TO_JPY_RATE;
    return {
        shippingType: userAddress.shippingRequest.international ? 'international' : 'domestic',
        currencyConversion: {
            originalUSD: invoiceData.amount_usd,
            convertedJPY: (0, openlogiConfig_1.convertUSDToJPY)(invoiceData.amount_usd, exchangeRate),
            exchangeRate
        },
        itemCount: invoiceData.cartSnapshot.items.length,
        processingTime: `${processingTime}ms`
    };
}
exports.generateConversionMetadata = generateConversionMetadata;
/**
 * 商品リスト変換
 */
function convertCartItemsToOpenLogiItems(cartItems) {
    return cartItems.map(item => ({
        product_id: (0, openlogiConfig_1.mapProductId)(item.id),
        quantity: item.quantity
    }));
}
exports.convertCartItemsToOpenLogiItems = convertCartItemsToOpenLogiItems;
/**
 * 基本リクエストデータ生成
 */
function generateBaseRequest(invoiceData, userAddress) {
    const exchangeRate = openlogiConfig_1.OPENLOGI_DEFAULTS.USD_TO_JPY_RATE;
    return Object.assign(Object.assign(Object.assign(Object.assign({ 
        // 基本識別情報
        identifier: invoiceData.id, order_no: invoiceData.sessionId, warehouse: openlogiConfig_1.OPENLOGI_DEFAULTS.WAREHOUSE_CODE, 
        // 金額情報（USD→JPY変換）
        subtotal_amount: (0, openlogiConfig_1.convertUSDToJPY)(invoiceData.cartSnapshot.subtotal, exchangeRate), delivery_charge: (0, openlogiConfig_1.convertUSDToJPY)(userAddress.shippingFee || 0, exchangeRate), total_amount: (0, openlogiConfig_1.convertUSDToJPY)(invoiceData.amount_usd, exchangeRate), 
        // 商品リスト
        items: convertCartItemsToOpenLogiItems(invoiceData.cartSnapshot.items), 
        // 配送先住所
        recipient: userAddress.shippingRequest.recipient }, openlogiConfig_1.OPENLOGI_DEFAULTS.PACKAGING_DEFAULTS), openlogiConfig_1.OPENLOGI_DEFAULTS.INVOICE_DEFAULTS), openlogiConfig_1.OPENLOGI_DEFAULTS.SYSTEM_DEFAULTS), { 
        // 発送元住所
        sender: openlogiConfig_1.OPENLOGI_DEFAULTS.SENDER_ADDRESS });
}
exports.generateBaseRequest = generateBaseRequest;
/**
 * 国内配送リクエスト生成
 */
function generateDomesticRequest(baseRequest, shippingRequest) {
    return Object.assign(Object.assign({}, baseRequest), { international: false, delivery_carrier: shippingRequest.delivery_carrier || "YAMATO", delivery_method: shippingRequest.delivery_method || "HOME_BOX", delivery_time_slot: shippingRequest.delivery_time_slot });
}
exports.generateDomesticRequest = generateDomesticRequest;
/**
 * 国際配送リクエスト生成
 */
function generateInternationalRequest(baseRequest, shippingRequest) {
    var _a;
    return Object.assign(Object.assign({}, baseRequest), { international: true, delivery_service: shippingRequest.delivery_service || openlogiConfig_1.OPENLOGI_DEFAULTS.INTERNATIONAL_DEFAULTS.delivery_service, currency_code: openlogiConfig_1.OPENLOGI_DEFAULTS.INTERNATIONAL_DEFAULTS.currency_code, insurance: (_a = shippingRequest.insurance) !== null && _a !== void 0 ? _a : openlogiConfig_1.OPENLOGI_DEFAULTS.INTERNATIONAL_DEFAULTS.insurance, purpose: shippingRequest.purpose || openlogiConfig_1.OPENLOGI_DEFAULTS.INTERNATIONAL_DEFAULTS.purpose });
}
exports.generateInternationalRequest = generateInternationalRequest;
/**
 * メイン変換関数
 */
function convertToOpenLogiFormat(invoiceData, userAddress) {
    const startTime = Date.now();
    try {
        // バリデーション
        validateInvoiceData(invoiceData);
        validateUserAddress(userAddress);
        logger.info("Starting OpenLogi conversion", {
            invoiceId: invoiceData.id,
            isInternational: userAddress.shippingRequest.international,
            itemCount: invoiceData.cartSnapshot.items.length
        });
        // 基本リクエストデータ生成
        const baseRequest = generateBaseRequest(invoiceData, userAddress);
        // 国内/国際配送で分岐
        const shippingRequest = userAddress.shippingRequest;
        let openlogiRequest;
        if (shippingRequest.international) {
            openlogiRequest = generateInternationalRequest(baseRequest, shippingRequest);
            logger.info("Generated international shipping request", {
                invoiceId: invoiceData.id,
                deliveryService: openlogiRequest.delivery_service,
                destination: openlogiRequest.recipient.region_code
            });
        }
        else {
            openlogiRequest = generateDomesticRequest(baseRequest, shippingRequest);
            logger.info("Generated domestic shipping request", {
                invoiceId: invoiceData.id,
                deliveryCarrier: openlogiRequest.delivery_carrier,
                prefecture: openlogiRequest.recipient.prefecture
            });
        }
        // 最終バリデーション
        validateGeneratedRequest(openlogiRequest);
        const processingTime = Date.now() - startTime;
        logger.info("OpenLogi conversion completed", {
            invoiceId: invoiceData.id,
            processingTime: `${processingTime}ms`
        });
        return openlogiRequest;
    }
    catch (error) {
        const processingTime = Date.now() - startTime;
        logger.error("OpenLogi conversion failed", {
            invoiceId: invoiceData === null || invoiceData === void 0 ? void 0 : invoiceData.id,
            error: error.message,
            processingTime: `${processingTime}ms`
        });
        throw error;
    }
}
exports.convertToOpenLogiFormat = convertToOpenLogiFormat;
/**
 * 生成されたリクエストの最終バリデーション
 */
function validateGeneratedRequest(request) {
    // 金額範囲チェック
    if (request.total_amount && (request.total_amount > openlogiConfig_1.VALIDATION_RULES.MAX_AMOUNT_JPY || request.total_amount < openlogiConfig_1.VALIDATION_RULES.MIN_AMOUNT_JPY)) {
        throw new Error(`Total amount out of range: ${request.total_amount}`);
    }
    // メッセージ長さチェック
    if (request.message && request.message.length > openlogiConfig_1.VALIDATION_RULES.MAX_MESSAGE_LENGTH) {
        throw new Error(`Message too long: ${request.message.length} characters (max: ${openlogiConfig_1.VALIDATION_RULES.MAX_MESSAGE_LENGTH})`);
    }
    // 必須フィールド最終チェック
    if (!request.identifier || !request.order_no || !request.items || request.items.length === 0) {
        throw new Error("Missing required fields in generated request");
    }
}
//# sourceMappingURL=openlogiConverter.js.map-e 
### FILE: ./lib/shared/utils/openlogiClient.js

"use strict";
// src/shared/utils/openlogiClient.ts
// OpenLogi API クライアント
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkOpenLogiConnection = exports.createOpenLogiShipment = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const params_1 = require("firebase-functions/params");
const openlogiConfig_1 = require("../config/openlogiConfig");
// 環境変数定義
const openlogiApiKey = (0, params_1.defineString)("OPENLOGI_API_KEY", {
    description: "OpenLogi API Key for shipment creation",
    default: "",
});
/**
 * OpenLogi API 出荷依頼作成
 */
async function createOpenLogiShipment(shipmentRequest) {
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
            endpoint: openlogiConfig_1.OPENLOGI_API_CONFIG.BASE_URL + openlogiConfig_1.OPENLOGI_API_CONFIG.ENDPOINTS.SHIPMENTS,
            identifier: shipmentRequest.identifier,
            international: shipmentRequest.international
        });
        // API リクエスト準備
        const url = openlogiConfig_1.OPENLOGI_API_CONFIG.BASE_URL + openlogiConfig_1.OPENLOGI_API_CONFIG.ENDPOINTS.SHIPMENTS;
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
            signal: AbortSignal.timeout(openlogiConfig_1.OPENLOGI_API_CONFIG.TIMEOUT)
        });
        const processingTime = `${Date.now() - startTime}ms`;
        // レスポンス処理
        if (!response.ok) {
            // エラーレスポンスの解析
            let errorData = {};
            try {
                errorData = await response.json();
            }
            catch (parseError) {
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
            let errorType = 'API_ERROR';
            if (response.status === 401 || response.status === 403) {
                errorType = 'AUTH_ERROR';
            }
            else if (response.status === 400 || response.status === 422) {
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
        const responseData = await response.json();
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
    }
    catch (error) {
        const processingTime = `${Date.now() - startTime}ms`;
        logger.error("OpenLogi API request failed", {
            requestId,
            error: error.message,
            stack: error.stack,
            processingTime
        });
        // エラータイプ判定
        let errorType = 'NETWORK_ERROR';
        if (error.message.includes('timeout') || error.message.includes('signal')) {
            errorType = 'NETWORK_ERROR';
        }
        else if (error.message.includes('API key')) {
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
exports.createOpenLogiShipment = createOpenLogiShipment;
/**
 * OpenLogi API接続テスト（実在エンドポイント使用）
 */
async function checkOpenLogiConnection() {
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
            baseUrl: openlogiConfig_1.OPENLOGI_API_CONFIG.BASE_URL,
            apiVersion: openlogiConfig_1.OPENLOGI_API_CONFIG.API_VERSION
        });
        // 実在するエンドポイントで接続テスト: 商品一覧API
        const url = openlogiConfig_1.OPENLOGI_API_CONFIG.BASE_URL + "/items";
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Version': openlogiConfig_1.OPENLOGI_API_CONFIG.API_VERSION,
                'Authorization': `Bearer ${apiKey}`,
                'User-Agent': 'BTCFlavor-GCF/1.0'
            },
            signal: AbortSignal.timeout(15000)
        });
        logger.info("OpenLogi API response received", {
            status: response.status,
            statusText: response.statusText,
            url: url,
            headers: {
                'X-Api-Version': openlogiConfig_1.OPENLOGI_API_CONFIG.API_VERSION,
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
        }
        else if (response.status === 401) {
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
        }
        else if (response.status === 402) {
            return {
                success: false,
                message: "Payment required - Please register payment method",
                details: {
                    status: response.status,
                    statusText: response.statusText,
                    error: "payment_required"
                }
            };
        }
        else if (response.status === 403) {
            return {
                success: false,
                message: "Forbidden - API token permissions insufficient",
                details: {
                    status: response.status,
                    statusText: response.statusText,
                    error: "forbidden"
                }
            };
        }
        else if (response.status === 404) {
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
        }
        else if (response.status === 429) {
            return {
                success: false,
                message: "Rate limit exceeded - Too many requests",
                details: {
                    status: response.status,
                    statusText: response.statusText,
                    error: "Too Many Attempts."
                }
            };
        }
        else {
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
    }
    catch (error) {
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
exports.checkOpenLogiConnection = checkOpenLogiConnection;
//# sourceMappingURL=openlogiClient.js.map-e 
### FILE: ./lib/shared/middleware/security.js

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveSecureWebhookLog = exports.verifyWebhookPayload = exports.verifyWebhookSignature = void 0;
const crypto = __importStar(require("crypto"));
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
/**
 * OpenNode Webhook署名検証
 */
function verifyWebhookSignature(invoiceId, receivedHash, apiKey) {
    try {
        // HMAC-SHA256で署名を再計算
        const calculatedHash = crypto
            .createHmac("sha256", apiKey)
            .update(invoiceId)
            .digest("hex");
        // 署名検証
        const isValid = receivedHash === calculatedHash;
        if (isValid) {
            logger.info("✅ Webhook signature verified successfully", {
                invoiceId,
                hashPrefix: calculatedHash.substring(0, 16) + "...",
            });
        }
        else {
            logger.error("Webhook signature verification failed", {
                invoiceId,
                receivedHash: receivedHash.substring(0, 16) + "...",
                calculatedHash: calculatedHash.substring(0, 16) + "...",
                lengthMatch: receivedHash.length === calculatedHash.length,
            });
        }
        return isValid;
    }
    catch (error) {
        logger.error("Webhook signature verification error", {
            error: error.message,
            invoiceId,
        });
        return false;
    }
}
exports.verifyWebhookSignature = verifyWebhookSignature;
/**
 * Webhook検証（基本フィールドチェック + 署名検証）
 */
function verifyWebhookPayload(webhookData, apiKey) {
    const { id: invoiceId, hashed_order: receivedHash, status } = webhookData;
    logger.info("Webhook payload for verification", {
        invoiceId,
        status,
        hasHashedOrder: !!receivedHash,
        payloadKeys: Object.keys(webhookData || {}),
    });
    // 必須フィールドチェック
    if (!invoiceId || !receivedHash) {
        const errorMessage = "Missing required verification fields";
        logger.warn(errorMessage, {
            hasInvoiceId: !!invoiceId,
            hasHashedOrder: !!receivedHash,
        });
        return {
            isValid: false,
            errorMessage,
        };
    }
    // 署名検証
    const isSignatureValid = verifyWebhookSignature(invoiceId, receivedHash, apiKey);
    return {
        isValid: isSignatureValid,
        invoiceId,
        status,
        webhookData,
        errorMessage: isSignatureValid ? undefined : "Invalid webhook signature",
    };
}
exports.verifyWebhookPayload = verifyWebhookPayload;
/**
 * セキュアログをFirestoreに保存
 */
async function saveSecureWebhookLog(verification, request, processingTime, processedAction, apiKey) {
    try {
        const timestamp = new Date();
        const docId = verification.isValid
            ? `SECURE-${timestamp.toISOString().replace(/[:.]/g, "-")}`
            : `SECURE-ERROR-${timestamp.toISOString().replace(/[:.]/g, "-")}`;
        const logData = {
            receivedAt: timestamp,
            webhookData: verification.webhookData,
            verificationResult: {
                signatureValid: verification.isValid,
                invoiceId: verification.invoiceId,
                status: verification.status,
                processedAction,
                errorMessage: verification.errorMessage,
            },
            source: verification.isValid ? "opennode-verified" : "opennode-security-error",
            method: request.method,
            headers: {
                contentType: request.get("Content-Type"),
                userAgent: request.get("User-Agent"),
            },
            metadata: {
                processingTime: `${processingTime}ms`,
                success: verification.isValid,
                apiKeyUsed: apiKey.substring(0, 8) + "***",
            },
        };
        await firebase_1.db.collection("SecureWebhookLogs").doc(docId).set(logData);
        logger.info("Secure webhook log saved", {
            documentId: docId,
            success: verification.isValid,
        });
        return docId;
    }
    catch (error) {
        logger.error("Failed to save secure webhook log", {
            error: error.message,
        });
        throw error;
    }
}
exports.saveSecureWebhookLog = saveSecureWebhookLog;
//# sourceMappingURL=security.js.map-e 
### FILE: ./lib/webhook/opennodeSecure.js

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.opennodeWebhookSecure = void 0;
// src/webhook/opennodeSecure.ts
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const params_1 = require("firebase-functions/params");
const security_1 = require("../shared/middleware/security");
const paymentHelpers_1 = require("../shared/utils/paymentHelpers");
// 環境変数定義
const opennodeApiKey = (0, params_1.defineString)("OPENNODE_API_KEY", {
    description: "OpenNode API Key for webhook verification",
    default: "",
});
/**
 * セキュリティ検証付きOpenNode Webhook処理関数
 * HMAC-SHA256署名検証を実装
 */
exports.opennodeWebhookSecure = (0, https_1.onRequest)({
    region: "asia-northeast1",
    memory: "256MiB",
    timeoutSeconds: 60,
    cors: true,
}, async (request, response) => {
    var _a;
    const startTime = Date.now();
    try {
        logger.info("OpenNode Secure Webhook received", {
            method: request.method,
            timestamp: new Date().toISOString(),
            userAgent: request.get("User-Agent"),
            contentType: request.get("Content-Type"),
        });
        // POSTメソッドのみ受け付け
        if (request.method !== "POST") {
            logger.warn("Invalid HTTP method for secure webhook", {
                method: request.method,
                ip: request.ip,
            });
            response.status(405).json({
                error: "Method not allowed",
                message: "Only POST method is allowed",
            });
            return;
        }
        // API Key チェック
        const apiKey = opennodeApiKey.value();
        if (!apiKey) {
            logger.error("OpenNode API key not configured");
            response.status(500).json({
                error: "API key not configured",
            });
            return;
        }
        // Webhook検証
        const verification = (0, security_1.verifyWebhookPayload)(request.body, apiKey);
        if (!verification.isValid) {
            const statusCode = ((_a = verification.errorMessage) === null || _a === void 0 ? void 0 : _a.includes("Missing required")) ? 400 : 401;
            response.status(statusCode).json({
                error: verification.errorMessage,
                message: statusCode === 401 ? "Webhook verification failed - not from OpenNode" : undefined,
                details: statusCode === 400 ? {
                    invoiceId: !!verification.invoiceId,
                    hashedOrder: !!request.body.hashed_order,
                } : undefined,
            });
            // エラーログ保存
            await (0, security_1.saveSecureWebhookLog)(verification, request, Date.now() - startTime, "verification_failed", apiKey);
            return;
        }
        // 支払いステータス処理
        let processedAction = "none";
        const { invoiceId, status, webhookData } = verification;
        if (status === "paid") {
            // 支払い完了処理
            await (0, paymentHelpers_1.processPaymentSuccess)(invoiceId, webhookData);
            processedAction = "payment_completed";
            logger.info("💰 Payment processing completed", {
                invoiceId,
                amount: webhookData.price,
                fee: webhookData.fee,
            });
        }
        else if (status === "expired") {
            // 期限切れ処理
            await (0, paymentHelpers_1.processPaymentExpired)(invoiceId, webhookData);
            processedAction = "payment_expired";
            logger.info("⏰ Payment expired", {
                invoiceId,
            });
        }
        else {
            // その他のステータス更新
            await (0, paymentHelpers_1.updateInvoiceStatus)(invoiceId, status, webhookData);
            processedAction = `status_updated_${status}`;
            logger.info("📝 Invoice status updated", {
                invoiceId,
                newStatus: status,
            });
        }
        // セキュア処理ログを保存
        const logDocId = await (0, security_1.saveSecureWebhookLog)(verification, request, Date.now() - startTime, processedAction, apiKey);
        const duration = Date.now() - startTime;
        logger.info("Secure webhook processing completed", {
            documentId: logDocId,
            invoiceId,
            status,
            processedAction,
            duration: `${duration}ms`,
        });
        // OpenNodeに成功レスポンス返却
        response.status(200).json({
            success: true,
            message: "Secure webhook processed successfully",
            data: {
                invoiceId,
                status,
                processedAction,
                verificationPassed: true,
                timestamp: new Date().toISOString(),
                processingTime: `${duration}ms`,
            },
        });
    }
    catch (error) {
        const duration = Date.now() - startTime;
        logger.error("Secure webhook processing failed", {
            error: error.message,
            stack: error.stack,
            duration: `${duration}ms`,
        });
        response.status(500).json({
            error: "Secure webhook processing failed",
            message: error.message,
            timestamp: new Date().toISOString(),
        });
    }
});
//# sourceMappingURL=opennodeSecure.js.map-e 
### FILE: ./lib/webhook/index.js

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.opennodeWebhookSecure = void 0;
// src/webhook/index.ts
var opennodeSecure_1 = require("./opennodeSecure");
Object.defineProperty(exports, "opennodeWebhookSecure", { enumerable: true, get: function () { return opennodeSecure_1.opennodeWebhookSecure; } });
//# sourceMappingURL=index.js.map-e 
### FILE: ./lib/webhook/opennode.js

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.opennodeWebhookSecure = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const params_1 = require("firebase-functions/params");
const security_1 = require("../shared/middleware/security");
const paymentHelpers_1 = require("../shared/utils/paymentHelpers");
// 環境変数定義
const opennodeApiKey = (0, params_1.defineString)("OPENNODE_API_KEY", {
    description: "OpenNode API Key for webhook verification",
    default: "",
});
/**
 * セキュリティ検証付きOpenNode Webhook処理関数
 * HMAC-SHA256署名検証を実装
 */
exports.opennodeWebhookSecure = (0, https_1.onRequest)({
    region: "asia-northeast1",
    memory: "256MiB",
    timeoutSeconds: 60,
    cors: true,
}, async (request, response) => {
    var _a;
    const startTime = Date.now();
    try {
        logger.info("OpenNode Secure Webhook received", {
            method: request.method,
            timestamp: new Date().toISOString(),
            userAgent: request.get("User-Agent"),
            contentType: request.get("Content-Type"),
        });
        // POSTメソッドのみ受け付け
        if (request.method !== "POST") {
            logger.warn("Invalid HTTP method for secure webhook", {
                method: request.method,
                ip: request.ip,
            });
            response.status(405).json({
                error: "Method not allowed",
                message: "Only POST method is allowed",
            });
            return;
        }
        // API Key チェック
        const apiKey = opennodeApiKey.value();
        if (!apiKey) {
            logger.error("OpenNode API key not configured");
            response.status(500).json({
                error: "API key not configured",
            });
            return;
        }
        // Webhook検証
        const verification = (0, security_1.verifyWebhookPayload)(request.body, apiKey);
        if (!verification.isValid) {
            const statusCode = ((_a = verification.errorMessage) === null || _a === void 0 ? void 0 : _a.includes("Missing required")) ? 400 : 401;
            response.status(statusCode).json({
                error: verification.errorMessage,
                message: statusCode === 401 ? "Webhook verification failed - not from OpenNode" : undefined,
                details: statusCode === 400 ? {
                    invoiceId: !!verification.invoiceId,
                    hashedOrder: !!request.body.hashed_order,
                } : undefined,
            });
            // エラーログ保存
            await (0, security_1.saveSecureWebhookLog)(verification, request, Date.now() - startTime, "verification_failed", apiKey);
            return;
        }
        // 支払いステータス処理
        let processedAction = "none";
        const { invoiceId, status, webhookData } = verification;
        if (status === "paid") {
            // 支払い完了処理
            await (0, paymentHelpers_1.processPaymentSuccess)(invoiceId, webhookData);
            processedAction = "payment_completed";
            logger.info("💰 Payment processing completed", {
                invoiceId,
                amount: webhookData.price,
                fee: webhookData.fee,
            });
        }
        else if (status === "expired") {
            // 期限切れ処理
            await (0, paymentHelpers_1.processPaymentExpired)(invoiceId, webhookData);
            processedAction = "payment_expired";
            logger.info("⏰ Payment expired", {
                invoiceId,
            });
        }
        else {
            // その他のステータス更新
            await (0, paymentHelpers_1.updateInvoiceStatus)(invoiceId, status, webhookData);
            processedAction = `status_updated_${status}`;
            logger.info("📝 Invoice status updated", {
                invoiceId,
                newStatus: status,
            });
        }
        // セキュア処理ログを保存
        const logDocId = await (0, security_1.saveSecureWebhookLog)(verification, request, Date.now() - startTime, processedAction, apiKey);
        const duration = Date.now() - startTime;
        logger.info("Secure webhook processing completed", {
            documentId: logDocId,
            invoiceId,
            status,
            processedAction,
            duration: `${duration}ms`,
        });
        // OpenNodeに成功レスポンス返却
        response.status(200).json({
            success: true,
            message: "Secure webhook processed successfully",
            data: {
                invoiceId,
                status,
                processedAction,
                verificationPassed: true,
                timestamp: new Date().toISOString(),
                processingTime: `${duration}ms`,
            },
        });
    }
    catch (error) {
        const duration = Date.now() - startTime;
        logger.error("Secure webhook processing failed", {
            error: error.message,
            stack: error.stack,
            duration: `${duration}ms`,
        });
        response.status(500).json({
            error: "Secure webhook processing failed",
            message: error.message,
            timestamp: new Date().toISOString(),
        });
    }
});
//# sourceMappingURL=opennode.js.map