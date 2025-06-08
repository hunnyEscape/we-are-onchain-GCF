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
}