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
