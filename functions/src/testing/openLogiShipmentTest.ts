// src/testing/openLogiShipmentTest.ts
// OpenLogi出荷依頼API呼び出しテスト

import { onRequest } from "firebase-functions/v2/https";

/**
 * OpenLogi出荷依頼API呼び出しテスト
 */
export const testOpenLogiShipment = onRequest({
	region: "asia-northeast1",
	memory: "256MiB",
	timeoutSeconds: 60,
	cors: true,
}, async (request, response) => {

	try {
		// 🔑 APIキー（テスト環境用）
		const API_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiMGE1OTRkM2Q0Y2IwYWY5NTMzNjkzNTU5NjY0M2I1NjllYTdiZjk4NjAxNDY5MDNlNTg0ODBiOTZkYmM1MTJmZDBlYWUxY2NkNGNkYmZkOWQiLCJpYXQiOjE3NDk1MTc4MzcuNzg2MDU0LCJuYmYiOjE3NDk1MTc4MzcuNzg2MDU3LCJleHAiOjE3ODEwNTM4MzcuNzU3MjkzLCJzdWIiOiJkMjVmNTUwNi1jNzNiLTQyOTQtOGQ4Ny0zYzNkZWUyYTU5N2QiLCJzY29wZXMiOltdfQ.Ge3Mqqp-r44aZYeCg3S_NbF4_UKG1xnQjlkco7cOfjPCsxnJTFWrWrvsnCuGtZHHrAkTY3SFjUOIwt_eGeSJ8D9rhS-y8j4XKQVVaEOLta-GCunQwH26Wx3pUJVZ3YMFiq0-ao0QZi9iGopOj5W9OEIzu5w0HRqWJ4C3W0IgClVLax7nYT_3Jx9RG3DjUg57gr9v1iJ1qj6J3sOMR8_TtSr4CZwkIetGzObk6ZELYS1T1_mbiGs74EwqqilmqZk_1_I4vBvdFLjaBT6EYyQ4JmDZ1ljPGTLy7c8AGXBz8Um3lpyHvv4jJw5XO0ziIHYMKb6Z6cVdHUWduPtrxsfWTib-i-jqbF0PQudSz-So4VhwvvJO1DgSkqRSq67eqVqDGcBsxn8SqQgj6Z9aarBEg-9Y2wL8Sn_I2YqSG9IqIcePq_TARSnGiaAvTPF88_FaIHjcbQZegfG3m9Zy1Zu4dBuOvW_MG4TU9kSxLByIGoNrqDylCtybz8O5WhdRd8XdHw2RwpPc_1ZB79yM-FGfo832tgHCrBZzdG2gqSJbnCe4x6aHg81mDUrzEglCBdco8REgRvvBiked6bQTx8NaU6wc38TD5LblZ7feW_V3Kq6sAbSfXW87ZRGpJ-zbCSWq43EheMh8iLTNowO9jO5vqpvyB14xh5-umGm5iQrz674";

		// 🎯 OpenLogi出荷依頼APIエンドポイント
		const apiUrl = "https://api-demo.openlogi.com/api/shipments";

		// 📦 ハードコードされた出荷依頼データ
		const shipmentPayload = {
			// 🔑 基本情報
			"identifier": "365130d0-9cd2-4a51-9a8e-68eae151b4",  // 1. 識別番号
			"order_no": "session_mbosyus8_fx9fe22dgp",              // 2. 注文番号

			// 💰 金額情報
			"subtotal_amount": 30,     // 3. 納品書 小計
			"delivery_charge": 15,     // 4. 納品書 配送料
			"handling_charge": 0,      // 5. 納品書 手数料
			"discount_amount": 0,      // 6. 納品書 割引額
			"total_amount": 45,        // 7. 納品書 合計

			// 🎁 梱包・ラッピング
			"cushioning_unit": "ORDER",        // 8. 緩衝材単位
			"cushioning_type": "BUBBLE_PACK",  // 9. 緩衝材種別
			"gift_wrapping_unit": null,        // 10. ギフトラッピング単位
			"gift_wrapping_type": null,        // 11. ギフトラッピングタイプ
			// "gift_sender_name": null,        // 12. ギフト贈り主氏名（未使用）
			// "bundled_items": null,           // 13. 同梱指定（未使用）

			// 📧 連絡先・通知
			"shipping_email": null,            // 14. 配送先連絡メールアドレス

			// 📄 明細書設定
			"delivery_note_type": "NOT_INCLUDE_PII",  // 15. 明細書の同梱設定
			"price_on_delivery_note": true,           // 16. 明細書への金額印字指定
			"message": "お買い上げありがとうございます。BTCプロテインをお楽しみください！",  // 17. 明細書メッセージ

			// ⏸️ 処理制御
			"suspend": false,  // 18. 保留フラグ
			// "shipping_date": null,           // 19. 出荷希望日（未使用）
			// "tax": null,                     // 20. 消費税（未使用）
			// "total_with_normal_tax": null,   // 21. 合計通常税率（未使用）
			// "total_with_reduced_tax": null,  // 22. 合計軽減税率（未使用）

			// 🏷️ ラベル設定
			//"label_note": "健康食品・プロテインバー",     // ラベル品名（より具体的に）

			// 🚚 配送設定
			"delivery_carrier": "YAMATO",      // 23. 配送会社
			// "delivery_time_slot": null,      // 24. 希望時間指定（未使用）
			// "delivery_date": null,           // 25. 配達希望日（未使用）

			// 💳 代金引換
			"cash_on_delivery": false,         // 26. 代金引換指定
			// "total_for_cash_on_delivery": null,  // 27. 代金引換総計（未使用）
			// "tax_for_cash_on_delivery": null,    // 28. 代金引換消費税（未使用）

			// 📦 配送方法・倉庫
			"delivery_method": "HOME_BOX",     // 29. 配送便指定
			// "delivery_options": null,        // 30. 受取人からの希望（未使用）
			// "warehouse": "OPL",             // 31. 倉庫コード（エラーのため標準倉庫を使用）

			// 🛍️ 商品リスト
			"items": [                         // 32. 配送商品リスト
				{
					"code": "protein-stick-trio",               // 商品ID（確実に存在する）
					"quantity": 1
				}
			],

			// 🌐 国際配送
			"international": false,            // 33. 海外発送指定
			// "delivery_service": null,        // 34. 配送サービス（国際配送時のみ）
			// "currency_code": null,           // 35. 海外発送用通貨コード（国際配送時のみ）
			// "insurance": null,               // 36. 海外発送用損害保証制度（国際配送時のみ）

			// ⚙️ その他設定
			"backorder_if_unavailable": true,  // 37. 出荷単位の出荷予約フラグ
			// "purpose": null,                 // 38. 輸出目的（国際配送時のみ）
			"allocate_priority": 3,            // 39. 引当優先順位（修正: 50→3 実際の上限は3）

			// 📮 住所情報
			"sender": {                        // 40. 発送元住所
				"postcode": "170-0013",
				"prefecture": "東京都",
				"address1": "豊島区東池袋1-34-5",
				"address2": "いちご東池袋ビル9F",
				"name": "BTC Flavor株式会社",
				"company": "BTC Flavor株式会社",
				"division": "配送部",
				"phone": "03-1234-5678"
			},
			"recipient": {                     // 41. 発送先住所（確実に動作する形式に変更）
				"postcode": "170-0014",        // 豊島区池袋の郵便番号
				"phone": "09013988216",
				"address2": "サンシャインビル10F",
				"prefecture": "東京都",
				"name": "Kohei Yamanes",
				"address1": "豊島区池袋2-1-1"  // senderと近い、確実に存在する住所
			}

			// "apply_rule": false             // 42. 出荷ルール適用フラグ（未使用）
		};

		console.log("=== OpenLogi出荷依頼APIテスト開始 ===");
		console.log("API URL:", apiUrl);
		console.log("Payload:", JSON.stringify(shipmentPayload, null, 2));

		// 🚀 OpenLogi API呼び出し
		const startTime = Date.now();

		const apiResponse = await fetch(apiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Api-Version': '1.5',
				'Authorization': `Bearer ${API_KEY}`,
				'User-Agent': 'GCF-OpenLogi-Shipment-Test/1.0'
			},
			body: JSON.stringify(shipmentPayload),
			signal: AbortSignal.timeout(30000)
		});

		const processingTime = Date.now() - startTime;

		// 📥 レスポンス処理
		let responseBody;
		const contentType = apiResponse.headers.get('content-type') || '';

		try {
			if (contentType.includes('application/json')) {
				responseBody = await apiResponse.json();
			} else {
				responseBody = await apiResponse.text();
			}
		} catch (e) {
			console.error("Response parsing error:", e);
			responseBody = "Failed to parse response";
		}

		console.log(`API Response [${apiResponse.status}]:`, responseBody);

		// 📊 結果判定とレスポンス生成
		const isSuccess = apiResponse.status >= 200 && apiResponse.status < 300;

		if (isSuccess) {
			// ✅ 成功時
			response.status(200).json({
				success: true,
				message: "🎉 OpenLogi出荷依頼API呼び出し成功！",
				apiResponse: {
					status: apiResponse.status,
					statusText: apiResponse.statusText,
					body: responseBody,
					headers: {
						'content-type': contentType,
						'x-ratelimit-remaining': apiResponse.headers.get('x-ratelimit-remaining')
					}
				},
				requestDetails: {
					url: apiUrl,
					method: 'POST',
					payload: shipmentPayload,
					processingTime: `${processingTime}ms`
				},
				timestamp: new Date().toISOString()
			});

		} else {
			// ❌ エラー時
			response.status(200).json({
				success: false,
				message: `❌ OpenLogi API呼び出し失敗 [${apiResponse.status}]`,
				error: {
					status: apiResponse.status,
					statusText: apiResponse.statusText,
					body: responseBody,
					headers: {
						'content-type': contentType
					}
				},
				requestDetails: {
					url: apiUrl,
					method: 'POST',
					payload: shipmentPayload,
					processingTime: `${processingTime}ms`
				},
				troubleshooting: {
					commonIssues: [
						"APIキーの有効性確認",
						"商品IDの存在確認",
						"住所フォーマットの確認",
						"必須パラメータの確認"
					]
				},
				timestamp: new Date().toISOString()
			});
		}

	} catch (error: any) {
		console.error("=== テスト実行エラー ===", error);

		response.status(200).json({
			success: false,
			message: "💥 テスト実行中にエラーが発生しました",
			error: {
				message: error.message,
				type: error.constructor.name,
				stack: error.stack
			},
			timestamp: new Date().toISOString()
		});
	}
});