// Firebase Admin初期化（最初に実行される）
import "./shared/config/firebase";

// 各機能モジュールからエクスポート
export { opennodeWebhookSecure } from "./webhook/opennode";
//npx firebase deploy --only functions:opennodeWebhookSecure

export { updateCryptoPrices } from "./crypto/priceUpdater";

export { processInvoiceShipment } from "./openlogi/shipmentSubmitter";
//npx firebase deploy --only functions:processInvoiceShipment
/*
curl -X POST \
  https://processinvoiceshipment-spcu6fqyiq-an.a.run.app \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceId": "4a7e720c-a820-4442-9dd9-7ac634478225"
  }'
*/

// 🆕 OpenLogi テスト関数エクスポート
export { testOpenLogiDataConversion } from "./testing/dataConverter";
/*

curl -X POST \
  https://testopenlogidataconversion-spcu6fqyiq-an.a.run.app \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceId": "365130d0-9cd2-4a51-9a8e-68eae4151b4f"
  }'

*/

// 🆕 Phase2: OpenLogi API統合テスト関数エクスポート
export { testOpenLogiAPIIntegration, testOpenLogiConnection } from "./testing/apiIntegration";
/*
curl -X POST https://testopenlogiconnection-spcu6fqyiq-an.a.run.app

curl -X POST \
  https://testopenlogiapiintegration-spcu6fqyiq-an.a.run.app \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceId": "365130d0-9cd2-4a51-9a8e-68eae4151b4f",
    "dryRun": false,
    "includeDebugInfo": true
  }'

curl -X GET \
  https://api-demo.openlogi.com/api/items \
  -H "Content-Type: application/json" \
  -H "X-Api-Version: 1.5" \
  -H "Authorization: eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiMGE1OTRkM2Q0Y2IwYWY5NTMzNjkzNTU5NjY0M2I1NjllYTdiZjk4NjAxNDY5MDNlNTg0ODBiOTZkYmM1MTJmZDBlYWUxY2NkNGNkYmZkOWQiLCJpYXQiOjE3NDk1MTc4MzcuNzg2MDU0LCJuYmYiOjE3NDk1MTc4MzcuNzg2MDU3LCJleHAiOjE3ODEwNTM4MzcuNzU3MjkzLCJzdWIiOiJkMjVmNTUwNi1jNzNiLTQyOTQtOGQ4Ny0zYzNkZWUyYTU5N2QiLCJzY29wZXMiOltdfQ.Ge3Mqqp-r44aZYeCg3S_NbF4_UKG1xnQjlkco7cOfjPCsxnJTFWrWrvsnCuGtZHHrAkTY3SFjUOIwt_eGeSJ8D9rhS-y8j4XKQVVaEOLta-GCunQwH26Wx3pUJVZ3YMFiq0-ao0QZi9iGopOj5W9OEIzu5w0HRqWJ4C3W0IgClVLax7nYT_3Jx9RG3DjUg57gr9v1iJ1qj6J3sOMR8_TtSr4CZwkIetGzObk6ZELYS1T1_mbiGs74EwqqilmqZk_1_I4vBvdFLjaBT6EYyQ4JmDZ1ljPGTLy7c8AGXBz8Um3lpyHvv4jJw5XO0ziIHYMKb6Z6cVdHUWduPtrxsfWTib-i-jqbF0PQudSz-So4VhwvvJO1DgSkqRSq67eqVqDGcBsxn8SqQgj6Z9aarBEg-9Y2wL8Sn_I2YqSG9IqIcePq_TARSnGiaAvTPF88_FaIHjcbQZegfG3m9Zy1Zu4dBuOvW_MG4TU9kSxLByIGoNrqDylCtybz8O5WhdRd8XdHw2RwpPc_1ZB79yM-FGfo832tgHCrBZzdG2gqSJbnCe4x6aHg81mDUrzEglCBdco8REgRvvBiked6bQTx8NaU6wc38TD5LblZ7feW_V3Kq6sAbSfXW87ZRGpJ-zbCSWq43EheMh8iLTNowO9jO5vqpvyB14xh5-umGm5iQrz674" \
  -v

*/

export {simpleOpenLogiTest} from './testing/simpleConnectionTest';
//npx firebase deploy --only functions:simpleOpenLogiTest
//curl -X POST https://simpleopenlogitest-spcu6fqyiq-an.a.run.app

export {testOpenLogiShipment} from './testing/openLogiShipmentTest';
//npx firebase deploy --only functions:testOpenLogiShipment
//curl -X POST https://testopenlogishipment-spcu6fqyiq-an.a.run.app