// src/shared/config/openlogiConfig.ts
// OpenLogi API設定値

import { DomesticRecipient } from '../types/openlogi';

// API設定
export const OPENLOGI_API_CONFIG = {
  BASE_URL: "https://api.openlogi.com/v1",
  ENDPOINTS: {
    SHIPMENTS: "/shipments"
  },
  TIMEOUT: 30000, // 30秒
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
}