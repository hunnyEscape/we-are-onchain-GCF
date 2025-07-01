import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { defineString } from "firebase-functions/params";
import { CoinGeckoService } from "../services/coinGeckoService";
import { FirestoreService } from "../services/firestoreService";
import { CRYPTO_CONFIG, API_CONFIG } from "../config/cryptoConfig";

// 環境変数定
const coinGeckoApiKey = defineString("COINGECKO_API_KEY", {
  description: "CoinGecko API Key",
  default: "demo",
});

/**
 * 5分間隔で暗号通貨価格を更新するScheduled Function
 */
export const updateCryptoPrices = onSchedule({
  schedule: "*/15 * * * *", // 5分間隔
  timeZone: "UTC",
  region: "us-central1",
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