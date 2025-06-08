import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Firebase Admin初期化
initializeApp();

// Firestore インスタンスをエクスポート
export const db = getFirestore();