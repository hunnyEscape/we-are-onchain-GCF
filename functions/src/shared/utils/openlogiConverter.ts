// src/shared/utils/openlogiConverter.ts
// OpenLogi形式への変換ロジック

import * as logger from "firebase-functions/logger";
import {
	OpenLogiShipmentRequest,
	DomesticShipmentRequest,
	InternationalShipmentRequest,
	ConversionMetadata
} from '../types/openlogi';
import {
	OPENLOGI_DEFAULTS,
	VALIDATION_RULES,
	ERROR_MESSAGES,
	convertUSDToJPY,
	mapProductId
} from '../config/openlogiConfig';

/**
 * バリデーション関数群
 */

export function validateInvoiceData(invoiceData: any): void {
	if (!invoiceData) {
		throw new Error(ERROR_MESSAGES.INVOICE_NOT_FOUND);
	}

	// 必須フィールドチェック
	for (const field of VALIDATION_RULES.INVOICE_REQUIRED_FIELDS) {
		if (!invoiceData[field]) {
			throw new Error(`Missing required invoice field: ${field}`);
		}
	}

	// cartSnapshotのバリデーション
	const cartSnapshot = invoiceData.cartSnapshot;
	for (const field of VALIDATION_RULES.CART_SNAPSHOT_REQUIRED_FIELDS) {
		if (!cartSnapshot[field]) {
			throw new Error(`Missing required cartSnapshot field: ${field}`);
		}
	}

	// 商品アイテムのバリデーション
	if (!Array.isArray(cartSnapshot.items) || cartSnapshot.items.length === 0) {
		throw new Error("Cart items must be a non-empty array");
	}

	if (cartSnapshot.items.length > VALIDATION_RULES.MAX_ITEMS) {
		throw new Error(`Too many items: ${cartSnapshot.items.length} (max: ${VALIDATION_RULES.MAX_ITEMS})`);
	}

	// 各商品アイテムのバリデーション
	cartSnapshot.items.forEach((item: any, index: number) => {
		for (const field of VALIDATION_RULES.CART_ITEM_REQUIRED_FIELDS) {
			if (!item[field]) {
				throw new Error(`Missing required field '${field}' in cart item ${index}`);
			}
		}

		if (typeof item.quantity !== 'number' || item.quantity <= 0) {
			throw new Error(`Invalid quantity for item ${index}: ${item.quantity}`);
		}
	});

	// 金額バリデーション
	if (typeof invoiceData.amount_usd !== 'number' || invoiceData.amount_usd <= 0) {
		throw new Error(`Invalid amount_usd: ${invoiceData.amount_usd}`);
	}
}

export function validateUserAddress(userAddress: any): void {
	if (!userAddress) {
		throw new Error(ERROR_MESSAGES.ADDRESS_INVALID);
	}

	if (!userAddress.shippingRequest) {
		throw new Error(ERROR_MESSAGES.MISSING_SHIPPING_REQUEST);
	}

	const shippingRequest = userAddress.shippingRequest;

	// 必須フィールドチェック
	for (const field of VALIDATION_RULES.SHIPPING_REQUEST_REQUIRED_FIELDS) {
		if (shippingRequest[field] === undefined) {
			throw new Error(`Missing required shippingRequest field: ${field}`);
		}
	}

	// recipient情報のバリデーション
	const recipient = shippingRequest.recipient;
	if (!recipient) {
		throw new Error("Missing recipient information");
	}

	for (const field of VALIDATION_RULES.RECIPIENT_REQUIRED_FIELDS) {
		if (!recipient[field]) {
			throw new Error(`Missing required recipient field: ${field}`);
		}
	}

	// 国際配送の場合の追加バリデーション
	if (shippingRequest.international) {
		if (!recipient.region_code) {
			throw new Error("Missing region_code for international shipping");
		}
		if (!recipient.city) {
			throw new Error("Missing city for international shipping");
		}
	} else {
		// 国内配送の場合
		if (!recipient.prefecture) {
			throw new Error("Missing prefecture for domestic shipping");
		}
	}
}

/**
 * 変換メタデータ生成
 */
export function generateConversionMetadata(
	invoiceData: any,
	userAddress: any,
	processingStartTime: number
): ConversionMetadata {
	const processingTime = Date.now() - processingStartTime;
	const exchangeRate = OPENLOGI_DEFAULTS.USD_TO_JPY_RATE;

	return {
		shippingType: userAddress.shippingRequest.international ? 'international' : 'domestic',
		currencyConversion: {
			originalUSD: invoiceData.amount_usd,
			convertedJPY: convertUSDToJPY(invoiceData.amount_usd, exchangeRate),
			exchangeRate
		},
		itemCount: invoiceData.cartSnapshot.items.length,
		processingTime: `${processingTime}ms`
	};
}

/**
 * 商品リスト変換
 */
export function convertCartItemsToOpenLogiItems(cartItems: any[]): any[] {
	return cartItems.map(item => ({
		product_id: mapProductId(item.id),
		quantity: item.quantity
	}));
}

/**
 * 基本リクエストデータ生成
 */
export function generateBaseRequest(invoiceData: any, userAddress: any): any {
	const exchangeRate = OPENLOGI_DEFAULTS.USD_TO_JPY_RATE;

	return {
		// 基本識別情報
		identifier: invoiceData.id,
		order_no: invoiceData.sessionId,
		warehouse: OPENLOGI_DEFAULTS.WAREHOUSE_CODE,

		// 金額情報（USD→JPY変換）
		subtotal_amount: convertUSDToJPY(invoiceData.cartSnapshot.subtotal, exchangeRate),
		delivery_charge: convertUSDToJPY(userAddress.shippingFee || 0, exchangeRate),
		total_amount: convertUSDToJPY(invoiceData.amount_usd, exchangeRate),

		// 商品リスト
		items: convertCartItemsToOpenLogiItems(invoiceData.cartSnapshot.items),

		// 配送先住所
		recipient: userAddress.shippingRequest.recipient,

		// デフォルト設定適用
		...OPENLOGI_DEFAULTS.PACKAGING_DEFAULTS,
		...OPENLOGI_DEFAULTS.INVOICE_DEFAULTS,
		...OPENLOGI_DEFAULTS.SYSTEM_DEFAULTS,

		// 発送元住所
		sender: OPENLOGI_DEFAULTS.SENDER_ADDRESS
	};
}

/**
 * 国内配送リクエスト生成
 */
export function generateDomesticRequest(baseRequest: any, shippingRequest: any): DomesticShipmentRequest {
	return {
		...baseRequest,
		international: false,
		delivery_carrier: shippingRequest.delivery_carrier || "YAMATO",
		delivery_method: shippingRequest.delivery_method || "HOME_BOX",
		delivery_time_slot: shippingRequest.delivery_time_slot
	};
}

/**
 * 国際配送リクエスト生成
 */
export function generateInternationalRequest(baseRequest: any, shippingRequest: any): InternationalShipmentRequest {
	return {
		...baseRequest,
		international: true,
		delivery_service: shippingRequest.delivery_service || OPENLOGI_DEFAULTS.INTERNATIONAL_DEFAULTS.delivery_service,
		currency_code: OPENLOGI_DEFAULTS.INTERNATIONAL_DEFAULTS.currency_code,
		insurance: shippingRequest.insurance ?? OPENLOGI_DEFAULTS.INTERNATIONAL_DEFAULTS.insurance,
		purpose: shippingRequest.purpose || OPENLOGI_DEFAULTS.INTERNATIONAL_DEFAULTS.purpose
	};
}

/**
 * メイン変換関数
 */
export function convertToOpenLogiFormat(
	invoiceData: any,
	userAddress: any
): OpenLogiShipmentRequest {
	const startTime = Date.now();

	try {
		// バリデーション
		validateInvoiceData(invoiceData);
		validateUserAddress(userAddress);

		logger.info("Starting OpenLogi conversion", {
			invoiceId: invoiceData.id,
			isInternational: userAddress.shippingRequest.international,
			itemCount: invoiceData.cartSnapshot.items.length
		});

		// 基本リクエストデータ生成
		const baseRequest = generateBaseRequest(invoiceData, userAddress);

		// 国内/国際配送で分岐
		const shippingRequest = userAddress.shippingRequest;
		let openlogiRequest: OpenLogiShipmentRequest;

		if (shippingRequest.international) {
			openlogiRequest = generateInternationalRequest(baseRequest, shippingRequest);
			logger.info("Generated international shipping request", {
				invoiceId: invoiceData.id,
				deliveryService: openlogiRequest.delivery_service,
				destination: openlogiRequest.recipient.region_code
			});
		} else {
			openlogiRequest = generateDomesticRequest(baseRequest, shippingRequest);
			logger.info("Generated domestic shipping request", {
				invoiceId: invoiceData.id,
				deliveryCarrier: openlogiRequest.delivery_carrier,
				prefecture: openlogiRequest.recipient.prefecture
			});
		}

		// 最終バリデーション
		validateGeneratedRequest(openlogiRequest);

		const processingTime = Date.now() - startTime;
		logger.info("OpenLogi conversion completed", {
			invoiceId: invoiceData.id,
			processingTime: `${processingTime}ms`
		});

		return openlogiRequest;

	} catch (error: any) {
		const processingTime = Date.now() - startTime;
		logger.error("OpenLogi conversion failed", {
			invoiceId: invoiceData?.id,
			error: error.message,
			processingTime: `${processingTime}ms`
		});
		throw error;
	}
}

/**
 * 生成されたリクエストの最終バリデーション
 */
function validateGeneratedRequest(request: OpenLogiShipmentRequest): void {
	// 金額範囲チェック
	if (request.total_amount && (request.total_amount > VALIDATION_RULES.MAX_AMOUNT_JPY || request.total_amount < VALIDATION_RULES.MIN_AMOUNT_JPY)) {
		throw new Error(`Total amount out of range: ${request.total_amount}`);
	}

	// メッセージ長さチェック
	if (request.message && request.message.length > VALIDATION_RULES.MAX_MESSAGE_LENGTH) {
		throw new Error(`Message too long: ${request.message.length} characters (max: ${VALIDATION_RULES.MAX_MESSAGE_LENGTH})`);
	}

	// 必須フィールド最終チェック
	if (!request.identifier || !request.order_no || !request.items || request.items.length === 0) {
		throw new Error("Missing required fields in generated request");
	}
}