// src/shared/types/openlogiShipment.ts
// OpenLogi 出荷依頼専用型定義（動作実績ベース）

/**
 * 出荷依頼リクエスト型（動作実績形式）
 */
export interface ShipmentRequestPayload {
	// 🔑 基本情報
	identifier: string;                    // 識別番号
	order_no: string;                      // 注文番号

	// 💰 金額情報
	subtotal_amount: number;               // 小計
	delivery_charge: number;               // 配送料
	handling_charge: number;               // 手数料（通常0）
	discount_amount: number;               // 割引額（通常0）
	total_amount: number;                  // 合計

	// 🎁 梱包・ラッピング
	cushioning_unit: "ORDER" | "ITEM";                        // 緩衝材単位
	cushioning_type: "BUBBLE_PACK" | "BUBBLE_DOUBLE_PACK";    // 緩衝材種別
	gift_wrapping_unit: "ORDER" | "ITEM" | null;              // ギフトラッピング単位
	gift_wrapping_type: "NAVY" | "RED" | null;                // ギフトラッピングタイプ

	// 📧 連絡先・通知
	shipping_email: string | null;         // 配送先連絡メールアドレス

	// 📄 明細書設定
	delivery_note_type: "NOT_INCLUDE_PII" | "NONE";          // 明細書の同梱設定
	price_on_delivery_note: boolean;                         // 明細書への金額印字指定
	message: string;                                         // 明細書メッセージ

	// ⏸️ 処理制御
	suspend: boolean;                      // 保留フラグ
	cash_on_delivery: boolean;             // 代金引換指定
	backorder_if_unavailable: boolean;     // 出荷単位の出荷予約フラグ
	allocate_priority: number;             // 引当優先順位（1-3）

	// 🚚 配送設定
	delivery_carrier: "YAMATO" | "SAGAWA"; // 配送会社
	delivery_method: "HOME_BOX" | "POST_EXPRESS"; // 配送便指定

	// 🛍️ 商品リスト（動作実績形式：codeフィールド）
	items: Array<{
		code: string;                      // 商品コード
		quantity: number;                  // 数量
	}>;

	// 🌐 国際配送
	international: boolean;                // 海外発送指定

	// 📮 住所情報
	sender: SenderAddress;                 // 発送元住所
	recipient: RecipientAddress;           // 発送先住所
}

/**
 * 発送元住所（固定）
 */
export interface SenderAddress {
	postcode: string;                      // 郵便番号
	prefecture: string;                    // 都道府県
	address1: string;                      // 住所1
	address2: string;                      // 住所2
	name: string;                          // 名前
	company: string;                       // 会社名
	division: string;                      // 部署
	phone: string;                         // 電話番号
}

/**
 * 配送先住所（動的）
 */
export interface RecipientAddress {
	postcode: string;                      // 郵便番号
	prefecture: string;                    // 都道府県
	address1: string;                      // 住所1
	address2?: string;                     // 住所2
	name: string;                          // 受取人名
	phone: string;                         // 電話番号
}

/**
 * 出荷依頼APIレスポンス（成功時）
 */
export interface ShipmentApiSuccessResponse {
	id: string;                            // 出荷依頼ID
	identifier: string;                    // 識別番号
	order_no: string;                      // 注文番号
	status: string;                        // ステータス
	subtotal_amount?: number;              // 小計
	delivery_charge?: number;              // 配送料
	total_amount?: number;                 // 合計
	delivery_carrier?: string;             // 配送会社
	delivery_method?: string;              // 配送方法
	warehouse?: string;                    // 倉庫
	created_at?: string;                   // 作成日時
	updated_at?: string;                   // 更新日時
	[key: string]: any;                    // その他のフィールド
}

/**
 * Invoice → OpenLogi 変換結果
 */
export interface InvoiceToShipmentResult {
	success: boolean;
	shipmentPayload?: ShipmentRequestPayload;
	conversionMetadata?: {
		invoiceId: string;
		shippingType: 'domestic' | 'international';
		currencyConversion: {
			originalUSD: number;
			convertedJPY: number;
			exchangeRate: number;
		};
		itemCount: number;
		processingTime: string;
	};
	error?: {
		type: string;
		message: string;
		details?: any;
	};
}

/**
 * 完全な出荷依頼処理結果
 */
export interface ShipmentSubmissionResult {
	success: boolean;
	invoiceId: string;
	message: string;
	data?: {
		shipmentResponse: ShipmentApiSuccessResponse;
		conversionMetadata: {
			invoiceId: string;
			shippingType: 'domestic' | 'international';
			currencyConversion: {
				originalUSD: number;
				convertedJPY: number;
				exchangeRate: number;
			};
			itemCount: number;
			processingTime: string;
		};
		requestDetails: {
			url: string;
			method: string;
			processingTime: string;
			timestamp: string;
		};
	};
	error?: {
		type: 'INVOICE_ERROR' | 'CONVERSION_ERROR' | 'API_ERROR' | 'NETWORK_ERROR' | 'VALIDATION_ERROR';
		message: string;
		details?: any;
		troubleshooting?: string[];
	};
	debugInfo?: {
		shipmentPayload?: ShipmentRequestPayload;
		apiResponse?: any;
		validationErrors?: string[];
	};
	timestamp: string;
}

/**
 * 出荷依頼オプション
 */
export interface ShipmentSubmissionOptions {
	validateOnly?: boolean;               // 検証のみ（実際の送信なし）
	includeDebugInfo?: boolean;           // デバッグ情報含める
	testMode?: boolean;                   // テストモード
	usdToJpyRate?: number;               // カスタム為替レート
}

/**
 * リクエストバリデーション結果
 */
export interface ValidationResult {
	isValid: boolean;
	errors: Array<{
		field: string;
		message: string;
		value?: any;
	}>;
	warnings?: Array<{
		field: string;
		message: string;
		suggestion?: string;
	}>;
}