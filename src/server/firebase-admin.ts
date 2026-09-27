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

/**
 * 컬렉션 경로의 단일 지점.
 *
 * 연구 자료는 모두 research/{schemaVersion} 아래에 둔다. 기존 classes/ 트리(비연구
 * 수업 기록)는 손대지 않는다. 쓰기와 읽기가 다른 경로를 쓰는 일이 없도록 어떤 모듈도
 * 컬렉션 이름을 직접 적지 않고 여기의 값을 쓴다.
 */

import { RESEARCH_STORE_VERSION } from '@/lib/research/types';

/** 계정·동의처럼 스키마 버전과 무관한 최상위 컬렉션 */
export const COLLECTIONS = {
  /** 계정과 역할. 클라이언트가 쓰지 못한다. */
  users: 'users',
  /** 무작위 수업ID. 실명 대응표는 학교 담당자가 저장소 밖에서 관리한다. */
  researchClasses: 'research_classes',
  /** 보호자 동의·학생 승낙 */
  consents: 'consents',
  /** 동의 상태 변경 이력(철회 포함). 자료 파기는 여기 기록만 남기고 자동 삭제하지 않는다. */
  consentEvents: 'consent_events',
  /** 학생 세션 토큰의 폐기 목록 */
  studentSessions: 'student_sessions',
  /** 감수 AI에 실데이터를 보내려면 필요한 명시적 승인 기록 */
  auditApprovals: 'audit_approvals',
  /** 비연구 수업 기록(기존 구조 유지) */
  classes: 'classes',
  /** 통합 관리 화면 설정. 관리자 비밀번호는 scrypt 해시로만 둔다. */
  adminConfig: 'admin_config',
  /** 통합 관리 화면의 조작 기록(반 개설·차시·교사 계정). 비밀번호 원문은 남기지 않는다. */
  adminEvents: 'admin_events',
} as const;

/** research/{schemaVersion} 아래의 연구 자료 컬렉션 이름 */
export const RESEARCH_COLLECTIONS = {
  assessmentSessions: 'assessment_sessions',
  assessmentWindows: 'assessment_windows',
  assessmentSubmissions: 'assessment_submissions',
  assessmentRejections: 'assessment_rejections',
  practiceSubmissions: 'practice_submissions',
  lessonSessions: 'lesson_sessions',
  scoringRuns: 'scoring_runs',
  scoringBatches: 'scoring_batches',
  teacherBlindScores: 'teacher_blind_scores',
  /** 연구용 추출에서 뺀 학생 × 문항 행과 그 사유(논문 v12). 지우지 않고 해제 기록을 남긴다. */
  extractionExclusions: 'extraction_exclusions',
  /** 층화 무작위 추출 결과. 시드·후보·제외 목록을 함께 남겨 다시 만들 수 있게 한다. */
  extractionSamples: 'extraction_samples',
  /** 추출 사례의 반복 채점(2·3회차). 주 자료(제출 문서의 1회차)는 건드리지 않는다. */
  sampleRepeatScores: 'sample_repeat_scores',
  /** 전송 전 개인정보 점검으로 멈춘 제출(유형·시각만). 원문은 남기지 않는다. */
  privacyHolds: 'privacy_holds',
} as const;

export type ResearchCollection =
  (typeof RESEARCH_COLLECTIONS)[keyof typeof RESEARCH_COLLECTIONS];

/**
 * 연구 자료 컬렉션의 전체 경로.
 * 경로의 버전 조각은 문서 스키마 버전(SCHEMA_VERSION)과 분리해 고정한다(RESEARCH_STORE_VERSION).
 * 스키마를 올려도 이미 열린 차시·검사 자료가 새 경로로 갈라지지 않는다. 문서마다 schemaVersion이 따로 남는다.
 */
export function researchPath(name: ResearchCollection): string {
  return `research/${RESEARCH_STORE_VERSION}/${name}`;
}

/**
 * 문서 ID로 쓸 수 있는 값인지 확인한다.
 * 클라이언트가 보낸 문자열이 경로 구분자를 품고 들어와 다른 문서를 덮어쓰는 일을 막는다.
 */
export function assertSafeDocId(value: string, label: string): string {
  const ok =
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    !value.includes('/') &&
    value !== '.' &&
    value !== '..' &&
    !/[\x00-\x1f\x7f]/.test(value);
  if (!ok) {
    throw new AuthError(`${label} 값이 올바르지 않습니다.`, 'forbidden');
  }
  return value;
}
