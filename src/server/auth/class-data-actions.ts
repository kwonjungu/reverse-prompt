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
import { toResearcherView, toTeacherBlindRecord } from '@/server/auth/deidentify';
import {
  COLLECTIONS,
  RESEARCH_COLLECTIONS,
  assertSafeDocId,
  getAdminFirestore,
  researchPath,
} from '@/server/firebase-admin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

/** 로그인한 운영 계정의 역할과 배정된 학급. 학교 실명 대응표는 담지 않는다. */
export async function loadStaffContext(): Promise<{
  role: string;
  classCodes: string[];
  classResearchIds: string[];
}> {
  const principal = await auth.requireRole('teacher', 'researcher');
  const db = getAdminFirestore();
  const snap = await db.collection(COLLECTIONS.users).doc(principal.uid).get();
  const data = snap.exists ? snap.data() ?? {} : {};
  return {
    role: principal.role,
    // 연구자는 수업 기록(비연구 저장소)에 접근하지 않는다.
    classCodes:
      principal.role === 'teacher' && Array.isArray(data.classCodes)
        ? (data.classCodes as string[])
        : [],
    classResearchIds: principal.classResearchIds,
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

/** 비연구 수업 기록 조회. 소속 교사만, 자기 학급만. */
export async function loadLessonRecords(classCode: string): Promise<{
  practiceAttempts: Record<string, unknown>[];
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
    practiceAttempts: practiceSnap.docs.map(toPlain),
    submissions: submissionSnap.docs.map(toPlain),
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
 */
export async function loadResearchRecords(classResearchId: string): Promise<{
  records: Record<string, unknown>[];
  notice: string;
}> {
  // 읽기 전용 화면이므로 행위를 명시한다. 연구자의 비식별 읽기는 여기서 허용된다(감사 A-4).
  await auth.requireClassAccess(classResearchId, { action: 'read' }, 'teacher', 'researcher');
  const snap = await getAdminFirestore()
    .collection(researchPath(RESEARCH_COLLECTIONS.practiceSubmissions))
    .where('classResearchId', '==', classResearchId)
    .get();
  return {
    records: snap.docs.map((d) => toResearcherView({ ...d.data(), id: d.id })),
    notice: '연구ID 자료입니다. 학교명·출석번호·실명 대응표는 포함하지 않습니다.',
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
