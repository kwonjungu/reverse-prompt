/**
 * 세션 성격을 route 단계에서 빠르게 읽기 위한 쿠키.
 *
 * 이 쿠키는 **권위 있는 신원이 아니다**. 서버가 세션을 만들 때 함께 심어 두는 힌트일 뿐이고,
 * 실제 판정은 매 요청마다 @/server/auth가 서버 기록으로 다시 한다(auth-bridge.ts).
 * middleware는 edge에서 돌아 서버 조회를 할 수 없으므로 이 힌트로 1차 차단만 한다.
 * 힌트를 지우거나 고쳐도 페이지·server action·API의 서버 판정은 그대로 남는다.
 *
 * node 전용 모듈을 import 하지 않는다. middleware가 그대로 불러 쓴다.
 */

import type { SessionType } from '@/lib/research/types';

/** 서버가 세션 토큰과 함께 심는 힌트 쿠키. */
export const SESSION_HINT_COOKIE = 'rp_session_hint';

/** 서버가 발급·검증하는 세션 토큰 쿠키. 발급은 @/server/auth(에이전트5) 담당. */
export const SESSION_TOKEN_COOKIE = 'rp_session';

export interface SessionHint {
  sessionType: SessionType;
  classResearchId: string | null;
}

/** 세션 성격을 알 수 없을 때의 기본값. 자율 진행인 일반 체험으로 본다. */
export const DEFAULT_SESSION_TYPE: SessionType = 'experience';

const SESSION_TYPES: SessionType[] = ['experience', 'research_practice', 'research_assessment'];

export function parseSessionType(value: unknown): SessionType | null {
  return typeof value === 'string' && (SESSION_TYPES as string[]).includes(value)
    ? (value as SessionType)
    : null;
}

export function serializeSessionHint(hint: SessionHint): string {
  return encodeURIComponent(
    JSON.stringify({ t: hint.sessionType, c: hint.classResearchId ?? null })
  );
}

export function parseSessionHint(value: string | undefined | null): SessionHint | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(decodeURIComponent(value)) as { t?: unknown; c?: unknown };
    const sessionType = parseSessionType(raw.t);
    if (!sessionType) return null;
    return {
      sessionType,
      classResearchId: typeof raw.c === 'string' ? raw.c : null,
    };
  } catch {
    return null;
  }
}
