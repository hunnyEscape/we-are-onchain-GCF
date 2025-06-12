// src/testing/debugShipment.ts
// デバッグ用出荷処理Cloud Function

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { Request, Response } from "express";
import { processInvoiceShipmentInternal } from "../shared/utils/internalShipmentProcessor";

interface DebugRequest {
  invoiceId?: string;
  invoice?: any; // Invoice オブジェクト直接指定
  apiKey?: string;
}

interface DebugResponse {
  success: boolean;
  invoiceId: string;
  result?: any;
  error?: string;
  executionTime: number;
  timestamp: string;
  debugInfo: {
    invoiceExists: boolean;
    invoiceData?: any;
    processSteps: string[];
    warnings: string[];
  };
}

/**
 * デバッグ用出荷処理HTTP Function
 * 開発/テスト環境でのみ使用
 */
export const debugShipmentProcess = functions
  .https.onRequest(async (req: Request, res: Response) => {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    
    // CORS設定
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      res.status(200).send();
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      // 環境チェック（DISABLE_DEBUG_FUNCTION=true の場合のみ無効化）
      const isDisabled = process.env.DISABLE_DEBUG_FUNCTION === 'true';
      if (isDisabled) {
        res.status(403).json({ 
          error: 'Debug function is disabled' 
        });
        return;
      }

      // 簡単な認証（環境変数が設定されている場合のみ）
      const expectedApiKey = process.env.DEBUG_API_KEY;
      if (expectedApiKey && req.body.apiKey !== expectedApiKey) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { invoiceId, invoice }: DebugRequest = req.body;
      
      if (!invoiceId && !invoice) {
        res.status(400).json({ 
          error: 'invoiceId or invoice object is required' 
        });
        return;
      }

      const debugInfo = {
        invoiceExists: false,
        invoiceData: undefined,
        processSteps: [] as string[],
        warnings: [] as string[]
      };

      let targetInvoiceId: string;
      let invoiceData = invoice;

      // Invoice IDが指定された場合はFirestoreから取得
      if (invoiceId) {
        targetInvoiceId = invoiceId;
        debugInfo.processSteps.push(`Fetching invoice: ${invoiceId}`);
        
        const invoiceDoc = await admin.firestore()
          .collection('invoices')
          .doc(invoiceId)
          .get();

        if (!invoiceDoc.exists) {
          res.status(404).json({
            success: false,
            invoiceId,
            error: 'Invoice not found',
            executionTime: Date.now() - startTime,
            timestamp,
            debugInfo
          });
          return;
        }

        debugInfo.invoiceExists = true;
        invoiceData = invoiceDoc.data();
        debugInfo.invoiceData = invoiceData;
        debugInfo.processSteps.push('Invoice found in Firestore');

        // 既に出荷済みかチェック
        if (invoiceData?.shipmentId) {
          debugInfo.warnings.push(`Invoice already has shipmentId: ${invoiceData.shipmentId}`);
        }

        // Invoice の状態をチェック
        if (invoiceData.status !== 'paid') {
          debugInfo.warnings.push(`Invoice status is '${invoiceData.status}', not 'paid'`);
        }
        if (!invoiceData.paidAt) {
          debugInfo.warnings.push('Invoice paidAt is null - payment not completed');
        }

        // 配送情報の確認
        if (!invoiceData.shippingSnapshot) {
          debugInfo.warnings.push('Missing shippingSnapshot');
        } else {
          debugInfo.processSteps.push('Shipping information found');
        }

        // カート情報の確認
        if (!invoiceData.cartSnapshot) {
          debugInfo.warnings.push('Missing cartSnapshot');
        } else {
          debugInfo.processSteps.push(`Cart has ${invoiceData.cartSnapshot.itemCount} items`);
        }
      } else if (invoice) {
        // Invoice オブジェクトが直接指定された場合
        debugInfo.processSteps.push('Using provided invoice object');
        targetInvoiceId = invoice.id || 'direct-invoice';
        debugInfo.invoiceData = invoice;
      } else {
        // どちらも指定されていない場合（上のvalidationでキャッチされるはずだが念のため）
        res.status(400).json({ 
          error: 'invoiceId or invoice object is required' 
        });
        return;
      }

      debugInfo.processSteps.push('Calling processInvoiceShipmentInternal');

      // メイン処理実行（詳細情報付き）
      const result = await processInvoiceShipmentInternal(targetInvoiceId, {
        includeDebugInfo: true
      });
      
      debugInfo.processSteps.push('processInvoiceShipmentInternal completed');

      // 実行時間計算
      const executionTime = Date.now() - startTime;

      // 成功レスポンス
      const response: DebugResponse = {
        success: true,
        invoiceId: targetInvoiceId,
        result,
        executionTime,
        timestamp,
        debugInfo
      };

      // 結果に応じて追加情報
      if (result.success && result.shipmentId) {
        debugInfo.processSteps.push(`Shipment created: ${result.shipmentId}`);
      } else if (!result.success) {
        debugInfo.warnings.push('Shipment process failed');
        
        // API エラーの詳細があれば追加
        if (result.details) {
          debugInfo.warnings.push(`API Error Details: ${JSON.stringify(result.details)}`);
        }
        if (result.apiResponse) {
          debugInfo.processSteps.push(`API Response Status: ${result.apiResponse.status}`);
        }
      }


      console.log('Debug shipment process completed:', {
        invoiceId: targetInvoiceId,
        success: result.success,
        executionTime
      });

      res.status(200).json(response);

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      console.error('Debug shipment process error:', error);

      const errorResponse: DebugResponse = {
        success: false,
        invoiceId: req.body.invoiceId || 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime,
        timestamp,
        debugInfo: {
          invoiceExists: false,
          processSteps: ['Error occurred during execution'],
          warnings: [error instanceof Error ? error.stack || '' : '']
        }
      };

      res.status(500).json(errorResponse);
    }
  });