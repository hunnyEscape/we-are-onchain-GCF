// Firebase Admin初期化（最初に実行される）
import "./shared/config/firebase";
export { opennodeWebhookSecureDev } from "./webhook/opennodeDev";
export { opennodeWebhookSecure } from "./webhook/opennode";
//npx firebase deploy --only functions:opennodeWebhookSecure
export { updateCryptoPrices } from "./crypto/priceUpdater";
