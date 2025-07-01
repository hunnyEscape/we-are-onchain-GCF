import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { defineString } from "firebase-functions/params";
import {
	verifyWebhookPayload,
	saveSecureWebhookLog,
} from "../shared/middleware/security";
import {
	processPaymentSuccess,
	processPaymentExpired,
	updateInvoiceStatus,
} from "../shared/utils/paymentHelpers";

// 環境変数定義
const opennodeApiKey = defineString("OPENNODE_API_KEY", {
	description: "OpenNode API Key for webhook verification",
	default: "",
});

/**
 * セキュリティ検証付きOpenNode Webhook処理関数（自動出荷機能付き）
 * HMAC-SHA256署名検証を実装
 */
export const opennodeWebhookSecureDev = onRequest({
	region: "us-central1",
	memory: "512MiB",  // 出荷処理のため少し増量
	timeoutSeconds: 90, // 出荷処理のため少し延長
	cors: true,
}, async (request, response) => {
	const startTime = Date.now();

	try {
		logger.info("OpenNode Secure Webhook received", {
			method: request.method,
			timestamp: new Date().toISOString(),
			userAgent: request.get("User-Agent"),
			contentType: request.get("Content-Type"),
		});

		// POSTメソッドのみ受け付け
		if (request.method !== "POST") {
			logger.warn("Invalid HTTP method for secure webhook", {
				method: request.method,
				ip: request.ip,
			});

			response.status(405).json({
				error: "Method not allowed",
				message: "Only POST method is allowed",
			});
			return;
		}

		// API Key チェック
		const apiKey = opennodeApiKey.value();
		if (!apiKey) {
			logger.error("OpenNode API key not configured");
			response.status(500).json({
				error: "API key not configured",
			});
			return;
		}

		// Webhook検証
		const verification = verifyWebhookPayload(request.body, apiKey);

		if (!verification.isValid) {
			const statusCode = verification.errorMessage?.includes("Missing required") ? 400 : 401;

			response.status(statusCode).json({
				error: verification.errorMessage,
				message: statusCode === 401 ? "Webhook verification failed - not from OpenNode" : undefined,
				details: statusCode === 400 ? {
					invoiceId: !!verification.invoiceId,
					hashedOrder: !!request.body.hashed_order,
				} : undefined,
			});

			// エラーログ保存
			await saveSecureWebhookLog(
				verification,
				request,
				Date.now() - startTime,
				"verification_failed",
				apiKey
			);
			return;
		}

		// 支払いステータス処理
		let processedAction = "none";
		const { invoiceId, status, webhookData } = verification;

		if (status === "paid") {
			// 支払い完了処理
			await processPaymentSuccess(invoiceId!, webhookData,true);

			// 🚀 自動出荷処理
			//await triggerAutoShipment(invoiceId!);

			processedAction = "payment_completed";

			logger.info("💰 Payment processing completed", {
				invoiceId,
				amount: webhookData.price,
				fee: webhookData.fee,
			});
		} else if (status === "expired") {
			// 期限切れ処理
			await processPaymentExpired(invoiceId!, webhookData);
			processedAction = "payment_expired";

			logger.info("⏰ Payment expired", {
				invoiceId,
			});

		} else {
			// その他のステータス更新
			await updateInvoiceStatus(invoiceId!, status!, webhookData);
			processedAction = `status_updated_${status}`;

			logger.info("📝 Invoice status updated", {
				invoiceId,
				newStatus: status,
			});
		}

		// セキュア処理ログを保存
		const logDocId = await saveSecureWebhookLog(
			verification,
			request,
			Date.now() - startTime,
			processedAction,
			apiKey
		);

		const duration = Date.now() - startTime;

		logger.info("Secure webhook processing completed", {
			documentId: logDocId,
			invoiceId,
			status,
			processedAction,
			duration: `${duration}ms`,
		});

		// OpenNodeに成功レスポンス返却
		response.status(200).json({
			success: true,
			message: "Secure webhook processed successfully",
			data: {
				invoiceId,
				status,
				processedAction,
				verificationPassed: true,
				timestamp: new Date().toISOString(),
				processingTime: `${duration}ms`,
			},
		});

	} catch (error: any) {
		const duration = Date.now() - startTime;

		logger.error("Secure webhook processing failed", {
			error: error.message,
			stack: error.stack,
			duration: `${duration}ms`,
		});

		response.status(500).json({
			error: "Secure webhook processing failed",
			message: error.message,
			timestamp: new Date().toISOString(),
		});
	}
});