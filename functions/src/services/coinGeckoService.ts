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
