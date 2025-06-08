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
### FILE: ./src/index.ts

import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import * as logger from "firebase-functions/logger";
import { defineString } from "firebase-functions/params";

import { CoinGeckoService } from "./services/coinGeckoService";
import { FirestoreService } from "./services/firestoreService";
import { CRYPTO_CONFIG, API_CONFIG } from "./config/cryptoConfig";
import { getFirestore } from "firebase-admin/firestore";
import * as crypto from "crypto";
// Firebase Admin初期化
initializeApp();
const db = getFirestore();


// 環境変数定義
const coinGeckoApiKey = defineString("COINGECKO_API_KEY", {
	description: "CoinGecko API Key",
	default: "demo",
});
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

    // Webhookデータを取得
    const webhookData = request.body;
    const {id: invoiceId, hashed_order: receivedHash, status} = webhookData;

    logger.info("Webhook payload for verification", {
      invoiceId,
      status,
      hasHashedOrder: !!receivedHash,
      payloadKeys: Object.keys(webhookData || {}),
    });

    //――――――――――――――――――――――――――――――――――――――――――――――――――――
    // セキュリティ検証（重要！）
    //――――――――――――――――――――――――――――――――――――――――――――――――――――
    const apiKey = opennodeApiKey.value();
    if (!apiKey) {
      logger.error("OpenNode API key not configured");
      response.status(500).json({
        error: "API key not configured",
      });
      return;
    }

    if (!invoiceId || !receivedHash) {
      logger.warn("Missing required fields for verification", {
        hasInvoiceId: !!invoiceId,
        hasHashedOrder: !!receivedHash,
      });

      response.status(400).json({
        error: "Missing required verification fields",
        details: {
          invoiceId: !!invoiceId,
          hashedOrder: !!receivedHash,
        },
      });
      return;
    }

    // HMAC-SHA256で署名を再計算
    const calculatedHash = crypto
      .createHmac("sha256", apiKey)
      .update(invoiceId)
      .digest("hex");

    // 署名検証
    if (receivedHash !== calculatedHash) {
      logger.error("Webhook signature verification failed", {
        invoiceId,
        receivedHash: receivedHash.substring(0, 16) + "...",
        calculatedHash: calculatedHash.substring(0, 16) + "...",
        lengthMatch: receivedHash.length === calculatedHash.length,
      });

      response.status(401).json({
        error: "Invalid webhook signature",
        message: "Webhook verification failed - not from OpenNode",
      });
      return;
    }

    logger.info("✅ Webhook signature verified successfully", {
      invoiceId,
      hashPrefix: calculatedHash.substring(0, 16) + "...",
    });

    //――――――――――――――――――――――――――――――――――――――――――――――――――――
    // 支払いステータス処理
    //――――――――――――――――――――――――――――――――――――――――――――――――――――
    const timestamp = new Date();
    const docId = `SECURE-${timestamp.toISOString().replace(/[:.]/g, "-")}`;

    let processedAction = "none";

    if (status === "paid") {
      // 支払い完了処理
      await processPaymentSuccess(invoiceId, webhookData);
      processedAction = "payment_completed";
      
      logger.info("💰 Payment processing completed", {
        invoiceId,
        amount: webhookData.price,
        fee: webhookData.fee,
      });

    } else if (status === "expired") {
      // 期限切れ処理
      await processPaymentExpired(invoiceId, webhookData);
      processedAction = "payment_expired";
      
      logger.info("⏰ Payment expired", {
        invoiceId,
      });

    } else {
      // その他のステータス更新
      await updateInvoiceStatus(invoiceId, status, webhookData);
      processedAction = `status_updated_${status}`;
      
      logger.info("📝 Invoice status updated", {
        invoiceId,
        newStatus: status,
      });
    }

    // セキュア処理ログをFirestoreに保存
    const secureLogData = {
      receivedAt: timestamp,
      webhookData,
      verificationResult: {
        signatureValid: true,
        invoiceId,
        status,
        processedAction,
      },
      source: "opennode-verified",
      method: request.method,
      headers: {
        contentType: request.get("Content-Type"),
        userAgent: request.get("User-Agent"),
      },
      metadata: {
        processingTime: `${Date.now() - startTime}ms`,
        success: true,
        apiKeyUsed: apiKey.substring(0, 8) + "***",
      },
    };

    await db.collection("SecureWebhookLogs").doc(docId).set(secureLogData);

    const duration = Date.now() - startTime;

    logger.info("Secure webhook processing completed", {
      documentId: docId,
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
        timestamp: timestamp.toISOString(),
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

    // セキュリティエラーも記録
    try {
      const errorTimestamp = new Date();
      const errorDocId = `SECURE-ERROR-${errorTimestamp.toISOString().replace(/[:.]/g, "-")}`;

      await db.collection("SecureWebhookLogs").doc(errorDocId).set({
        receivedAt: errorTimestamp,
        error: true,
        errorMessage: error.message,
        rawBody: request.body,
        source: "opennode-secure-error",
        metadata: {
          processingTime: `${duration}ms`,
          success: false,
        },
      });
    } catch (saveError: any) {
      logger.error("Failed to save secure error log", {
        saveError: saveError.message,
      });
    }

    response.status(500).json({
      error: "Secure webhook processing failed",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

//――――――――――――――――――――――――――――――――――――――――――――――――――――
// 支払い処理ヘルパー関数
//――――――――――――――――――――――――――――――――――――――――――――――――――――

/**
 * 支払い成功処理
 */
async function processPaymentSuccess(invoiceId: string, webhookData: any): Promise<void> {
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
async function processPaymentExpired(invoiceId: string, webhookData: any): Promise<void> {
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
async function updateInvoiceStatus(invoiceId: string, status: string, webhookData: any): Promise<void> {
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
exports.updateCryptoPrices = exports.opennodeWebhookSecure = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const app_1 = require("firebase-admin/app");
const logger = __importStar(require("firebase-functions/logger"));
const params_1 = require("firebase-functions/params");
const coinGeckoService_1 = require("./services/coinGeckoService");
const firestoreService_1 = require("./services/firestoreService");
const cryptoConfig_1 = require("./config/cryptoConfig");
const firestore_1 = require("firebase-admin/firestore");
const crypto = __importStar(require("crypto"));
// Firebase Admin初期化
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
// 環境変数定義
const coinGeckoApiKey = (0, params_1.defineString)("COINGECKO_API_KEY", {
    description: "CoinGecko API Key",
    default: "demo",
});
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
        // Webhookデータを取得
        const webhookData = request.body;
        const { id: invoiceId, hashed_order: receivedHash, status } = webhookData;
        logger.info("Webhook payload for verification", {
            invoiceId,
            status,
            hasHashedOrder: !!receivedHash,
            payloadKeys: Object.keys(webhookData || {}),
        });
        //――――――――――――――――――――――――――――――――――――――――――――――――――――
        // セキュリティ検証（重要！）
        //――――――――――――――――――――――――――――――――――――――――――――――――――――
        const apiKey = opennodeApiKey.value();
        if (!apiKey) {
            logger.error("OpenNode API key not configured");
            response.status(500).json({
                error: "API key not configured",
            });
            return;
        }
        if (!invoiceId || !receivedHash) {
            logger.warn("Missing required fields for verification", {
                hasInvoiceId: !!invoiceId,
                hasHashedOrder: !!receivedHash,
            });
            response.status(400).json({
                error: "Missing required verification fields",
                details: {
                    invoiceId: !!invoiceId,
                    hashedOrder: !!receivedHash,
                },
            });
            return;
        }
        // HMAC-SHA256で署名を再計算
        const calculatedHash = crypto
            .createHmac("sha256", apiKey)
            .update(invoiceId)
            .digest("hex");
        // 署名検証
        if (receivedHash !== calculatedHash) {
            logger.error("Webhook signature verification failed", {
                invoiceId,
                receivedHash: receivedHash.substring(0, 16) + "...",
                calculatedHash: calculatedHash.substring(0, 16) + "...",
                lengthMatch: receivedHash.length === calculatedHash.length,
            });
            response.status(401).json({
                error: "Invalid webhook signature",
                message: "Webhook verification failed - not from OpenNode",
            });
            return;
        }
        logger.info("✅ Webhook signature verified successfully", {
            invoiceId,
            hashPrefix: calculatedHash.substring(0, 16) + "...",
        });
        //――――――――――――――――――――――――――――――――――――――――――――――――――――
        // 支払いステータス処理
        //――――――――――――――――――――――――――――――――――――――――――――――――――――
        const timestamp = new Date();
        const docId = `SECURE-${timestamp.toISOString().replace(/[:.]/g, "-")}`;
        let processedAction = "none";
        if (status === "paid") {
            // 支払い完了処理
            await processPaymentSuccess(invoiceId, webhookData);
            processedAction = "payment_completed";
            logger.info("💰 Payment processing completed", {
                invoiceId,
                amount: webhookData.price,
                fee: webhookData.fee,
            });
        }
        else if (status === "expired") {
            // 期限切れ処理
            await processPaymentExpired(invoiceId, webhookData);
            processedAction = "payment_expired";
            logger.info("⏰ Payment expired", {
                invoiceId,
            });
        }
        else {
            // その他のステータス更新
            await updateInvoiceStatus(invoiceId, status, webhookData);
            processedAction = `status_updated_${status}`;
            logger.info("📝 Invoice status updated", {
                invoiceId,
                newStatus: status,
            });
        }
        // セキュア処理ログをFirestoreに保存
        const secureLogData = {
            receivedAt: timestamp,
            webhookData,
            verificationResult: {
                signatureValid: true,
                invoiceId,
                status,
                processedAction,
            },
            source: "opennode-verified",
            method: request.method,
            headers: {
                contentType: request.get("Content-Type"),
                userAgent: request.get("User-Agent"),
            },
            metadata: {
                processingTime: `${Date.now() - startTime}ms`,
                success: true,
                apiKeyUsed: apiKey.substring(0, 8) + "***",
            },
        };
        await db.collection("SecureWebhookLogs").doc(docId).set(secureLogData);
        const duration = Date.now() - startTime;
        logger.info("Secure webhook processing completed", {
            documentId: docId,
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
                timestamp: timestamp.toISOString(),
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
        // セキュリティエラーも記録
        try {
            const errorTimestamp = new Date();
            const errorDocId = `SECURE-ERROR-${errorTimestamp.toISOString().replace(/[:.]/g, "-")}`;
            await db.collection("SecureWebhookLogs").doc(errorDocId).set({
                receivedAt: errorTimestamp,
                error: true,
                errorMessage: error.message,
                rawBody: request.body,
                source: "opennode-secure-error",
                metadata: {
                    processingTime: `${duration}ms`,
                    success: false,
                },
            });
        }
        catch (saveError) {
            logger.error("Failed to save secure error log", {
                saveError: saveError.message,
            });
        }
        response.status(500).json({
            error: "Secure webhook processing failed",
            message: error.message,
            timestamp: new Date().toISOString(),
        });
    }
});
//――――――――――――――――――――――――――――――――――――――――――――――――――――
// 支払い処理ヘルパー関数
//――――――――――――――――――――――――――――――――――――――――――――――――――――
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
/**
 * 手動で価格更新をトリガーするHTTP Function

export const manualUpdateCryptoPrices = onRequest({
    region: "asia-northeast1",
    memory: "256MiB",
    timeoutSeconds: 60,
    cors: true,
}, async (req, res) => {
    const startTime = Date.now();

    try {
        // POSTメソッドのみ許可
        if (req.method !== "POST") {
            res.status(405).json({
                error: "Method not allowed",
                message: "Only POST method is allowed",
            });
            return;
        }

        logger.info("Manual crypto price update triggered", {
            timestamp: new Date().toISOString(),
            userAgent: req.get("User-Agent"),
            ip: req.ip,
        });

        const firestoreService = new FirestoreService();
        const coinGeckoService = new CoinGeckoService(coinGeckoApiKey.value());

        // API使用状況確認
        const apiUsage = await coinGeckoService.checkApiUsage();

        if (apiUsage.remaining < API_CONFIG.RATE_LIMIT_BUFFER) {
            res.status(429).json({
                error: "Rate limit exceeded",
                message: `API rate limit approaching: ${apiUsage.remaining} calls remaining`,
                remaining: apiUsage.remaining,
            });
            return;
        }

        // 価格データ取得・保存
        const coinIds = CRYPTO_CONFIG.currencies.map((c) => c.id);
        const prices = await coinGeckoService.getCryptoPrices(coinIds);
        await firestoreService.saveCryptoPrices(prices);
        await firestoreService.updateMetadata("success", {
            rateLimitRemaining: apiUsage.remaining - 1,
        });

        const duration = Date.now() - startTime;

        res.status(200).json({
            success: true,
            message: "Crypto prices updated successfully",
            data: {
                pricesUpdated: prices.length,
                duration: `${duration}ms`,
                timestamp: new Date().toISOString(),
                currencies: prices.map((p) => ({
                    symbol: p.symbol.toUpperCase(),
                    price: p.current_price,
                    change24h: p.price_change_percentage_24h,
                })),
                apiUsage: {
                    remaining: apiUsage.remaining - 1,
                    limit: apiUsage.limit,
                },
            },
        });

        logger.info("Manual crypto price update completed", {
            duration: `${duration}ms`,
            pricesUpdated: prices.length,
        });
    } catch (error: any) {
        const duration = Date.now() - startTime;
        logger.error("Manual crypto price update failed", {
            error: error.message,
            stack: error.stack,
            duration: `${duration}ms`,
        });

        res.status(500).json({
            error: "Internal server error",
            message: error.message,
            timestamp: new Date().toISOString(),
            duration: `${duration}ms`,
        });
    }
});
 */
/**
 * API使用状況を確認するHTTP Function

export const checkApiUsage = onRequest({
    region: "asia-northeast1",
    memory: "128MiB",
    timeoutSeconds: 30,
    cors: true,
}, async (req, res) => {
    try {
        if (req.method !== "GET") {
            res.status(405).json({ error: "Method not allowed" });
            return;
        }

        const coinGeckoService = new CoinGeckoService(coinGeckoApiKey.value());
        const firestoreService = new FirestoreService();

        const [apiUsage, lastSyncTime] = await Promise.all([
            coinGeckoService.checkApiUsage(),
            firestoreService.getLastSyncTime(),
        ]);

        res.status(200).json({
            success: true,
            data: {
                apiUsage: {
                    remaining: apiUsage.remaining,
                    limit: apiUsage.limit,
                    resetTime: apiUsage.resetTime,
                },
                lastSyncTime: lastSyncTime?.toISOString() || null,
                configuration: {
                    updateInterval: API_CONFIG.UPDATE_INTERVAL_MINUTES,
                    supportedCurrencies: CRYPTO_CONFIG.currencies.map((c) => c.symbol),
                },
                timestamp: new Date().toISOString(),
            },
        });
    } catch (error: any) {
        logger.error("Failed to check API usage", { error: error.message });

        res.status(500).json({
            error: "Internal server error",
            message: error.message,
            timestamp: new Date().toISOString(),
        });
    }
});
 */ 
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
// src/shared/utils/paymentHelpers.ts
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
// src/shared/middleware/security.ts
const firestore_1 = require("firebase-admin/firestore");
const logger = __importStar(require("firebase-functions/logger"));
const crypto = __importStar(require("crypto"));
const db = (0, firestore_1.getFirestore)();
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
        await db.collection("SecureWebhookLogs").doc(docId).set(logData);
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
//# sourceMappingURL=index.js.map