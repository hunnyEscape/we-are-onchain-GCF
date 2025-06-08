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
});

/**
 * 手動で価格更新をトリガーするHTTP Function
 */
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

/**
 * API使用状況を確認するHTTP Function
 */
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
