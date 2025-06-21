// src/shared/utils/openlogiErrorUtils.ts
// OpenLogiエラーメッセージの簡潔化

/**
 * OpenLogiの詳細エラーを簡潔なメッセージに変換
 */
export function simplifyOpenLogiError(apiResult: any): string {
  try {
    // details.errors から具体的なエラーを抽出
    if (apiResult?.details?.errors) {
      const errors = apiResult.details.errors;
      
      // 住所関連エラー
      if (errors["recipient.postcode"]) {
        return "Address and postcode mismatch";
      }
      if (errors["recipient.address1"] || errors["recipient.address2"]) {
        return "Invalid address format";
      }
      if (errors["recipient.name"]) {
        return "Invalid recipient name";
      }
      if (errors["recipient.phone"]) {
        return "Invalid phone number format";
      }
      
      // 商品関連エラー
      if (errors["items"] || errors["items.0.product_id"]) {
        return "Invalid product information";
      }
      
      // その他のバリデーションエラー
      const firstErrorField = Object.keys(errors)[0];
      if (firstErrorField) {
        return `Invalid ${firstErrorField}`;
      }
    }
    
    // HTTPステータスベースの分類
    if (apiResult?.error?.statusCode) {
      const status = apiResult.error.statusCode;
      
      if (status === 401 || status === 403) {
        return "Authentication error";
      }
      if (status === 422) {
        return "Data validation error";
      }
      if (status === 500) {
        return "OpenLogi server error";
      }
      if (status >= 400 && status < 500) {
        return "Request error";
      }
      if (status >= 500) {
        return "Server error";
      }
    }
    
    // フォールバック
    if (apiResult?.error?.message) {
      // 長いメッセージを短縮
      const message = apiResult.error.message;
      if (message.length > 50) {
        return message.substring(0, 47) + "...";
      }
      return message;
    }
    
    return "Unknown error";
    
  } catch (error) {
    return "Error analysis failed";
  }
}