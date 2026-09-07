/**
 * 역할·대상 범위 판정의 순수 로직.
 *
 * 서버 Admin SDK는 Firestore 보안 규칙을 우회한다. 따라서 규칙과 별개로
 * 서버에서도 역할과 대상 범위를 검증해야 한다. 이 파일은 그 판정을 부수효과 없이
 * 담아 두어 테스트에서 그대로 확인할 수 있게 한다.
 *
 * 이 파일은 'server-only'를 import 하지 않는다. 순수 판정 함수만 두므로
 * 자격증명·비밀키를 다루지 않으며 테스트 실행기에서 바로 불러 쓴다.
 */

// ── 역할 ────────────────────────────────────────────────────
// 교사·연구자·개발자 계정을 분리한다. 개발자에게 모든 운영 자료의
// 포괄 접근권한을 기본으로 주지 않는다.
export const ROLES = ['student', 'teacher', 'researcher', 'developer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** 자료 구역. 연구 저장소와 비연구 수업 기록은 접근자·보존기간이 분리된다. */
export type DataScope = 'lesson' | 'research';

export type AccessAction =
  | 'read'              // 비식별 읽기
  | 'read_identifiable' // 출석번호·학교명 등 식별 정보를 포함한 읽기
  | 'write'
  | 'delete'
  | 'export'
  | 'manage_users';

export type ServerPrincipal = {
  uid: string;
  role: Role;
  disabled?: boolean;
  /** 교사가 소속된 수업 학급 코드 목록. 서버(users 문서)에서만 채운다. */
  classCodes?: string[];
  /** 배정된 무작위 수업ID 목록. 학교 담당자가 발급하고 서버가 보관한다. */
  classResearchIds?: string[];
  /**
   * 명시적으로 승인된 예외 범위. 기본은 빈 배열이다.
   * 예: 'research:all_classes', 'audit:real_data', 'lesson:read'
   */
  grantedScopes?: string[];
};

export type AccessTarget = {
  scope: DataScope;
  classCode?: string | null;
  classResearchId?: string | null;
};

export type AccessDenyReason =
  | 'not_authenticated'
  | 'not_configured'
  | 'account_disabled'
  | 'unknown_role'
  | 'role_forbidden'
  | 'class_not_assigned'
  | 'target_not_specified'
  | 'identifiable_read_forbidden'
  | 'delete_requires_approved_procedure'
  | 'developer_scope_not_granted';

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; reason: AccessDenyReason };

const ALLOW: AccessDecision = { allowed: true };
const deny = (reason: AccessDenyReason): AccessDecision => ({ allowed: false, reason });

function hasScope(principal: ServerPrincipal, scope: string): boolean {
  return Array.isArray(principal.grantedScopes) && principal.grantedScopes.includes(scope);
}

function inList(list: string[] | undefined, value: string | null | undefined): boolean {
  if (!value) return false;
  return Array.isArray(list) && list.includes(value);
}

/**
 * 역할·대상 범위 판정. Admin SDK를 쓰기 전에 반드시 통과해야 하는 관문이다.
 * 클라이언트가 보낸 역할·학급 값을 넣지 말고 서버에서 조회한 principal만 넣는다.
 */
export function evaluateAccess(
  principal: ServerPrincipal | null | undefined,
  target: AccessTarget,
  action: AccessAction
): AccessDecision {
  if (!principal) return deny('not_authenticated');
  if (principal.disabled) return deny('account_disabled');
  if (!isRole(principal.role)) return deny('unknown_role');

  // 학생 세션은 자기 활동만 한다. 학급 단위 자료 접근 경로가 없다.
  if (principal.role === 'student') return deny('role_forbidden');

  if (action === 'manage_users') {
    return principal.role === 'admin' ? ALLOW : deny('role_forbidden');
  }

  // 관리(학교 담당) 계정은 계정·수업ID 관리용이며 학생 자료의 기본 열람권이 없다.
  if (principal.role === 'admin') return deny('role_forbidden');

  // 개발자에게는 운영 자료 접근을 기본 제공하지 않는다.
  // 필요할 때 승인 기록으로 좁은 범위만 부여한다.
  if (principal.role === 'developer') {
    return hasScope(principal, `${target.scope}:${action}`)
      ? ALLOW
      : deny('developer_scope_not_granted');
  }

  if (principal.role === 'teacher') {
    if (target.scope === 'lesson') {
      if (!target.classCode) return deny('target_not_specified');
      if (!inList(principal.classCodes, target.classCode)) return deny('class_not_assigned');
      return ALLOW;
    }
    // 연구 저장소
    if (!target.classResearchId) return deny('target_not_specified');
    if (!inList(principal.classResearchIds, target.classResearchId)) {
      return deny('class_not_assigned');
    }
    if (action === 'delete') return deny('delete_requires_approved_procedure');
    return ALLOW;
  }

  // 연구자: 연구 저장소의 비식별 읽기·내보내기만 한다. 삭제 권한은 분리한다.
  if (principal.role === 'researcher') {
    if (target.scope === 'lesson') return deny('role_forbidden');
    if (action === 'read_identifiable') return deny('identifiable_read_forbidden');
    if (action === 'write') return deny('role_forbidden');
    if (action === 'delete') return deny('delete_requires_approved_procedure');
    const assigned =
      inList(principal.classResearchIds, target.classResearchId) ||
      hasScope(principal, 'research:all_classes');
    if (!assigned) return deny('class_not_assigned');
    return ALLOW;
  }

  return deny('role_forbidden');
}

// ── 동의 판정 ───────────────────────────────────────────────

export type ConsentGateInput = {
  /** isResearchConsentActive(record)의 결과. 보호자 동의와 학생 승낙이 모두 활성일 때만 true. */
  consentActive: boolean;
  /** 철회 시각. 값이 있으면 철회한 것이다. */
  withdrawnAt?: string | null;
  /** 동의서에 기록된 버전. */
  consentVersion?: string | null;
  /** 서버 설정의 현재 동의 버전(CONSENT_VERSION). 비어 있으면 연구 동의를 받을 수 없다. */
  requiredConsentVersion?: string | null;
};

export type ConsentDenyReason =
  | 'consent_version_unset'
  | 'consent_missing'
  | 'consent_withdrawn'
  | 'consent_version_mismatch'
  | 'consent_inactive';

export type ConsentDecision =
  | { allowed: true }
  | { allowed: false; reason: ConsentDenyReason };

/**
 * 연구 수집(검사 응답 저장·연구 로그·추가 채점 작업 등록)의 가부를 판정한다.
 * 미동의자의 연구 검사·연구 로그는 이 관문에서 막는다.
 */
export function evaluateResearchCollection(input: ConsentGateInput): ConsentDecision {
  const required = (input.requiredConsentVersion ?? '').trim();
  if (!required) {
    // 동의 버전이 확정되지 않았으면 연구 동의 자체를 받을 수 없다.
    return { allowed: false, reason: 'consent_version_unset' };
  }
  if (input.withdrawnAt) {
    // 철회 뒤에는 새 전송·추가 채점 작업을 만들지 않는다.
    // 기존 연구 자료와 백업 처리는 승인된 절차에 따라 별도로 기록한다.
    return { allowed: false, reason: 'consent_withdrawn' };
  }
  if (!input.consentVersion) return { allowed: false, reason: 'consent_missing' };
  if (input.consentVersion !== required) {
    return { allowed: false, reason: 'consent_version_mismatch' };
  }
  if (!input.consentActive) return { allowed: false, reason: 'consent_inactive' };
  return { allowed: true };
}

/**
 * 연구 수집이 불가한 학생의 다음 경로.
 * 별도 적법한 수업 도구 이용 근거가 있으면 비연구 수업 기록으로 남기고,
 * 그 근거가 없으면 외부 전송 없는 대체 활동으로 연결한다.
 */
export type NonResearchRoute = 'lesson_record_only' | 'offline_alternative';

export function routeForNonConsented(hasLessonToolBasis: boolean): NonResearchRoute {
  return hasLessonToolBasis ? 'lesson_record_only' : 'offline_alternative';
}
