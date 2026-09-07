/**
 * Firebase 클라이언트 SDK 초기화.
 *
 * 클라이언트는 이제 학급 자료를 직접 조회·삭제하지 않는다. 교사·연구자 화면의
 * 조회와 삭제는 서버 액션(@/server/auth/class-data-actions)을 거치고, 학생 제출도
 * 서버 경로를 쓴다. 클라이언트 SDK는 로그인(ID 토큰 발급)과 제한된 읽기에만 쓴다.
 *
 * 익명 로그인은 쓰지 않는다. firestore.rules가 익명 사용자를 거부한다.
 * 다만 저장소의 규칙 파일과 실제 콘솔 규칙이 같은지는 별도 확인이 필요하다.
 */

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';
import { firebaseConfig, isFirebaseConfigValid } from './config';

export function initializeFirebase(): {
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
} {
  if (!isFirebaseConfigValid) {
    console.warn('Firebase configuration is incomplete. Authentication and Firestore will likely fail. Please check your .env file.');
  }

  const firebaseApp =
    getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  const firestore = getFirestore(firebaseApp);
  const auth = getAuth(firebaseApp);

  return { firebaseApp, firestore, auth };
}

export * from './provider';
export * from './client-provider';
export * from './auth/use-user';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './auth/staff-session';
