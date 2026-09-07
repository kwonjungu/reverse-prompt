import 'server-only';

/**
 * Firebase Admin SDK 초기화의 단일 지점.
 *
 * Admin SDK는 Firestore 보안 규칙을 우회한다. 그러므로 이 모듈을 쓰는 쪽은
 * 반드시 @/server/auth의 requireClassAccess를 먼저 통과해야 한다.
 *
 * 자격증명(FIREBASE_SERVICE_ACCOUNT_JSON)이 없으면 AuthError('not_configured')로
 * 실패한다. 인증 없이 통과시키는 우회로를 두지 않는다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §6
 */

import { cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth as getAdminAuthSdk, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { FIREBASE_ADMIN_CREDENTIAL } from '@/server/config';
import { AuthError } from '@/server/auth/contract';

const APP_NAME = 'reverse-prompt-admin';

let cached: App | null = null;

/** 서버 자격증명이 설정되어 있는가. 화면에 '미설정'을 그대로 노출하기 위한 판정. */
export function isAdminConfigured(): boolean {
  return FIREBASE_ADMIN_CREDENTIAL.length > 0;
}

function parseCredential(): { projectId: string; clientEmail: string; privateKey: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(FIREBASE_ADMIN_CREDENTIAL);
  } catch {
    // 값 자체를 오류 메시지에 담지 않는다(비밀키 유출 방지).
    throw new AuthError('서버 자격증명 형식이 올바르지 않습니다.', 'not_configured');
  }
  const obj = raw as Record<string, unknown>;
  const projectId = typeof obj.project_id === 'string' ? obj.project_id : '';
  const clientEmail = typeof obj.client_email === 'string' ? obj.client_email : '';
  const privateKey = typeof obj.private_key === 'string' ? obj.private_key : '';
  if (!projectId || !clientEmail || !privateKey) {
    throw new AuthError('서버 자격증명에 필수 항목이 없습니다.', 'not_configured');
  }
  return { projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') };
}

export function getAdminApp(): App {
  if (cached) return cached;
  if (!isAdminConfigured()) {
    throw new AuthError('서버 인증 자격증명이 설정되지 않았습니다.', 'not_configured');
  }
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) {
    cached = getApp(APP_NAME);
    return cached;
  }
  const credential = parseCredential();
  cached = initializeApp(
    { credential: cert(credential), projectId: credential.projectId },
    APP_NAME
  );
  return cached;
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminAuth(): Auth {
  return getAdminAuthSdk(getAdminApp());
}

/** 컬렉션 이름의 단일 지점. 연구 저장소와 수업 기록을 분리해 둔다. */
export const COLLECTIONS = {
  /** 계정과 역할. 클라이언트가 쓰지 못한다. */
  users: 'users',
  /** 무작위 수업ID. 실명 대응표는 학교 담당자가 저장소 밖에서 관리한다. */
  researchClasses: 'researchClasses',
  /** 보호자 동의·학생 승낙 */
  consents: 'consents',
  /** 동의 상태 변경 이력(철회 포함). 자료 파기는 여기 기록만 남기고 자동 삭제하지 않는다. */
  consentEvents: 'consentEvents',
  /** 학생 세션 토큰의 폐기 목록 */
  studentSessions: 'studentSessions',
  /** 연구 저장소 */
  researchSubmissions: 'researchSubmissions',
  scoringRuns: 'scoringRuns',
  teacherBlindScores: 'teacherBlindScores',
  /** 감수 AI에 실데이터를 보내려면 필요한 명시적 승인 기록 */
  auditApprovals: 'auditApprovals',
  /** 비연구 수업 기록(기존 구조 유지) */
  classes: 'classes',
} as const;
