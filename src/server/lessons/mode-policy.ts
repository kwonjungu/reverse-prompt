/**
 * 모드 차단 판정 — 화면 토글이 아니라 서버 판정이 근거다.
 *
 * 설계서 §4·수용시험 7 대응.
 *   - 세션 성격은 클라이언트 상태가 아니라 서버가 정한다.
 *   - 허용 여부의 단일 정의는 src/lib/research/session-modes.ts의 isModeAllowed이다.
 *     이 파일은 route·페이지·server action·API가 같은 판정과 같은 문구를 쓰도록 감싸기만 한다.
 *   - 연구 세션에서는 게임·타임어택·감수·임의 이미지 생성을 막는다.
 *
 * 서버 전용 모듈을 import 하지 않는다. middleware(edge)와 클라이언트 가드가 함께 쓴다.
 */

import {
  isModeAllowed,
  isResearchSession,
  MODE_BLOCKED_MESSAGE,
} from '@/lib/research/session-modes';
import type { AppMode, SessionType } from '@/lib/research/types';

export { MODE_BLOCKED_MESSAGE };

export interface ModeDecision {
  allowed: boolean;
  /** 거절할 때 학생 화면에 그대로 보여 줄 문구. 구현 용어를 쓰지 않는다. */
  message: string | null;
}

const APP_MODE_NAMES: AppMode[] = [
  'guide',
  'practice',
  'assessment',
  'game',
  'time-attack',
  'audit',
  'generate',
];

/** 클라이언트가 보낸 mode 문자열을 검증한다. 모르는 이름은 허용하지 않는다. */
export function parseAppMode(value: unknown): AppMode | null {
  return typeof value === 'string' && (APP_MODE_NAMES as string[]).includes(value)
    ? (value as AppMode)
    : null;
}

/** 세션 성격과 모드로 허용 여부를 판정한다. */
export function checkMode(sessionType: SessionType, mode: AppMode): ModeDecision {
  const allowed = isModeAllowed(sessionType, mode);
  return { allowed, message: allowed ? null : MODE_BLOCKED_MESSAGE };
}

/** 비허용 모드 접근을 서버에서 끊을 때 쓰는 오류. */
export class ModeBlockedError extends Error {
  readonly mode: AppMode;
  readonly sessionType: SessionType;
  constructor(sessionType: SessionType, mode: AppMode) {
    super(MODE_BLOCKED_MESSAGE);
    this.name = 'ModeBlockedError';
    this.mode = mode;
    this.sessionType = sessionType;
  }
}

/**
 * server action·API 처리기의 첫 줄에서 부른다.
 * 화면에서 버튼을 숨겼는지와 무관하게 여기서 거절해야 차단이 성립한다.
 */
export function assertModeAllowed(sessionType: SessionType, mode: AppMode): void {
  if (!checkMode(sessionType, mode).allowed) {
    throw new ModeBlockedError(sessionType, mode);
  }
}

/** middleware가 쓰는 경로 → 모드 대응표. 경로를 늘리면 여기에 함께 적는다. */
export const ROUTE_MODES: { prefix: string; mode: AppMode }[] = [
  { prefix: '/game', mode: 'game' },
  { prefix: '/time-attack', mode: 'time-attack' },
  // 감수 화면. /admin 자체는 통합 관리 화면이며 학생 활동이 아니라 관리자 비밀번호로 막는다.
  { prefix: '/admin/audit', mode: 'audit' },
  { prefix: '/api/audit', mode: 'audit' },
  { prefix: '/api/generate', mode: 'generate' },
  // 검사 화면이 부르는 학생용 API. 예전에는 표에 없어 연구 수업(연습) 세션도 route 단계를 지나갔다.
  // 연구자 내려받기(/api/assessment/export)는 학생 활동이 아니므로 넣지 않는다.
  { prefix: '/api/assessment/state', mode: 'assessment' },
  { prefix: '/api/assessment/start', mode: 'assessment' },
  { prefix: '/api/assessment/submit', mode: 'assessment' },
  { prefix: '/api/assessment/failure', mode: 'assessment' },
  { prefix: '/assessment', mode: 'assessment' },
  { prefix: '/practice', mode: 'practice' },
  { prefix: '/guide', mode: 'guide' },
];

/** 경로에 해당하는 모드를 찾는다. 대응이 없으면 null(경로 차단 대상 아님). */
export function modeForPath(pathname: string): AppMode | null {
  const hit = ROUTE_MODES.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`)
  );
  return hit ? hit.mode : null;
}

/* ────────────────────── 연수 체험판(/lecture) ────────────────────── */

/**
 * 연수 체험판 경로. 학생 세션 없이 연수 번호(LECTURE_CODE)로만 들어오는 시연용 경로라
 * 모드 표(ROUTE_MODES)에 넣지 않는다. 넣으면 세션 힌트가 없는 연수 참가자가 모두 막힌다.
 *
 * 대신 **연구 세션 힌트가 있는 요청만** 막는다. 연구 참가 학생이 연수 번호(기본 1111)를
 * 알아도 연구 밖에서 같은 L 그림으로 AI 채점 연습을 받아 처치가 흐려지지 않게 하기 위해서다.
 * 연구 세션에서 열리는 활동은 설명·연습(연구 수업) 또는 검사(연구 검사)뿐이다.
 *
 * 한계: edge와 연수 server action은 힌트 쿠키만 읽는다(연수 경로는 Firestore를 열지 않는다).
 * 힌트를 지우면 지나갈 수 있으므로 연수가 끝나면 LECTURE_CODE를 바꾸거나 비워 두는 것이 실제 방어다.
 */
export const LECTURE_PATH_PREFIX = '/lecture';

export function isLecturePath(pathname: string): boolean {
  return pathname === LECTURE_PATH_PREFIX || pathname.startsWith(`${LECTURE_PATH_PREFIX}/`);
}

/** 세션 힌트의 성격으로 연수 체험판을 막을지 정한다. 힌트가 없으면(연수 참가자) 막지 않는다. */
export function isLectureBlockedFor(sessionType: SessionType | null | undefined): boolean {
  return !!sessionType && isResearchSession(sessionType);
}
