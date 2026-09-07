/**
 * 인증 계약(@/server/auth)과 차시 모듈 사이의 유일한 접점.
 *
 * 설계서 §6 대응. 교사 권한·소속 학급·세션 성격·동의 상태는 클라이언트 입력이 아니라
 * 서버에서 조회한다. 호출을 한곳에 모아 두어 인증 구현이 바뀌어도 여기만 고치면 되게 한다.
 *
 * 쓰는 계약(src/server/auth/contract.ts의 AuthApi)
 *   auth.getPrincipal()                                   — 세션 확인
 *   auth.requireClassAccess(classResearchId, 'teacher')   — 교사 권한·소속 학급 확인
 *   auth.getConsent(researchId)                           — 동의 상태 조회
 */

import 'server-only';
import { auth } from '@/server/auth';
import { isResearchConsentActive } from '@/lib/research/types';
import type { Principal } from '@/server/auth/contract';
import { DEFAULT_SESSION_TYPE } from './session-cookie';
import type { SessionType } from '@/lib/research/types';

/** 학생 요청 한 건의 서버 확정 맥락. 클라이언트가 보낸 값을 그대로 쓰지 않는다. */
export interface StudentSessionContext {
  sessionType: SessionType;
  classResearchId: string | null;
  /** 연구 자료에 쓰는 비식별 학생 식별자. 출석번호·학교명을 쓰지 않는다. */
  researchId: string | null;
  /** 보호자 동의와 학생 승낙이 모두 유효한가. */
  consentActive: boolean;
  consentVersion: string | null;
  /** 서버가 세션을 확정했는가. false면 연구 저장·전송을 하지 않는다. */
  verified: boolean;
}

/** 서버가 확정하지 못했을 때의 값. 연구 통제를 받지 않는 일반 체험으로 본다. */
const UNVERIFIED: StudentSessionContext = {
  sessionType: DEFAULT_SESSION_TYPE,
  classResearchId: null,
  researchId: null,
  consentActive: false,
  consentVersion: null,
  verified: false,
};

/**
 * 지금 요청의 세션 맥락을 서버에서 확정한다.
 * 인증이 아직 붙지 않았거나 세션이 없으면 미확정 상태를 그대로 돌려준다.
 * 미확정이면 연구 저장·전송은 막히고, 일반 체험 경로만 남는다.
 */
export async function resolveStudentSession(): Promise<StudentSessionContext> {
  let principal: Principal | null = null;
  try {
    principal = await auth.getPrincipal();
  } catch {
    return UNVERIFIED;
  }
  if (!principal) return UNVERIFIED;

  let consentActive = false;
  let consentVersion: string | null = null;
  if (principal.researchId && principal.sessionType !== 'experience') {
    try {
      const consent = await auth.getConsent(principal.researchId);
      consentActive = isResearchConsentActive(consent);
      consentVersion = consent?.consentVersion ?? null;
    } catch {
      consentActive = false;
    }
  }

  return {
    sessionType: principal.sessionType,
    classResearchId: principal.classResearchId,
    researchId: principal.researchId,
    consentActive,
    consentVersion,
    verified: true,
  };
}

/**
 * 교사 권한과 소속 학급을 확인한다. 확인되지 않으면 AuthError가 그대로 올라간다.
 * 학급 소속을 클라이언트가 보낸 값으로 판단하지 않는다.
 */
export async function requireTeacher(classResearchId: string): Promise<Principal> {
  return auth.requireClassAccess(classResearchId, 'teacher', 'admin');
}
