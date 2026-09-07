import 'server-only';

/**
 * AuthApi 구현.
 *
 * 원칙(설계서 §6)
 *  - 교사 권한·동의 상태·학급·검사 시점은 클라이언트 입력을 신뢰하지 않고 서버에서 조회한다.
 *  - Admin SDK가 보안 규칙을 우회하므로 서버에서도 역할과 대상 범위를 검증한다.
 *    requireClassAccess는 Admin SDK를 쓰기 전에 반드시 통과해야 하는 관문이다.
 *  - 학교 담당자가 실명 대응표를 별도 관리하고 무작위 수업ID를 발급한다.
 *    수업ID 자체를 비밀번호로 간주하지 않는다. 수업ID만 알아도 연구 참가자로
 *    확정되지 않으며, 학생별 참가코드와 서버의 동의 기록이 함께 있어야 한다.
 *  - 자격증명이 없으면 AuthError('not_configured')로 실패한다. 우회로를 두지 않는다.
 */

import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import type { AuthApi, Principal, Role } from './contract';
import { AuthError } from './contract';
import {
  evaluateAccess,
  evaluateResearchCollection,
  isClassAccessOptions,
  resolveClassAccessAction,
  routeForNonConsented,
  type AccessAction,
  type ClassAccessOptions,
  type ServerPrincipal,
} from './access';
import {
  SESSION_TTL_MS,
  mintSessionToken,
  newSessionId,
  sessionCookieOptions,
  verifySessionToken,
  type StudentSessionClaims,
} from './session-token';
import {
  SESSION_HINT_COOKIE,
  SESSION_TOKEN_COOKIE,
  serializeSessionHint,
} from '@/server/lessons/session-cookie';
import { CONSENT_VERSION } from '@/server/config';
import {
  COLLECTIONS,
  assertSafeDocId,
  getAdminAuth,
  getAdminFirestore,
  isAdminConfigured,
} from '@/server/firebase-admin';
import {
  isResearchConsentActive,
  type ConsentRecord,
  type ConsentState,
  type SessionType,
} from '@/lib/research/types';

/** 교사·연구자·관리 계정의 세션 쿠키. 학생 토큰과 분리한다. */
export const STAFF_COOKIE = 'rp_staff';

const STAFF_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function sessionSecret(): string {
  return process.env.STUDENT_SESSION_SECRET?.trim() || '';
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** 참가코드는 원문을 저장하지 않는다. 서버 pepper와 함께 해시만 대조한다. */
function participantCodeHash(code: string): string {
  const pepper = process.env.PARTICIPANT_CODE_PEPPER?.trim() || '';
  if (!pepper) {
    throw new AuthError('참가코드 대조 설정이 없습니다.', 'not_configured');
  }
  return createHash('sha256').update(`${pepper}:${code.trim()}`).digest('hex');
}

async function readCookie(name: string): Promise<string | null> {
  try {
    const store = await cookies();
    return store.get(name)?.value ?? null;
  } catch {
    // 요청 맥락 밖에서 호출된 경우.
    return null;
  }
}

function toConsentState(value: unknown): ConsentState {
  return value === 'granted' || value === 'declined' || value === 'withdrawn' ? value : 'unknown';
}

function toConsentRecord(researchId: string, data: Record<string, unknown>): ConsentRecord {
  return {
    researchId,
    guardianConsent: toConsentState(data.guardianConsent),
    studentAssent: toConsentState(data.studentAssent),
    consentVersion: typeof data.consentVersion === 'string' ? data.consentVersion : null,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    withdrawnAt: typeof data.withdrawnAt === 'string' ? data.withdrawnAt : null,
  };
}

/** users 문서에서 읽은 서버 확정 계정. 클라이언트가 보낸 role을 쓰지 않는다. */
interface StaffAccount extends ServerPrincipal {
  role: 'teacher' | 'researcher' | 'developer' | 'admin';
}

async function loadStaffAccount(uid: string): Promise<StaffAccount | null> {
  const db = getAdminFirestore();
  const snap = await db.collection(COLLECTIONS.users).doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const role = data.role;
  if (role !== 'teacher' && role !== 'researcher' && role !== 'developer' && role !== 'admin') {
    return null;
  }
  return {
    uid,
    role,
    disabled: data.disabled === true,
    classCodes: Array.isArray(data.classCodes) ? (data.classCodes as string[]) : [],
    classResearchIds: Array.isArray(data.classResearchIds)
      ? (data.classResearchIds as string[])
      : [],
    grantedScopes: Array.isArray(data.grantedScopes) ? (data.grantedScopes as string[]) : [],
  };
}

/** 계약의 Principal로 변환한다. 계약 Role에 'developer'가 없으므로 개발자는 Principal을 받지 못한다. */
function staffToPrincipal(account: StaffAccount): Principal | null {
  if (account.disabled) return null;
  if (account.role === 'developer') {
    // 개발자에게 운영 자료 접근권한을 기본 제공하지 않는다.
    // 필요한 예외는 별도 승인 기록으로 좁게 부여하며 Principal로 승격하지 않는다.
    return null;
  }
  return {
    uid: account.uid,
    role: account.role,
    classResearchIds: account.classResearchIds ?? [],
    researchId: null,
    classResearchId: null,
    sessionType: 'experience',
  };
}

function principalToServer(p: Principal, extra?: Partial<ServerPrincipal>): ServerPrincipal {
  return {
    uid: p.uid,
    role: p.role,
    classResearchIds: p.classResearchIds,
    classCodes: extra?.classCodes ?? [],
    grantedScopes: extra?.grantedScopes ?? [],
    disabled: false,
  };
}

async function staffPrincipal(): Promise<Principal | null> {
  const token = await readCookie(STAFF_COOKIE);
  if (!token) return null;
  if (!isAdminConfigured()) {
    throw new AuthError('서버 인증 자격증명이 설정되지 않았습니다.', 'not_configured');
  }
  try {
    // checkRevoked=true — 계정 정지·비밀번호 변경 즉시 반영.
    const decoded = await getAdminAuth().verifySessionCookie(token, true);
    const account = await loadStaffAccount(decoded.uid);
    if (!account) return null;
    return staffToPrincipal(account);
  } catch (e) {
    if (e instanceof AuthError) throw e;
    return null;
  }
}

async function studentPrincipal(): Promise<Principal | null> {
  const token = await readCookie(SESSION_TOKEN_COOKIE);
  if (!token) return null;
  const verified = verifySessionToken(token, sessionSecret(), Date.now());
  if (!verified.ok) {
    if (verified.reason === 'no_secret') {
      throw new AuthError('세션 서명 키가 설정되지 않았습니다.', 'not_configured');
    }
    return null;
  }
  const claims = verified.claims;
  // 폐기 목록 대조는 서버 기록으로만 한다. 조회할 수 없으면 통과시키지 않는다.
  if (!isAdminConfigured()) {
    throw new AuthError('서버 인증 자격증명이 설정되지 않았습니다.', 'not_configured');
  }
  const snap = await getAdminFirestore()
    .collection(COLLECTIONS.studentSessions)
    .doc(claims.sid)
    .get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  if (data.revokedAt) return null;

  return {
    uid: `session:${claims.sid}`,
    role: 'student',
    classResearchIds: claims.classResearchId ? [claims.classResearchId] : [],
    researchId: claims.researchId,
    classResearchId: claims.classResearchId,
    sessionType: claims.sessionType,
  };
}

// ── AuthApi 구현 ────────────────────────────────────────────

async function getPrincipal(): Promise<Principal | null> {
  try {
    const staff = await staffPrincipal();
    if (staff) return staff;
    return await studentPrincipal();
  } catch (e) {
    if (e instanceof AuthError && e.code === 'not_configured') throw e;
    return null;
  }
}

async function requirePrincipal(): Promise<Principal> {
  const p = await getPrincipal();
  if (p) return p;
  if (!isAdminConfigured()) {
    throw new AuthError('서버 인증이 설정되지 않았습니다.', 'not_configured');
  }
  throw new AuthError('로그인이 필요합니다.', 'unauthenticated');
}

async function requireRole(...roles: Role[]): Promise<Principal> {
  const p = await requirePrincipal();
  if (roles.length > 0 && !roles.includes(p.role)) {
    throw new AuthError('이 작업을 할 권한이 없습니다.', 'forbidden');
  }
  return p;
}

/**
 * 학급 접근 관문.
 *
 * 행위를 함께 받는다. 예전에는 무조건 'read'로 판정해 연구자의 write·delete 금지
 * 분기를 아무도 타지 않았다(감사 A-4). 행위를 밝히지 않은 호출은 'write'로 본다.
 * 읽기로 가정하는 쪽이 더 관대하기 때문이며, 읽기 전용 경로는 { action: 'read' }를
 * 명시한다. 기존 호출 방식(역할만 나열)은 그대로 둔다.
 */
async function requireClassAccess(
  classResearchId: string,
  ...rolesOrOptions: (Role | ClassAccessOptions)[]
): Promise<Principal> {
  if (!classResearchId) {
    throw new AuthError('대상 학급이 지정되지 않았습니다.', 'forbidden');
  }
  const roles = rolesOrOptions.filter((v): v is Role => !isClassAccessOptions(v));
  const action: AccessAction = resolveClassAccessAction(rolesOrOptions);

  const p = await requireRole(...roles);

  if (p.role === 'student') {
    // 학생은 자신이 속한 학급의 허용 활동만 한다.
    if (p.classResearchId !== classResearchId) {
      throw new AuthError('다른 학급의 자료에 접근할 수 없습니다.', 'forbidden');
    }
    return p;
  }

  const account = await loadStaffAccount(p.uid);
  const decision = evaluateAccess(
    principalToServer(p, {
      classCodes: account?.classCodes ?? [],
      grantedScopes: account?.grantedScopes ?? [],
    }),
    { scope: 'research', classResearchId },
    action
  );
  if (!decision.allowed) {
    throw new AuthError(`학급 접근이 거부되었습니다(${decision.reason}).`, 'forbidden');
  }
  return p;
}

async function getConsent(researchId: string): Promise<ConsentRecord | null> {
  if (!researchId) return null;
  if (!isAdminConfigured()) {
    throw new AuthError('서버 인증 자격증명이 설정되지 않았습니다.', 'not_configured');
  }
  const snap = await getAdminFirestore().collection(COLLECTIONS.consents).doc(researchId).get();
  if (!snap.exists) return null;
  return toConsentRecord(researchId, snap.data() ?? {});
}

async function requireActiveResearchConsent(researchId: string): Promise<ConsentRecord> {
  const record = await getConsent(researchId);
  const decision = evaluateResearchCollection({
    consentActive: isResearchConsentActive(record),
    withdrawnAt: record?.withdrawnAt ?? null,
    consentVersion: record?.consentVersion ?? null,
    requiredConsentVersion: CONSENT_VERSION,
  });
  if (!decision.allowed) {
    throw new AuthError(`연구 수집을 할 수 없습니다(${decision.reason}).`, 'forbidden');
  }
  return record as ConsentRecord;
}

// ── 세션 발급·갱신·폐기 ─────────────────────────────────────

export interface IssuedSession {
  token: string;
  hint: string;
  claims: StudentSessionClaims;
  cookieOptions: ReturnType<typeof sessionCookieOptions>;
  /** 연구 수집이 불가한 학생을 어디로 보낼지. */
  route: 'research' | 'lesson_record_only' | 'offline_alternative';
}

export interface IssueSessionInput {
  /** 학교 담당자가 발급한 무작위 수업ID. 이것만으로는 연구 참가자가 되지 않는다. */
  classResearchId: string;
  /** 학생별 참가코드(선택). 없으면 연구 수집 없는 세션이 된다. */
  participantCode?: string | null;
  /** 비연구 수업 기록에 쓰는 기존 학급 코드(선택). */
  classCode?: string | null;
}

/**
 * 학생 세션 토큰을 발급한다.
 * 수업ID는 비밀번호가 아니므로, 수업ID만으로는 researchId가 붙지 않는다.
 * 참가코드가 맞고 서버의 동의 기록이 활성일 때만 연구ID를 세션에 넣는다.
 */
async function issueStudentSession(input: IssueSessionInput): Promise<IssuedSession> {
  const secret = sessionSecret();
  if (!secret) {
    throw new AuthError('세션 서명 키가 설정되지 않았습니다.', 'not_configured');
  }
  if (!isAdminConfigured()) {
    throw new AuthError('서버 인증 자격증명이 설정되지 않았습니다.', 'not_configured');
  }
  const db = getAdminFirestore();
  const classSnap = await db
    .collection(COLLECTIONS.researchClasses)
    .doc(input.classResearchId)
    .get();
  if (!classSnap.exists || classSnap.data()?.active !== true) {
    throw new AuthError('열려 있는 수업이 아닙니다.', 'forbidden');
  }
  const classData = classSnap.data() ?? {};
  const sessionType: SessionType =
    classData.sessionType === 'research_practice' ||
    classData.sessionType === 'research_assessment'
      ? classData.sessionType
      : 'experience';

  let researchId: string | null = null;
  if (input.participantCode) {
    const hash = participantCodeHash(input.participantCode);
    const found = await classSnap.ref
      .collection('participants')
      .where('codeHash', '==', hash)
      .limit(1)
      .get();
    if (!found.empty) {
      const candidate = found.docs[0].id;
      const consent = await getConsent(candidate);
      const decision = evaluateResearchCollection({
        consentActive: isResearchConsentActive(consent),
        withdrawnAt: consent?.withdrawnAt ?? null,
        consentVersion: consent?.consentVersion ?? null,
        requiredConsentVersion: CONSENT_VERSION,
      });
      // 미동의·철회는 연구 수집 대상이 아니다. 연구ID를 세션에 넣지 않는다.
      if (decision.allowed) researchId = candidate;
    }
  }

  const now = Date.now();
  const sid = newSessionId();
  const claims: StudentSessionClaims = {
    v: 1,
    sid,
    researchId,
    classResearchId: input.classResearchId,
    classCode: input.classCode ?? null,
    sessionType,
    role: 'student',
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const token = mintSessionToken(claims, secret);
  if (!token) throw new AuthError('세션 발급에 실패했습니다.', 'not_configured');

  await db.collection(COLLECTIONS.studentSessions).doc(sid).set({
    classResearchId: input.classResearchId,
    researchId,
    sessionType,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(claims.exp).toISOString(),
    revokedAt: null,
  });

  const lessonBasis = classData.lessonToolBasis === true;
  const route = researchId
    ? ('research' as const)
    : routeForNonConsented(lessonBasis);

  return {
    token,
    hint: serializeSessionHint({ sessionType, classResearchId: input.classResearchId }),
    claims,
    cookieOptions: sessionCookieOptions(SESSION_TTL_MS, isProduction()),
    route,
  };
}

/** 토큰 갱신. 같은 세션 식별자를 유지하고 만료만 미룬다. 폐기된 세션은 갱신하지 않는다. */
async function refreshStudentSession(): Promise<IssuedSession> {
  const secret = sessionSecret();
  if (!secret) throw new AuthError('세션 서명 키가 설정되지 않았습니다.', 'not_configured');
  const token = await readCookie(SESSION_TOKEN_COOKIE);
  const verified = verifySessionToken(token, secret, Date.now());
  if (!verified.ok) throw new AuthError('세션을 갱신할 수 없습니다.', 'unauthenticated');
  if (!isAdminConfigured()) {
    throw new AuthError('서버 인증 자격증명이 설정되지 않았습니다.', 'not_configured');
  }

  const db = getAdminFirestore();
  const ref = db.collection(COLLECTIONS.studentSessions).doc(verified.claims.sid);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.revokedAt) {
    throw new AuthError('세션이 폐기되었습니다.', 'unauthenticated');
  }

  // 동의가 철회되었으면 갱신 시점에 연구ID를 떼어 낸다(새 전송·추가 채점 차단).
  let researchId = verified.claims.researchId;
  if (researchId) {
    const consent = await getConsent(researchId);
    const decision = evaluateResearchCollection({
      consentActive: isResearchConsentActive(consent),
      withdrawnAt: consent?.withdrawnAt ?? null,
      consentVersion: consent?.consentVersion ?? null,
      requiredConsentVersion: CONSENT_VERSION,
    });
    if (!decision.allowed) researchId = null;
  }

  const now = Date.now();
  const claims: StudentSessionClaims = {
    ...verified.claims,
    researchId,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const next = mintSessionToken(claims, secret);
  if (!next) throw new AuthError('세션 갱신에 실패했습니다.', 'not_configured');
  await ref.update({
    researchId,
    expiresAt: new Date(claims.exp).toISOString(),
  });

  return {
    token: next,
    hint: serializeSessionHint({
      sessionType: claims.sessionType,
      classResearchId: claims.classResearchId,
    }),
    claims,
    cookieOptions: sessionCookieOptions(SESSION_TTL_MS, isProduction()),
    route: researchId ? 'research' : 'lesson_record_only',
  };
}

/** 세션 폐기. 자료를 지우지 않고 세션만 무효화한다. */
async function revokeStudentSession(): Promise<void> {
  const token = await readCookie(SESSION_TOKEN_COOKIE);
  const verified = verifySessionToken(token, sessionSecret(), Date.now());
  if (!verified.ok || !isAdminConfigured()) return;
  await getAdminFirestore()
    .collection(COLLECTIONS.studentSessions)
    .doc(verified.claims.sid)
    .set({ revokedAt: new Date().toISOString() }, { merge: true });
}

/** 교사·연구자 로그인. Firebase ID 토큰을 서버가 검증하고 세션 쿠키로 바꾼다. */
async function createStaffSession(idToken: string): Promise<{
  cookie: string;
  cookieOptions: ReturnType<typeof sessionCookieOptions>;
  role: Role;
}> {
  if (!isAdminConfigured()) {
    throw new AuthError('서버 인증 자격증명이 설정되지 않았습니다.', 'not_configured');
  }
  const adminAuth = getAdminAuth();
  const decoded = await adminAuth.verifyIdToken(idToken, true).catch(() => null);
  if (!decoded) throw new AuthError('로그인 정보를 확인할 수 없습니다.', 'unauthenticated');

  const account = await loadStaffAccount(decoded.uid);
  const principal = account ? staffToPrincipal(account) : null;
  if (!principal) {
    // 익명 로그인·미등록 계정·개발자 계정은 운영 세션을 받지 못한다.
    throw new AuthError('운영 자료에 접근할 수 있는 계정이 아닙니다.', 'forbidden');
  }

  const cookie = await adminAuth.createSessionCookie(idToken, {
    expiresIn: STAFF_SESSION_TTL_MS,
  });
  return {
    cookie,
    cookieOptions: sessionCookieOptions(STAFF_SESSION_TTL_MS, isProduction()),
    role: principal.role,
  };
}

/**
 * 동의 철회 기록. 새 전송·추가 채점 작업을 막고 세션을 폐기한다.
 * 기존 연구 자료와 백업 처리는 승인된 절차에 따라 별도로 수행한다.
 * 이 함수는 자료를 삭제하지 않는다(파기 정책을 '전체 즉시 삭제'로 임의 구현하지 않는다).
 */
async function recordConsentWithdrawal(input: {
  researchId: string;
  actorUid: string;
  reason: string;
}): Promise<void> {
  if (!isAdminConfigured()) {
    throw new AuthError('서버 인증 자격증명이 설정되지 않았습니다.', 'not_configured');
  }
  const db = getAdminFirestore();
  const now = new Date().toISOString();
  await db
    .collection(COLLECTIONS.consents)
    .doc(input.researchId)
    .set({ withdrawnAt: now, updatedAt: now }, { merge: true });
  await db.collection(COLLECTIONS.consentEvents).add({
    researchId: input.researchId,
    event: 'withdrawn',
    actorUid: input.actorUid,
    reason: input.reason,
    recordedAt: now,
    // 자료 파기는 승인된 절차의 결과를 사람이 별도로 기록한다.
    dataDisposition: 'pending_approved_procedure',
  });
  const sessions = await db
    .collection(COLLECTIONS.studentSessions)
    .where('researchId', '==', input.researchId)
    .get();
  await Promise.all(
    sessions.docs.map((d) => d.ref.set({ revokedAt: now }, { merge: true }))
  );
}

/**
 * 감수 AI에 실데이터를 보내려면 필요한 승인 확인.
 * 연구자 역할 + 명시적 승인 기록이 모두 있어야 통과한다.
 */
async function requireRealDataAuditApproval(input: {
  approvalId: string;
  classResearchId: string;
}): Promise<{ approvalId: string; approvedBy: string; approvedAt: string }> {
  const principal = await requireRole('researcher');
  await requireClassAccess(input.classResearchId, { action: 'read' }, 'researcher');
  if (!isAdminConfigured()) {
    throw new AuthError('서버 인증 자격증명이 설정되지 않았습니다.', 'not_configured');
  }
  const snap = await getAdminFirestore()
    .collection(COLLECTIONS.auditApprovals)
    .doc(input.approvalId)
    .get();
  const data = snap.exists ? snap.data() ?? {} : null;
  if (
    !data ||
    data.active !== true ||
    data.scope !== 'audit_real_data' ||
    data.classResearchId !== input.classResearchId
  ) {
    throw new AuthError('감수 전송에 대한 승인 기록이 없습니다.', 'forbidden');
  }
  return {
    approvalId: input.approvalId,
    approvedBy: typeof data.approvedBy === 'string' ? data.approvedBy : principal.uid,
    approvedAt: typeof data.approvedAt === 'string' ? data.approvedAt : '',
  };
}

// ── 차시 모듈(@/server/lessons/auth-bridge)이 요구하는 표면 ──────

export interface ServerStudentSession {
  sessionType: SessionType;
  classResearchId: string | null;
  researchId: string | null;
  classCode: string | null;
  /** 세션 자체의 소유자 식별자. 연구ID가 없는 체험 세션의 소유 판정에 쓴다. */
  sessionOwner: string;
  consentActive: boolean;
  consentVersion: string | null;
  verified: true;
}

/**
 * 학생 요청의 서버 확정 세션.
 *
 * 확정하지 못하면 null이다. 예전에는 오류를 삼켜 null을 돌려주었고 호출부가 그것을
 * 일반 체험으로 채워 넣었다. 설정 오류(not_configured)는 이제 그대로 올라가고,
 * 세션이 없거나 서명 검증에 실패하면 null이 되어 호출부가 거부한다(감사 A-3).
 */
async function resolveSessionContext(): Promise<ServerStudentSession | null> {
  // not_configured는 던진다. 삼켜서 '설정 없이 개방'이 되게 하지 않는다.
  const principal = await getPrincipal();
  if (!principal || principal.role !== 'student') return null;

  // 세션 토큰의 서명을 다시 확인한다. 통과하지 못하면 세션이 없는 것이다.
  const token = await readCookie(SESSION_TOKEN_COOKIE);
  const verified = verifySessionToken(token, sessionSecret(), Date.now());
  if (!verified.ok) {
    if (verified.reason === 'no_secret') {
      throw new AuthError('세션 서명 키가 설정되지 않았습니다.', 'not_configured');
    }
    return null;
  }

  let consentActive = false;
  let consentVersion: string | null = null;
  if (principal.researchId) {
    // 조회 실패를 '동의 없음'으로 조용히 바꾸지 않는다. 오류는 올려서 거부하게 한다.
    const consent = await getConsent(principal.researchId);
    consentActive = isResearchConsentActive(consent);
    consentVersion = consent?.consentVersion ?? null;
  }

  return {
    sessionType: principal.sessionType,
    classResearchId: principal.classResearchId,
    researchId: principal.researchId,
    classCode: verified.claims.classCode,
    sessionOwner: principal.uid,
    consentActive,
    consentVersion,
    verified: true,
  };
}

/**
 * 학급의 세션 성격을 서버 기록에서 읽는다.
 * 교사가 보낸 값으로 연구 학급을 체험으로 여는 길을 막는다(감사 A-5).
 */
async function getClassSessionType(classResearchId: string): Promise<SessionType> {
  if (!isAdminConfigured()) {
    throw new AuthError('서버 인증 자격증명이 설정되지 않았습니다.', 'not_configured');
  }
  const snap = await getAdminFirestore()
    .collection(COLLECTIONS.researchClasses)
    .doc(assertSafeDocId(classResearchId, '학급'))
    .get();
  if (!snap.exists) {
    throw new AuthError('등록된 수업이 아닙니다.', 'forbidden');
  }
  const value = snap.data()?.sessionType;
  return value === 'research_practice' || value === 'research_assessment' ? value : 'experience';
}

async function requireTeacherForClass(
  classResearchId: string
): Promise<{ teacherId: string; classResearchId: string }> {
  const p = await requireClassAccess(classResearchId, { action: 'write' }, 'teacher');
  return { teacherId: p.uid, classResearchId };
}

export const auth: AuthApi & {
  issueStudentSession: typeof issueStudentSession;
  refreshStudentSession: typeof refreshStudentSession;
  revokeStudentSession: typeof revokeStudentSession;
  createStaffSession: typeof createStaffSession;
  recordConsentWithdrawal: typeof recordConsentWithdrawal;
  requireRealDataAuditApproval: typeof requireRealDataAuditApproval;
  resolveSessionContext: typeof resolveSessionContext;
  requireTeacherForClass: typeof requireTeacherForClass;
  getClassSessionType: typeof getClassSessionType;
} = {
  getPrincipal,
  requirePrincipal,
  requireRole,
  requireClassAccess,
  getConsent,
  requireActiveResearchConsent,
  issueStudentSession,
  refreshStudentSession,
  revokeStudentSession,
  createStaffSession,
  recordConsentWithdrawal,
  requireRealDataAuditApproval,
  resolveSessionContext,
  requireTeacherForClass,
  getClassSessionType,
};

export { AuthError } from './contract';
export type { Principal, Role } from './contract';
export { SESSION_TOKEN_COOKIE, SESSION_HINT_COOKIE };
