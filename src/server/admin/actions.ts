'use server';

/**
 * 통합 관리 화면(/admin)의 server action.
 *
 * 역할 나누기
 *   - 관리자(이 화면): 반을 만들고, 반 입장 비밀번호를 정하고, 수업을 시작·종료하고,
 *     차시를 열고 닫는다. 교사 계정을 만들어 반을 배정하고 비밀번호를 다시 정한다.
 *   - 교사(/teacher): 관리자가 만든 계정으로 로그인해 배정된 반의 학생 진행을 본다.
 *   - 학생(첫 화면): 수업 번호 + 반 비밀번호 + 번호로 그 반에만 들어간다.
 *
 * 지키는 것
 *   - 모든 조작 action은 첫 줄에서 requireAdmin()으로 관리자 세션을 확인한다.
 *     화면에서 단추를 숨기는 것은 차단이 아니다.
 *   - 비밀번호는 원문을 저장하지 않는다. 반 비밀번호·관리자 비밀번호는 scrypt 해시로,
 *     교사 비밀번호는 Firebase Authentication이 보관한다.
 *   - 이 화면은 학생 답안·점수를 읽지 않는다(access.ts: 관리 계정은 반·계정 관리만).
 *     입장 중인 학생 수만 센다.
 *   - 연구 성격의 반은 registry.readiness()가 통과할 때만 만든다. 코드가 만들어 낼 수
 *     없는 운영값(IRB·동의 버전·전문가 확정)을 대신 채우지 않는다.
 *   - 반의 세션 성격은 만들 때 한 번 정하고 바꾸지 않는다(감사 A-5).
 *
 * 'use server' 파일이므로 export는 모두 async 함수다. 오류는 던지지 않고 값으로 돌려준다
 * (프로덕션에서는 던진 오류의 문구가 화면에 전달되지 않기 때문이다).
 */

import 'server-only';

import { AuthError } from '@/server/auth/contract';
import {
  COLLECTIONS,
  assertSafeDocId,
  getAdminAuth,
  getAdminFirestore,
} from '@/server/firebase-admin';
import { getLessonStore } from '@/server/lessons/store';
import { registry } from '@/server/registry';
import type { SessionType } from '@/lib/research/types';
import { parseCreatableSessionType } from '@/lib/research/session-modes';

import {
  ADMIN_ACTOR,
  changeAdminPassword,
  readSetupStatus,
  recordAdminEvent,
  requireAdmin,
  signInAdmin,
  signOutAdmin,
  type AdminSetupStatus,
} from './auth';
import {
  checkFirebaseSetup,
  enableEmailPasswordSignIn,
  type FirebaseSetupCheck,
} from './firebase-setup';
import {
  describeFirebaseError,
  generateClassId,
  hashPassword,
  normalizeClassLabel,
  normalizeDisplayName,
  normalizeEmail,
  passwordProblem,
  sanitizeClassAssignments,
} from './core';

/* ────────────────────────── 결과 형 ────────────────────────── */

export type AdminResult<T = null> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      /** 관리자 세션이 없거나 끝났다. 화면은 로그인으로 돌아간다. */
      signedOut: boolean;
    };

/** 화면에 그대로 보여 줄 입력 오류. */
class AdminInputError extends Error {}

function toFailure(err: unknown): Extract<AdminResult, { ok: false }> {
  if (err instanceof AuthError) {
    return { ok: false, error: err.message, signedOut: err.code === 'unauthenticated' };
  }
  if (err instanceof AdminInputError) {
    return { ok: false, error: err.message, signedOut: false };
  }
  const code = (err as { code?: unknown } | null)?.code;
  const message = (err as { message?: unknown } | null)?.message;
  // 원인을 찾을 수 있도록 오류 코드와 Firebase가 준 문구를 서버 로그에 남긴다.
  // 입력값·비밀번호는 싣지 않는다(Firebase 오류 문구에도 비밀번호는 들어가지 않는다).
  console.error('[admin] 처리 실패', code ?? '', typeof message === 'string' ? message.slice(0, 300) : '');
  const described = describeFirebaseError(code, message);
  return {
    ok: false,
    error: described ?? '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    signedOut: false,
  };
}

async function run<T>(fn: () => Promise<T>): Promise<AdminResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return toFailure(err);
  }
}

/* ────────────────────────── 세션 ────────────────────────── */

export interface AdminStatus {
  setup: AdminSetupStatus;
  signedIn: boolean;
  /** 연구 성격의 반을 만들 수 있는가와 그 까닭. 로그인한 뒤에만 채운다. */
  research: { ready: boolean; blockers: string[] } | null;
  /** Firebase 프로젝트 일치·교사 로그인 방식 점검. 로그인한 뒤에만 채운다. */
  firebase: FirebaseSetupCheck | null;
}

export async function getAdminStatusAction(): Promise<AdminStatus> {
  const setup = await readSetupStatus();
  let signedIn = false;
  try {
    await requireAdmin();
    signedIn = true;
  } catch {
    signedIn = false;
  }
  let research: AdminStatus['research'] = null;
  let firebase: AdminStatus['firebase'] = null;
  if (signedIn) {
    firebase = await checkFirebaseSetup().catch(() => null);
    try {
      const r = registry.readiness();
      research = { ready: r.researchReady, blockers: r.blockers };
    } catch {
      research = { ready: false, blockers: ['연구 준비 상태를 확인하지 못했습니다.'] };
    }
  }
  return { setup, signedIn, research, firebase };
}

/**
 * 교사 로그인(이메일/비밀번호) 방식을 켠다. 켠 뒤 다시 점검한 결과를 돌려준다.
 * 켜지 못했으면 Firebase 콘솔에서 켜 달라고 안내한다.
 */
export async function enableTeacherLoginAction(): Promise<AdminResult<FirebaseSetupCheck>> {
  return run(async () => {
    await requireAdmin();
    const enabled = await enableEmailPasswordSignIn();
    const check = await checkFirebaseSetup();
    if (!enabled && check.teacherLogin !== 'enabled') {
      throw new AdminInputError(
        '자동으로 켜지 못했습니다. 아래 링크의 Firebase 콘솔에서 “이메일/비밀번호”를 사용 설정해 주세요.'
      );
    }
    await recordAdminEvent('enable_teacher_login', null, null);
    return check;
  });
}

export async function adminSignInAction(password: string): Promise<AdminResult> {
  return run(async () => {
    await signInAdmin(password);
    return null;
  });
}

export async function adminSignOutAction(): Promise<void> {
  await signOutAdmin();
}

export async function changeAdminPasswordAction(
  current: string,
  next: string
): Promise<AdminResult> {
  return run(async () => {
    await requireAdmin();
    await changeAdminPassword(current, next);
    return null;
  });
}

/* ────────────────────────── 조회 ────────────────────────── */

export interface AdminLessonView {
  allowedLessons: number[];
  currentLesson: number | null;
  openedAt: string | null;
  closedAt: string | null;
  /** 교사가 연 차시만 열리는 반인가(체험 반 포함). */
  teacherPaced: boolean;
  updatedAt: string | null;
}

export interface AdminClassRow {
  classId: string;
  label: string | null;
  sessionType: SessionType;
  /** 학생이 수업 번호로 새로 들어올 수 있는가 */
  active: boolean;
  hasPassword: boolean;
  /** 이 화면에서 만든 반인가. 아니면 손으로 만든 옛 기록이다. */
  managed: boolean;
  createdAt: string | null;
  lesson: AdminLessonView | null;
  /** 폐기되지 않았고 만료 전인 학생 세션 수. 학생 신원은 담지 않는다. */
  activeStudents: number;
}

export interface AdminTeacherRow {
  uid: string;
  email: string | null;
  displayName: string | null;
  classResearchIds: string[];
  disabled: boolean;
  createdAt: string | null;
}

export interface AdminConsoleData {
  classes: AdminClassRow[];
  teachers: AdminTeacherRow[];
  loadedAt: string;
}

function toSessionType(value: unknown): SessionType {
  return value === 'research_practice' || value === 'research_assessment' ? value : 'experience';
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const strList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

async function countActiveStudents(classId: string, nowIso: string): Promise<number> {
  const snap = await getAdminFirestore()
    .collection(COLLECTIONS.studentSessions)
    .where('classResearchId', '==', classId)
    .get();
  return snap.docs.filter((d) => {
    const data = d.data();
    return !data.revokedAt && typeof data.expiresAt === 'string' && data.expiresAt > nowIso;
  }).length;
}

async function loadTeachers(): Promise<AdminTeacherRow[]> {
  const snap = await getAdminFirestore()
    .collection(COLLECTIONS.users)
    .where('role', '==', 'teacher')
    .get();
  const rows: AdminTeacherRow[] = snap.docs.map((d) => {
    const data = d.data();
    return {
      uid: d.id,
      email: str(data.email),
      displayName: str(data.displayName),
      classResearchIds: strList(data.classResearchIds),
      disabled: data.disabled === true,
      createdAt: str(data.createdAt),
    };
  });
  // 손으로 만든 옛 계정은 users 문서에 이메일이 없을 수 있다. Auth에서 채운다.
  const missing = rows.filter((r) => !r.email);
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const found = await getAdminAuth().getUsers(chunk.map((r) => ({ uid: r.uid })));
    for (const user of found.users) {
      const row = rows.find((r) => r.uid === user.uid);
      if (row) {
        row.email = user.email ?? null;
        row.displayName = row.displayName ?? user.displayName ?? null;
      }
    }
  }
  return rows.sort((a, b) => (a.email ?? a.uid).localeCompare(b.email ?? b.uid));
}

async function listClassIds(): Promise<string[]> {
  const snap = await getAdminFirestore().collection(COLLECTIONS.researchClasses).get();
  return snap.docs.map((d) => d.id);
}

export async function loadConsoleAction(): Promise<AdminResult<AdminConsoleData>> {
  return run(async () => {
    await requireAdmin();
    const db = getAdminFirestore();
    const store = getLessonStore();
    const now = new Date().toISOString();
    const snap = await db.collection(COLLECTIONS.researchClasses).get();

    const classes = await Promise.all(
      snap.docs.map(async (d): Promise<AdminClassRow> => {
        const data = d.data();
        const [lesson, activeStudents] = await Promise.all([
          store.readLessonSession(d.id).catch(() => null),
          countActiveStudents(d.id, now).catch(() => 0),
        ]);
        return {
          classId: d.id,
          label: str(data.label),
          sessionType: toSessionType(data.sessionType),
          active: data.active === true,
          hasPassword: typeof data.entryPassword === 'string' && data.entryPassword.length > 0,
          managed: data.managedBy === 'admin_console',
          createdAt: str(data.createdAt),
          lesson: lesson
            ? {
                allowedLessons: [...(lesson.allowedLessons ?? [])].sort((a, b) => a - b),
                currentLesson: lesson.currentLesson ?? null,
                openedAt: lesson.openedAt ?? null,
                closedAt: lesson.closedAt ?? null,
                teacherPaced: lesson.pacing === 'teacher',
                updatedAt: lesson.updatedAt ?? null,
              }
            : null,
          activeStudents,
        };
      })
    );
    classes.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.classId.localeCompare(b.classId));

    return { classes, teachers: await loadTeachers(), loadedAt: now };
  });
}

/* ────────────────────────── 반 만들기·비밀번호 ────────────────────────── */

const CREATE_ATTEMPTS = 8;

export async function createClassAction(input: {
  label: string;
  sessionType: SessionType;
  entryPassword: string | null;
}): Promise<AdminResult<{ classId: string }>> {
  return run(async () => {
    await requireAdmin();

    const label = normalizeClassLabel(input.label);
    if (!label) throw new AdminInputError('반 이름을 적어 주세요.');

    // 연구 세션은 연습 모드만 연다(논문 v12). 사전·사후 검사가 열리는 연구 검사 반과
    // 모르는 값은 체험으로 바꾸지 않고 거절한다.
    const sessionType = parseCreatableSessionType(input.sessionType);
    if (sessionType === null) {
      throw new AdminInputError('만들 수 없는 반 성격입니다. 일반 수업 또는 연구 수업을 골라 주세요.');
    }
    if (sessionType !== 'experience') {
      // 연구 성격의 반은 연구 시작 조건이 모두 갖춰졌을 때만 만든다.
      const readiness = registry.readiness();
      if (!readiness.researchReady) {
        throw new AdminInputError(
          `아직 연구 수업을 열 수 없습니다: ${readiness.blockers.join(' / ')}`
        );
      }
    }

    const password = input.entryPassword ?? '';
    if (password) {
      const problem = passwordProblem(password, 'class');
      if (problem) throw new AdminInputError(problem);
    }
    const entryPassword = password ? await hashPassword(password) : null;

    const db = getAdminFirestore();
    const now = new Date().toISOString();
    let classId: string | null = null;
    for (let i = 0; i < CREATE_ATTEMPTS && !classId; i += 1) {
      const candidate = generateClassId();
      try {
        await db.collection(COLLECTIONS.researchClasses).doc(candidate).create({
          label,
          sessionType,
          // 만들자마자 학생이 들어오지 않게 닫아 둔다. '수업 시작'으로 연다.
          active: false,
          entryPassword,
          // 일반 수업 기록(classes/…)의 학급 키. 학생이 보낸 값이 아니라 여기 값만 쓴다.
          classCode: candidate,
          // 일반 수업은 교사 추적을 위해 번호를 받는다. 연구 수업은 참가 번호로 확인한다.
          requireStudentNumber: sessionType === 'experience',
          managedBy: 'admin_console',
          createdAt: now,
          updatedAt: now,
        });
        classId = candidate;
      } catch (err) {
        const code = (err as { code?: unknown } | null)?.code;
        const exists = code === 6 || /already exists/i.test(String((err as Error)?.message ?? ''));
        if (!exists) throw err;
      }
    }
    if (!classId) throw new AdminInputError('수업 번호를 만들지 못했습니다. 다시 눌러 주세요.');

    // 관리 화면에서 만든 반은 체험이어도 교사가 연 차시만 열린다.
    await getLessonStore().ensureLessonSession({
      classResearchId: classId,
      sessionType,
      pacing: 'teacher',
    });
    await recordAdminEvent('create_class', classId, {
      sessionType,
      hasPassword: entryPassword !== null,
    });
    return { classId };
  });
}

async function requireClassDoc(classId: string) {
  const id = assertSafeDocId(String(classId ?? ''), '수업 번호');
  const ref = getAdminFirestore().collection(COLLECTIONS.researchClasses).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new AdminInputError('없는 반입니다. 목록을 새로 고쳐 주세요.');
  return { id, ref, data: snap.data() ?? {} };
}

/** 반 입장 비밀번호를 정하거나(해시로 저장) 없앤다. 이미 들어온 학생은 그대로 둔다. */
export async function setClassPasswordAction(
  classId: string,
  password: string | null
): Promise<AdminResult> {
  return run(async () => {
    await requireAdmin();
    const { id, ref } = await requireClassDoc(classId);
    const now = new Date().toISOString();
    if (password) {
      const problem = passwordProblem(password, 'class');
      if (problem) throw new AdminInputError(problem);
      await ref.update({ entryPassword: await hashPassword(password), updatedAt: now });
    } else {
      await ref.update({ entryPassword: null, updatedAt: now });
    }
    await recordAdminEvent('set_class_password', id, { cleared: !password });
    return null;
  });
}

/* ────────────────────────── 수업 시작·차시·종료 ────────────────────────── */

/** 수업 시작: 학생 입장을 열고 그 차시를 연다. 닫혀 있던 수업이면 다시 연다. */
/** 관리 화면이 여는 차시. 수업을 시작하면 모두 열고, 학생은 1번부터 순서대로 푼다. */
const ALL_LESSONS = [1, 2, 3, 4, 5, 6] as const;

/**
 * 수업 시작 = 학생 입장 열기 + 1~6차시 모두 열기. 끝난 수업도 다시 연다.
 * 단계를 하나씩 열고 닫지 않는다. 학생 화면이 앞 문항을 낸 순서대로만 다음 문항을 연다.
 * 이미 수업 중인 반에 다시 부르면 빠진 차시를 채운다(예전 방식으로 일부만 열린 반).
 */
export async function startClassAction(classId: string): Promise<AdminResult> {
  return run(async () => {
    await requireAdmin();
    const { id, ref, data } = await requireClassDoc(classId);
    const { durable } = await getLessonStore().openLessonSession({
      classResearchId: id,
      sessionType: toSessionType(data.sessionType),
      lesson: 1,
      alsoOpen: ALL_LESSONS,
      openedBy: ADMIN_ACTOR,
      reason: '관리 화면: 수업 시작(1~6차시)',
    });
    if (!durable) throw new AdminInputError('차시 기록을 서버에 남기지 못했습니다. 다시 해 주세요.');
    await ref.update({ active: true, updatedAt: new Date().toISOString() });
    await recordAdminEvent('start_class', id, { lessons: [...ALL_LESSONS] });
    return null;
  });
}

async function revokeClassSessions(classId: string): Promise<number> {
  const db = getAdminFirestore();
  const snap = await db
    .collection(COLLECTIONS.studentSessions)
    .where('classResearchId', '==', classId)
    .get();
  const now = new Date().toISOString();
  const targets = snap.docs.filter((d) => !d.data().revokedAt);
  for (let i = 0; i < targets.length; i += 400) {
    const batch = db.batch();
    for (const d of targets.slice(i, i + 400)) batch.set(d.ref, { revokedAt: now }, { merge: true });
    await batch.commit();
  }
  return targets.length;
}

/**
 * 수업 종료: 학생 입장을 닫고 차시 기록 전체를 닫는다(열었던 차시 목록은 남는다).
 * revokeSessions면 이미 들어온 학생 세션도 끊는다. 제출·점수 자료는 지우지 않는다.
 */
export async function endClassAction(
  classId: string,
  options: { revokeSessions: boolean }
): Promise<AdminResult<{ revoked: number }>> {
  return run(async () => {
    await requireAdmin();
    const { id, ref } = await requireClassDoc(classId);
    await ref.update({ active: false, updatedAt: new Date().toISOString() });
    const { session, durable } = await getLessonStore().closeLessonSession({
      classResearchId: id,
      closedBy: ADMIN_ACTOR,
      reason: '관리 화면: 수업 종료',
    });
    if (session && !durable) {
      throw new AdminInputError('입장은 닫았지만 차시 기록을 닫지 못했습니다. 다시 해 주세요.');
    }
    const revoked = options?.revokeSessions ? await revokeClassSessions(id) : 0;
    await recordAdminEvent('end_class', id, { revoked });
    return { revoked };
  });
}

/* ────────────────────────── 교사 계정 ────────────────────────── */

async function requireTeacherDoc(uid: string) {
  const id = assertSafeDocId(String(uid ?? ''), '계정');
  const ref = getAdminFirestore().collection(COLLECTIONS.users).doc(id);
  const snap = await ref.get();
  // 이 화면은 교사 계정만 다룬다. 연구자·관리 계정은 여기서 바꾸지 않는다.
  if (!snap.exists || snap.data()?.role !== 'teacher') {
    throw new AdminInputError('교사 계정이 아닙니다.');
  }
  return { id, ref };
}

/** 교사 계정을 만든다. 비밀번호는 Firebase Authentication이 보관하고 여기엔 남기지 않는다. */
export async function createTeacherAction(input: {
  email: string;
  displayName: string;
  password: string;
  classIds: string[];
}): Promise<AdminResult<{ uid: string }>> {
  return run(async () => {
    await requireAdmin();
    const email = normalizeEmail(input.email);
    if (!email) throw new AdminInputError('계정(이메일)을 확인해 주세요.');
    const problem = passwordProblem(input.password, 'teacher');
    if (problem) throw new AdminInputError(problem);
    const displayName = normalizeDisplayName(input.displayName);
    const classResearchIds = sanitizeClassAssignments(input.classIds, await listClassIds());

    const adminAuth = getAdminAuth();
    const user = await adminAuth.createUser({
      email,
      password: input.password,
      displayName: displayName ?? undefined,
      disabled: false,
    });
    const now = new Date().toISOString();
    try {
      await getAdminFirestore().collection(COLLECTIONS.users).doc(user.uid).set({
        role: 'teacher',
        email,
        displayName,
        classResearchIds,
        classCodes: [],
        grantedScopes: [],
        disabled: false,
        createdBy: ADMIN_ACTOR,
        createdAt: now,
        updatedAt: now,
      });
    } catch (err) {
      // 역할 문서 없이 로그인만 되는 계정을 남기지 않는다.
      await adminAuth.deleteUser(user.uid).catch(() => undefined);
      throw err;
    }
    await recordAdminEvent('create_teacher', user.uid, { classResearchIds });
    return { uid: user.uid };
  });
}

export async function setTeacherClassesAction(
  uid: string,
  classIds: string[]
): Promise<AdminResult> {
  return run(async () => {
    await requireAdmin();
    const { id, ref } = await requireTeacherDoc(uid);
    const classResearchIds = sanitizeClassAssignments(classIds, await listClassIds());
    await ref.update({ classResearchIds, updatedAt: new Date().toISOString() });
    await recordAdminEvent('assign_teacher', id, { classResearchIds });
    return null;
  });
}

/** 교사 비밀번호를 새로 정한다. 그 교사의 기존 로그인은 모두 끊긴다. */
export async function resetTeacherPasswordAction(
  uid: string,
  password: string
): Promise<AdminResult> {
  return run(async () => {
    await requireAdmin();
    const { id } = await requireTeacherDoc(uid);
    const problem = passwordProblem(password, 'teacher');
    if (problem) throw new AdminInputError(problem);
    const adminAuth = getAdminAuth();
    await adminAuth.updateUser(id, { password });
    // 교사 세션 쿠키는 checkRevoked로 검증하므로 여기서 끊으면 바로 로그아웃된다.
    await adminAuth.revokeRefreshTokens(id);
    await recordAdminEvent('reset_teacher_password', id, null);
    return null;
  });
}

export async function setTeacherDisabledAction(
  uid: string,
  disabled: boolean
): Promise<AdminResult> {
  return run(async () => {
    await requireAdmin();
    const { id, ref } = await requireTeacherDoc(uid);
    const adminAuth = getAdminAuth();
    await adminAuth.updateUser(id, { disabled: disabled === true });
    await ref.update({ disabled: disabled === true, updatedAt: new Date().toISOString() });
    if (disabled) await adminAuth.revokeRefreshTokens(id);
    await recordAdminEvent(disabled ? 'disable_teacher' : 'enable_teacher', id, null);
    return null;
  });
}
