import 'server-only';

/**
 * 인증 계약(@/server/auth)과 차시 모듈 사이의 유일한 접점.
 *
 * 설계서 §6 대응. 교사 권한·소속 학급·세션 성격·동의 상태는 클라이언트 입력이 아니라
 * 서버에서 조회한다. 호출을 한곳에 모아 두어 인증 구현이 바뀌어도 여기만 고치면 되게 한다.
 *
 * 여기서 지키는 것(감사 A-3)
 *   - 설정 오류(not_configured)는 삼키지 않고 그대로 올린다. '우회 없이 실패'한다.
 *   - 세션이 없거나 검증에 실패하면 일반 체험으로 강등하지 않는다. 거부한다.
 *   - 일반 체험은 서버가 발급한 세션이 experience일 때에만 성립한다.
 */

import { auth } from '@/server/auth';
import { AuthError } from '@/server/auth/contract';
import type { Principal } from '@/server/auth/contract';
import type { SessionType } from '@/lib/research/types';

/** 학생 요청 한 건의 서버 확정 맥락. 클라이언트가 보낸 값을 그대로 쓰지 않는다. */
export interface StudentSessionContext {
  sessionType: SessionType;
  classResearchId: string | null;
  /** 비연구 수업 기록에 쓰는 학급 코드. 서버 세션 토큰의 값만 쓴다. */
  classCode: string | null;
  /** 연구 자료에 쓰는 비식별 학생 식별자. 출석번호·학교명을 쓰지 않는다. */
  researchId: string | null;
  /**
   * 이 요청의 소유 키. 연구 세션은 researchId, 일반 체험은 서버 세션 소유자다.
   * 제출·피드백 검토의 소유자 검사가 이 값을 쓴다(감사 A-6·A-11).
   */
  ownerKey: string;
  /** 보호자 동의와 학생 승낙이 모두 유효한가. */
  consentActive: boolean;
  consentVersion: string | null;
  /** 서버가 세션을 확정했다. 이 형에서는 항상 true다. */
  verified: true;
}

export type StudentSessionResolution =
  | { status: 'ok'; ctx: StudentSessionContext }
  | { status: 'no_session'; message: string };

export const NO_SESSION_MESSAGE = '먼저 선생님이 알려 준 수업 번호로 들어와 주세요.';

/**
 * 지금 요청의 세션 맥락을 서버에서 확정한다.
 *
 * 확정하지 못하면 no_session을 돌려준다. 예전처럼 '일반 체험'으로 채워 돌려주지
 * 않는다. 설정 오류는 AuthError로 그대로 올라간다.
 */
export async function resolveStudentSession(): Promise<StudentSessionResolution> {
  const session = await auth.resolveSessionContext();
  if (!session) return { status: 'no_session', message: NO_SESSION_MESSAGE };

  const ownerKey = session.researchId ?? session.sessionOwner;
  if (!ownerKey) return { status: 'no_session', message: NO_SESSION_MESSAGE };

  return {
    status: 'ok',
    ctx: {
      sessionType: session.sessionType,
      classResearchId: session.classResearchId,
      classCode: session.classCode,
      researchId: session.researchId,
      ownerKey,
      consentActive: session.consentActive,
      consentVersion: session.consentVersion,
      verified: true,
    },
  };
}

/** 세션이 없으면 AuthError로 끊는다. 쓰기·채점 경로는 반드시 이것을 쓴다(감사 A-1). */
export async function requireStudentSession(): Promise<StudentSessionContext> {
  const resolved = await resolveStudentSession();
  if (resolved.status !== 'ok') {
    throw new AuthError(resolved.message, 'unauthenticated');
  }
  return resolved.ctx;
}

/**
 * 교사 권한과 소속 학급을 확인한다. 확인되지 않으면 AuthError가 그대로 올라간다.
 * 학급 소속을 클라이언트가 보낸 값으로 판단하지 않는다.
 * 차시 개방은 쓰기 작업이므로 write로 판정한다(감사 A-4).
 */
export async function requireTeacher(classResearchId: string): Promise<Principal> {
  return auth.requireClassAccess(classResearchId, { action: 'write' }, 'teacher', 'admin');
}

/**
 * 학급의 세션 성격을 서버 기록에서 읽는다.
 * 교사가 보낸 sessionType으로 연구 학급을 체험으로 여는 길을 막는다(감사 A-5).
 */
export async function resolveClassSessionType(classResearchId: string): Promise<SessionType> {
  return auth.getClassSessionType(classResearchId);
}
