import 'server-only';

/**
 * 서버 인증·권한 계약. 구현은 src/server/auth/index.ts에 둔다.
 * 이 파일의 시그니처는 다른 모듈이 함께 참조하므로 임의로 바꾸지 않는다.
 *
 * 원칙(설계서 §6)
 *  - 클라이언트가 보낸 역할·학급·동의·시점을 신뢰하지 않는다.
 *  - Admin SDK가 보안 규칙을 우회하므로 서버에서도 역할과 대상 범위를 검증한다.
 *  - 익명 사용자와 다른 학급의 조회·쓰기·삭제를 거부한다.
 */

import type { ConsentRecord, SessionType } from '@/lib/research/types';
import type { ClassAccessOptions } from './access';

export type { ClassAccessOptions } from './access';

export type Role = 'student' | 'teacher' | 'researcher' | 'admin';

/** 서버가 검증한 신원. 학생은 실명·출석번호를 여기에 담지 않는다. */
export interface Principal {
  uid: string;
  role: Role;
  /** 교사·연구자가 접근 가능한 학급의 연구ID 목록 */
  classResearchIds: string[];
  /** 학생일 때 본인의 연구ID */
  researchId: string | null;
  /** 학생이 속한 학급의 연구ID */
  classResearchId: string | null;
  sessionType: SessionType;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: 'unauthenticated' | 'forbidden' | 'not_configured',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthApi {
  /** 요청의 세션 토큰을 검증한다. 실패하면 null. */
  getPrincipal(): Promise<Principal | null>;
  /** 인증을 요구한다. 실패하면 AuthError를 던진다. */
  requirePrincipal(): Promise<Principal>;
  /** 역할을 요구한다. */
  requireRole(...roles: Role[]): Promise<Principal>;
  /**
   * 해당 학급에 대한 접근 권한을 요구한다.
   *
   * 행위(read/write/delete)를 함께 넘긴다. 넘기지 않으면 'write'로 판정한다.
   * 무엇을 할지 밝히지 않은 호출을 읽기로 취급하면 연구자의 쓰기·삭제 금지 분기가
   * 아무도 타지 않기 때문이다(감사 A-4). 읽기 전용 화면은 { action: 'read' }를
   * 명시한다. 기존 호출 방식(역할만 나열)은 그대로 둔다.
   */
  requireClassAccess(
    classResearchId: string,
    ...rolesOrOptions: (Role | ClassAccessOptions)[]
  ): Promise<Principal>;
  /** 서버에서 조회한 동의 상태. 클라이언트 입력을 신뢰하지 않는다. */
  getConsent(researchId: string): Promise<ConsentRecord | null>;
  /** 연구 수집이 가능한 참가자인지 서버에서 확인한다. */
  requireActiveResearchConsent(researchId: string): Promise<ConsentRecord>;
}
