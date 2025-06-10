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
}