import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Firebase Admin初期化
initializeApp();

// Firestore インスタンスをエクスポー
export const db = getFirestore();