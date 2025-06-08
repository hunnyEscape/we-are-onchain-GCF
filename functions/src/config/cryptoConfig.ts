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
};