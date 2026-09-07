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

import { isModeAllowed, MODE_BLOCKED_MESSAGE } from '@/lib/research/session-modes';
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
  { prefix: '/admin', mode: 'audit' },
  { prefix: '/api/audit', mode: 'audit' },
  { prefix: '/api/generate', mode: 'generate' },
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
