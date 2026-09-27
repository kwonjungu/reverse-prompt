'use server';

/**
 * 학급 자료 조회·삭제의 서버 액션.
 *
 * 교사 화면이 학급코드만으로 클라이언트에서 Firestore를 직접 조회·삭제하던 구조를
 * 서버 API 경유 + 소속 권한 검사로 바꾼다. 학급 목록도 클라이언트가 만들지 않고
 * 서버가 교사 계정에 배정된 것만 돌려준다(수업ID는 비밀번호가 아니다).
 *
 * 연구자에게는 비식별 읽기만 주고 삭제 권한은 분리한다.
 * 교사별 독립 점수는 수정 협의 전 상태로 보존하고, 역할에 따라 다른 교사의 점수를 숨긴다.
 * 교사 블라인드 데이터에는 시점(pre/post)과 AI 점수가 없다.
 *
 * 'use server' 파일이므로 이 파일의 모든 export는 async 함수여야 한다.
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §5, §6, 수용시험 10·11
 */

import { auth } from '@/server/auth';
import { AuthError } from '@/server/auth/contract';
import { evaluateAccess } from '@/server/auth/access';
import { stripIdentifiers, toResearcherView, toTeacherBlindRecord } from '@/server/auth/deidentify';
import {
  COLLECTIONS,
  RESEARCH_COLLECTIONS,
  assertSafeDocId,
  getAdminFirestore,
  researchPath,
} from '@/server/firebase-admin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { experienceSubmissionsPath, getLessonStore } from '@/server/lessons/store';
import {
  scoringViewOf,
  stripLegacyScores,
  summarizeClassProgress,
  toProgressSession,
  toProgressSubmission,
  toResearchRecordRow,
  type ClassProgress,
  type ProgressSubmission,
  type ResearchRecordRow,
  type ScoringView,
} from '@/server/lms/progress';
import type { SessionType } from '@/lib/research/types';

/** 로그인한 운영 계정의 역할과 배정된 학급. 학교 실명 대응표는 담지 않는다. */
export async function loadStaffContext(): Promise<{
  role: string;
  classCodes: string[];
  classResearchIds: string[];
  /** 배정된 반의 표시 이름(관리 화면에서 정한 값). 없으면 비어 있다. */
  classLabels: Record<string, string>;
}> {
  const principal = await auth.requireRole('teacher', 'researcher');
  const db = getAdminFirestore();
  const snap = await db.collection(COLLECTIONS.users).doc(principal.uid).get();
  const data = snap.exists ? snap.data() ?? {} : {};

  // 배정된 반의 이름만 읽는다. 다른 반의 이름은 읽지 않는다.
  const classLabels: Record<string, string> = {};
  const refs = principal.classResearchIds
    .filter((id) => {
      try {
        assertSafeDocId(id, '학급');
        return true;
      } catch {
        return false;
      }
    })
    .map((id) => db.collection(COLLECTIONS.researchClasses).doc(id));
  if (refs.length) {
    const docs = await db.getAll(...refs);
    for (const d of docs) {
      const label = d.exists ? d.data()?.label : null;
      if (typeof label === 'string' && label) classLabels[d.id] = label;
    }
  }

  return {
    role: principal.role,
    // 연구자는 수업 기록(비연구 저장소)에 접근하지 않는다.
    classCodes:
      principal.role === 'teacher' && Array.isArray(data.classCodes)
        ? (data.classCodes as string[])
        : [],
    classResearchIds: principal.classResearchIds,
    classLabels,
  };
}

async function requireLessonClass(classCode: string) {
  const principal = await auth.requireRole('teacher');
  const db = getAdminFirestore();
  const snap = await db.collection(COLLECTIONS.users).doc(principal.uid).get();
  const data = snap.exists ? snap.data() ?? {} : {};
  const decision = evaluateAccess(
    {
      uid: principal.uid,
      role: 'teacher',
      classCodes: Array.isArray(data.classCodes) ? (data.classCodes as string[]) : [],
      classResearchIds: principal.classResearchIds,
      grantedScopes: Array.isArray(data.grantedScopes) ? (data.grantedScopes as string[]) : [],
    },
    { scope: 'lesson', classCode },
    'read_identifiable'
  );
  if (!decision.allowed) {
    throw new AuthError(`학급 접근이 거부되었습니다(${decision.reason}).`, 'forbidden');
  }
  return principal;
}

/**
 * 비연구 수업 기록 조회. 소속 교사만, 자기 학급만.
 * 연습 기록에는 화면이 쓸 채점 결과(scoringView)를 덧붙인다. 이 모음(practice_attempts)은
 * 옛 방식 기록이라 대개 '옛 채점'(100점)이고, 공통 루브릭 v12-2 결과가 있으면 영역 수준으로 읽는다.
 */
export async function loadLessonRecords(classCode: string): Promise<{
  practiceAttempts: (Record<string, unknown> & { scoringView: ScoringView })[];
  submissions: Record<string, unknown>[];
}> {
  await requireLessonClass(classCode);
  const db = getAdminFirestore();
  const base = db.collection(COLLECTIONS.classes).doc(assertSafeDocId(classCode, '학급'));
  const [practiceSnap, submissionSnap] = await Promise.all([
    base.collection('practice_attempts').orderBy('createdAt', 'asc').get(),
    base.collection('submissions').orderBy('createdAt', 'desc').get(),
  ]);
  const toPlain = (d: QueryDocumentSnapshot) => {
    const raw = d.data();
    const createdAt =
      raw.createdAt && typeof raw.createdAt.toDate === 'function'
        ? raw.createdAt.toDate().toISOString()
        : typeof raw.createdAt === 'string'
          ? raw.createdAt
          : null;
    return { ...raw, createdAt, id: d.id } as Record<string, unknown>;
  };
  return {
    practiceAttempts: practiceSnap.docs.map((d) => {
      const plain = toPlain(d);
      // 분류는 원본으로 하고, 화면에는 점수를 뺀 문서만 보낸다.
      return { ...stripLegacyScores(plain), scoringView: scoringViewOf(plain) };
    }),
    submissions: submissionSnap.docs.map((d) => stripLegacyScores(toPlain(d))),
  };
}

/** 수업 기록 1건 삭제. 교사만, 자기 학급만. 연구 저장소에는 쓰지 않는다. */
export async function deleteLessonRecord(
  classCode: string,
  collectionName: string,
  docId: string
): Promise<{ deleted: boolean }> {
  await requireLessonClass(classCode);
  if (collectionName !== 'practice_attempts' && collectionName !== 'submissions') {
    throw new AuthError('허용되지 않은 대상입니다.', 'forbidden');
  }
  // 클라이언트가 보낸 값을 문서 ID로 쓰기 전에 반드시 확인한다(경로 주입 방지).
  await getAdminFirestore()
    .collection(COLLECTIONS.classes)
    .doc(assertSafeDocId(classCode, '학급'))
    .collection(collectionName)
    .doc(assertSafeDocId(docId, '기록'))
    .delete();
  return { deleted: true };
}

/**
 * 연구 저장소의 비식별 읽기.
 * 학교 실명 대응표·출석번호·학교명은 여기서 걸러 낸다.
 *
 * 연구자는 비식별 문서 전체(공통 루브릭 v12-2 영역별 수준·근거·피드백 포함)를 본다.
 * 교사는 학생 현황과 같은 규칙으로 AI 채점 결과·피드백·제출 시각을 보지 않는다
 * (교사 블라인드 채점 보호, toTeacherBlindRecord). 진행 수를 셀 연구ID·문항·제출 상태만 남는다.
 */
export async function loadResearchRecords(classResearchId: string): Promise<{
  records: Record<string, unknown>[];
  /** 화면 표용 요약 줄. 교사(blind)면 채점 결과가 비어 있다. */
  rows: ResearchRecordRow[];
  /** AI 채점 결과를 가렸는가(교사) */
  blind: boolean;
  notice: string;
}> {
  // 읽기 전용 화면이므로 행위를 명시한다. 연구자의 비식별 읽기는 여기서 허용된다(감사 A-4).
  const principal = await auth.requireClassAccess(
    classResearchId,
    { action: 'read' },
    'teacher',
    'researcher'
  );
  const blind = principal.role !== 'researcher';
  const snap = await getAdminFirestore()
    .collection(researchPath(RESEARCH_COLLECTIONS.practiceSubmissions))
    .where('classResearchId', '==', classResearchId)
    .get();
  const docs = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Record<string, unknown>);
  return {
    records: docs.map((r) => (blind ? toTeacherBlindRecord(r) : toResearcherView(r))),
    rows: docs.map((r) => toResearchRecordRow(stripIdentifiers(r), { blind })),
    blind,
    notice: blind
      ? '연구ID 자료입니다. 학교명·출석번호·실명 대응표는 포함하지 않습니다. 교사 블라인드 채점을 흐리지 않도록 AI 채점 결과·피드백·제출 시각은 보여 주지 않습니다.'
      : '연구ID 자료입니다. 학교명·출석번호·실명 대응표는 포함하지 않습니다.',
  };
}

/**
 * 교사 블라인드 채점용 자료.
 * 시점(pre/post)과 AI 점수가 없어야 하고, 다른 교사의 점수도 보이지 않아야 한다.
 */
export async function loadTeacherBlindRecords(classResearchId: string): Promise<{
  records: Record<string, unknown>[];
  myScores: Record<string, unknown>[];
}> {
  const principal = await auth.requireClassAccess(
    classResearchId,
    { action: 'read' },
    'teacher'
  );
  const db = getAdminFirestore();
  const [submissions, scores] = await Promise.all([
    db
      .collection(researchPath(RESEARCH_COLLECTIONS.practiceSubmissions))
      .where('classResearchId', '==', classResearchId)
      .get(),
    db
      .collection(researchPath(RESEARCH_COLLECTIONS.teacherBlindScores))
      .where('classResearchId', '==', classResearchId)
      .where('raterUid', '==', principal.uid)
      .get(),
  ]);
  return {
    records: submissions.docs.map((d) => toTeacherBlindRecord({ ...d.data(), id: d.id })),
    // 다른 교사의 점수는 내려보내지 않는다. 수정 협의 전 독립 점수를 보존하기 위함이다.
    myScores: scores.docs.map((d) => ({ ...d.data(), id: d.id }) as Record<string, unknown>),
  };
}

/**
 * 연구 자료 파기 요청 기록.
 * 코드가 임의로 '전체 데이터 즉시 삭제'를 수행하지 않는다.
 * 승인된 절차의 진행 상황을 사람이 별도로 기록하도록 요청만 남긴다.
 */
export async function requestResearchDataDisposition(
  classResearchId: string,
  researchId: string,
  reason: string
): Promise<{ recorded: boolean }> {
  const principal = await auth.requireClassAccess(
    classResearchId,
    { action: 'write' },
    'teacher'
  );
  await getAdminFirestore().collection(COLLECTIONS.consentEvents).add({
    researchId,
    classResearchId,
    event: 'disposition_requested',
    actorUid: principal.uid,
    reason,
    recordedAt: new Date().toISOString(),
    dataDisposition: 'pending_approved_procedure',
  });
  return { recorded: true };
}

/* ────────────────────────── 학생 현황(LMS) ────────────────────────── */

export interface ClassProgressView extends ClassProgress {
  classResearchId: string;
  label: string | null;
  sessionType: SessionType;
  /** 학생이 새로 들어올 수 있는가 */
  active: boolean;
  /** 서버에 저장된 차시 상태. 방금 누른 결과가 아니라 지금 기록을 다시 읽은 값이다. */
  lesson: {
    allowedLessons: number[];
    currentLesson: number | null;
    closedAt: string | null;
    teacherPaced: boolean;
  } | null;
  /** 제출 기록을 찾을 학급 키가 없는 옛 반이면 안내 문구 */
  notice: string | null;
  /** 전송 전 개인정보 점검으로 멈춘 제출 수(건수만. 글·학생은 남기지 않는다). 셀 수 없으면 null */
  privacyHoldCount: number | null;
  loadedAt: string;
}

/**
 * 담당 교사가 보는 반의 학생 진행.
 *
 * 배정된 반만 연다(requireClassAccess). 일반 수업은 번호별 영역 수준(공통 루브릭 v12-2)·
 * 종합 수준·최근 답안까지 보여 주고(옛 v7 기록은 '옛 채점'으로 따로),
 * 연구 수업은 블라인드 채점을 위해 채점 결과·답안·시각을 빼고 진행 수만 보여 준다.
 * 학생 입장 세션 문서는 번호를 잇는 데만 쓰고 그대로 내보내지 않는다.
 */
export async function loadClassProgress(classResearchId: string): Promise<ClassProgressView> {
  await auth.requireClassAccess(classResearchId, { action: 'read' }, 'teacher');
  const db = getAdminFirestore();
  const id = assertSafeDocId(classResearchId, '학급');
  const classSnap = await db.collection(COLLECTIONS.researchClasses).doc(id).get();
  if (!classSnap.exists) throw new AuthError('등록된 수업이 아닙니다.', 'forbidden');
  const classData = classSnap.data() ?? {};
  const sessionType: SessionType =
    classData.sessionType === 'research_practice' || classData.sessionType === 'research_assessment'
      ? classData.sessionType
      : 'experience';
  const classCode =
    typeof classData.classCode === 'string' && classData.classCode ? classData.classCode : null;

  const submissionsQuery =
    sessionType === 'experience'
      ? classCode
        ? db.collection(experienceSubmissionsPath(classCode)).get()
        : null
      : db
          .collection(researchPath(RESEARCH_COLLECTIONS.practiceSubmissions))
          .where('classResearchId', '==', id)
          .get();

  // 보류 기록의 학급 키는 제출과 같다(연구: 학급 연구ID, 일반: 학급 코드).
  const holdKey = sessionType === 'experience' ? classCode : id;
  const [lesson, sessionsSnap, submissionsSnap, holds] = await Promise.all([
    getLessonStore().readLessonSession(id),
    db.collection(COLLECTIONS.studentSessions).where('classResearchId', '==', id).get(),
    submissionsQuery,
    holdKey ? getLessonStore().listPrivacyHolds(sessionType, holdKey).catch(() => null) : Promise.resolve(null),
  ]);

  const submissions = (submissionsSnap?.docs ?? [])
    .map((d) => toProgressSubmission(d.data()))
    .filter((v): v is ProgressSubmission => v !== null);
  const sessions = sessionsSnap.docs.map((d) => toProgressSession(d.id, d.data()));
  const now = new Date().toISOString();

  return {
    ...summarizeClassProgress({ sessionType, submissions, sessions, now }),
    classResearchId: id,
    label: typeof classData.label === 'string' && classData.label ? classData.label : null,
    sessionType,
    active: classData.active === true,
    lesson: lesson
      ? {
          allowedLessons: [...(lesson.allowedLessons ?? [])].sort((a, b) => a - b),
          currentLesson: lesson.currentLesson ?? null,
          closedAt: lesson.closedAt ?? null,
          teacherPaced: lesson.pacing === 'teacher',
        }
      : null,
    notice:
      sessionType === 'experience' && !classCode
        ? '이 반은 관리 화면에서 만든 반이 아니라 제출 기록 위치를 알 수 없습니다. 입장 현황만 보입니다.'
        : null,
    privacyHoldCount: holds ? holds.length : null,
    loadedAt: now,
  };
}
