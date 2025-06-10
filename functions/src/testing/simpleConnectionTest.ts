// src/testing/simpleConnectionTest.ts
// 商品ID指定版OpenLogi接続テスト

import { onRequest } from "firebase-functions/v2/https";

/**
 * 商品ID指定版OpenLogi接続テスト
 */
export const simpleOpenLogiTest = onRequest({
	region: "asia-northeast1",
	memory: "256MiB",
	timeoutSeconds: 30,
	cors: true,
}, async (request, response) => {

	try {
		// 🔑 APIキー（実際のキーに置き換えてください）
		const API_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiMGE1OTRkM2Q0Y2IwYWY5NTMzNjkzNTU5NjY0M2I1NjllYTdiZjk4NjAxNDY5MDNlNTg0ODBiOTZkYmM1MTJmZDBlYWUxY2NkNGNkYmZkOWQiLCJpYXQiOjE3NDk1MTc4MzcuNzg2MDU0LCJuYmYiOjE3NDk1MTc4MzcuNzg2MDU3LCJleHAiOjE3ODEwNTM4MzcuNzU3MjkzLCJzdWIiOiJkMjVmNTUwNi1jNzNiLTQyOTQtOGQ4Ny0zYzNkZWUyYTU5N2QiLCJzY29wZXMiOltdfQ.Ge3Mqqp-r44aZYeCg3S_NbF4_UKG1xnQjlkco7cOfjPCsxnJTFWrWrvsnCuGtZHHrAkTY3SFjUOIwt_eGeSJ8D9rhS-y8j4XKQVVaEOLta-GCunQwH26Wx3pUJVZ3YMFiq0-ao0QZi9iGopOj5W9OEIzu5w0HRqWJ4C3W0IgClVLax7nYT_3Jx9RG3DjUg57gr9v1iJ1qj6J3sOMR8_TtSr4CZwkIetGzObk6ZELYS1T1_mbiGs74EwqqilmqZk_1_I4vBvdFLjaBT6EYyQ4JmDZ1ljPGTLy7c8AGXBz8Um3lpyHvv4jJw5XO0ziIHYMKb6Z6cVdHUWduPtrxsfWTib-i-jqbF0PQudSz-So4VhwvvJO1DgSkqRSq67eqVqDGcBsxn8SqQgj6Z9aarBEg-9Y2wL8Sn_I2YqSG9IqIcePq_TARSnGiaAvTPF88_FaIHjcbQZegfG3m9Zy1Zu4dBuOvW_MG4TU9kSxLByIGoNrqDylCtybz8O5WhdRd8XdHw2RwpPc_1ZB79yM-FGfo832tgHCrBZzdG2gqSJbnCe4x6aHg81mDUrzEglCBdco8REgRvvBiked6bQTx8NaU6wc38TD5LblZ7feW_V3Kq6sAbSfXW87ZRGpJ-zbCSWq43EheMh8iLTNowO9jO5vqpvyB14xh5-umGm5iQrz674";

		// 🎯 正しいエンドポイント + 商品ID指定
		const baseUrl = "https://api-demo.openlogi.com/api/items";

		// 📦 テストする商品ID（在庫商品から）
		const testProductIds = [
			"1",                    // 商品ID（数値）
			"protein-stick-trio"    // 商品コード
		];

		console.log("Testing OpenLogi items API with product IDs...");
		console.log("Base URL:", baseUrl);
		console.log("API Key length:", API_KEY.length);
		console.log("Test product IDs:", testProductIds);

		const results = [];

		// 🔄 各商品IDでテスト
		for (const productId of testProductIds) {
			try {
				// クエリパラメータ付きURL
				const url = `${baseUrl}?id=${productId}&stock=1`;
				console.log(`Testing: ${url}`);

				const apiResponse = await fetch(url, {
					method: 'GET',
					headers: {
						'Content-Type': 'application/json',
						'X-Api-Version': '1.5',
						'Authorization': `Bearer ${API_KEY}`,
						'User-Agent': 'GCF-OpenLogi-Test/1.0'
					},
					signal: AbortSignal.timeout(15000)
				});

				let responseBody;
				try {
					responseBody = await apiResponse.json();
				} catch (e) {
					responseBody = await apiResponse.text();
				}

				console.log(`${productId} → ${apiResponse.status}`, responseBody);

				results.push({
					productId: productId,
					url: url,
					status: apiResponse.status,
					statusText: apiResponse.statusText,
					success: apiResponse.status === 200,
					body: responseBody,
					headers: {
						'content-type': apiResponse.headers.get('content-type'),
						'x-ratelimit-remaining': apiResponse.headers.get('x-ratelimit-remaining')
					}
				});

				// 200が見つかったら詳細ログ
				if (apiResponse.status === 200) {
					console.log(`✅ SUCCESS with product ID: ${productId}`);
					console.log("Response data:", JSON.stringify(responseBody, null, 2));
				}

			} catch (error: any) {
				console.log(`❌ ERROR with product ID ${productId}: ${error.message}`);
				results.push({
					productId: productId,
					status: 'ERROR',
					error: error.message,
					success: false
				});
			}
		}

		// 📊 結果集計
		const successfulRequests = results.filter(r => r.success);

		// 📝 レスポンス生成
		if (successfulRequests.length > 0) {
			response.status(200).json({
				message: `🎉 OpenLogi API接続成功！ ${successfulRequests.length}個の商品IDで成功`,
				success: true,
				endpoint: baseUrl,
				successfulProductIds: successfulRequests.map(r => r.productId),
				detailResults: successfulRequests,
				apiInfo: {
					authenticated: true,
					correctEndpoint: baseUrl,
					requiredParameter: "商品ID（idパラメータ）が必須"
				},
				timestamp: new Date().toISOString()
			});
		} else {
			response.status(200).json({
				message: "❌ 商品IDでのアクセス失敗 - エンドポイントは正しいが商品IDが不正",
				success: false,
				endpoint: baseUrl,
				testedProductIds: testProductIds,
				allResults: results,
				apiInfo: {
					authenticated: true,
					correctEndpoint: baseUrl,
					issue: "商品IDの形式が不正の可能性"
				},
				timestamp: new Date().toISOString()
			});
		}

	} catch (error: any) {
		console.error("Overall test error:", error);

		response.status(200).json({
			success: false,
			message: "💥 テスト実行失敗",
			error: error.message,
			timestamp: new Date().toISOString()
		});
	}
});