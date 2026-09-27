/**
 * 교사 학생 현황(LMS)의 집계 — 저장소를 읽지 않는 순수 함수.
 *
 * 배선(권한 확인·Firestore 조회)은 src/server/auth/class-data-actions.ts의
 * loadClassProgress가 맡고, 여기서는 읽어 온 문서를 학생별 줄로 묶기만 한다.
 * tests/lms.test.ts가 그대로 불러 쓴다.
 *
 * 보여 주는 범위
 *   - 일반 수업(experience): 번호별로 차시 진행·제출 수·점수·최근 답안을 보여 준다.
 *     비연구 수업 기록이며 담당 교사만 본다.
 *   - 연구 수업: 교사 블라인드 채점을 흐리지 않도록 AI 점수와 답안·시각을 보여 주지 않는다
 *     (deidentify.ts의 TEACHER_BLIND_HIDDEN_FIELDS와 같은 취지). 연구ID별 진행 수만 센다.
 *   - 결측 점수는 0점이 아니라 null이다. 평균에 넣지 않는다.
 *   - 제출 수는 진행 정보일 뿐 차시 개방 조건이 아니다.
 */

import type { SessionType } from '@/lib/research/types';

export interface ProgressSubmission {
  ownerKey: string | null;
  researchId: string | null;
  questionId: string;
  lesson: number | null;
  attemptNo: number | null;
  text: string | null;
  submittedAt: string | null;
  /** 채점이 끝났으면 점수, 결측이면 null */
  score: number | null;
  reviewed: boolean;
}

export interface ProgressSession {
  sid: string;
  studentNumber: number | null;
  researchId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface RecentAttempt {
  questionId: string;
  lesson: number | null;
  attemptNo: number | null;
  score: number | null;
  text: string;
  submittedAt: string | null;
  reviewed: boolean;
}

export interface StudentProgressRow {
  key: string;
  label: string;
  studentNumber: number | null;
  /** 지금 들어와 있는가(폐기되지 않고 만료 전인 세션이 있다) */
  online: boolean;
  lastActivityAt: string | null;
  /** 차시 → 한 번 이상 제출한 서로 다른 문항 수 */
  attemptedByLesson: Record<number, number>;
  questionsAttempted: number;
  submissions: number;
  reviewedCount: number;
  /** 가장 최근 채점된 제출의 점수. 연구 수업이면 항상 null. */
  latestScore: number | null;
  /** 문항마다 마지막으로 채점된 점수의 평균. 결측은 넣지 않는다. 연구 수업이면 null. */
  averageScore: number | null;
  /** 최근 제출(새것부터). 연구 수업이면 비어 있다. */
  recent: RecentAttempt[];
}

export interface ClassProgress {
  /** 점수·답안을 보여 주는가. 연구 수업이면 false. */
  detailVisible: boolean;
  totals: {
    students: number;
    online: number;
    submissions: number;
    averageScore: number | null;
  };
  students: StudentProgressRow[];
}

export const RECENT_ATTEMPTS_PER_STUDENT = 12;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Firestore에서 읽은 제출 문서를 집계용으로 줄인다. 제출되지 않았거나 저장에 실패한 것은 뺀다. */
export function toProgressSubmission(raw: Record<string, unknown>): ProgressSubmission | null {
  if (raw.responseStatus !== undefined && raw.responseStatus !== 'submitted') return null;
  if (raw.persistStatus === 'failed') return null;
  const questionId = str(raw.questionId);
  if (!questionId) return null;
  const scoring = (raw.scoring ?? null) as { result?: { status?: unknown; score?: unknown } | null } | null;
  const result = scoring?.result ?? null;
  return {
    ownerKey: str(raw.ownerKey),
    researchId: str(raw.researchId),
    questionId,
    lesson: num(raw.lesson),
    attemptNo: num(raw.attemptNo),
    text: str(raw.text),
    submittedAt: str(raw.submittedAt) ?? str(raw.createdAt),
    score: result && result.status === 'scored' ? num(result.score) : null,
    reviewed: raw.feedbackReview !== null && raw.feedbackReview !== undefined,
  };
}

export function toProgressSession(sid: string, raw: Record<string, unknown>): ProgressSession {
  return {
    sid,
    studentNumber: num(raw.studentNumber),
    researchId: str(raw.researchId),
    issuedAt: str(raw.issuedAt),
    expiresAt: str(raw.expiresAt),
    revokedAt: str(raw.revokedAt),
  };
}

function isOnline(session: ProgressSession, nowIso: string): boolean {
  return !session.revokedAt && session.expiresAt !== null && session.expiresAt > nowIso;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

interface Bucket {
  key: string;
  label: string;
  studentNumber: number | null;
  online: boolean;
  lastActivityAt: string | null;
  items: ProgressSubmission[];
}

/**
 * 학생별 진행을 묶는다.
 *  - 일반 수업: 제출의 ownerKey(session:<sid>)를 세션 문서의 번호로 이어 번호별로 묶는다.
 *    다시 들어와 세션이 바뀌어도 같은 번호면 한 줄이다.
 *  - 연구 수업: 연구ID로 묶는다. 번호는 쓰지 않는다.
 */
export function summarizeClassProgress(input: {
  sessionType: SessionType;
  submissions: ProgressSubmission[];
  sessions: ProgressSession[];
  now: string;
}): ClassProgress {
  const research = input.sessionType !== 'experience';
  const bySid = new Map(input.sessions.map((s) => [s.sid, s]));
  const buckets = new Map<string, Bucket>();

  const bucketFor = (key: string, label: string, studentNumber: number | null): Bucket => {
    let b = buckets.get(key);
    if (!b) {
      b = { key, label, studentNumber, online: false, lastActivityAt: null, items: [] };
      buckets.set(key, b);
    }
    return b;
  };

  const keyForSession = (s: ProgressSession): { key: string; label: string; n: number | null } | null => {
    if (research) {
      return s.researchId ? { key: `r:${s.researchId}`, label: s.researchId, n: null } : null;
    }
    if (s.studentNumber !== null) {
      return { key: `n:${s.studentNumber}`, label: `${s.studentNumber}번`, n: s.studentNumber };
    }
    return { key: `s:${s.sid}`, label: `번호 없음 (${s.sid.slice(0, 4)})`, n: null };
  };

  // 제출이 없어도 들어와 있는 학생은 줄로 보인다.
  for (const s of input.sessions) {
    const k = keyForSession(s);
    if (!k) continue;
    const b = bucketFor(k.key, k.label, k.n);
    if (isOnline(s, input.now)) b.online = true;
    b.lastActivityAt = later(b.lastActivityAt, s.issuedAt);
  }

  for (const sub of input.submissions) {
    let k: { key: string; label: string; n: number | null } | null = null;
    if (research) {
      const rid = sub.researchId ?? sub.ownerKey;
      if (rid) k = { key: `r:${rid}`, label: rid, n: null };
    } else if (sub.ownerKey?.startsWith('session:')) {
      const session = bySid.get(sub.ownerKey.slice('session:'.length));
      k = session
        ? keyForSession(session)
        : { key: `o:${sub.ownerKey}`, label: '세션 기록 없음', n: null };
    } else if (sub.ownerKey) {
      k = { key: `o:${sub.ownerKey}`, label: '세션 기록 없음', n: null };
    }
    if (!k) continue;
    const b = bucketFor(k.key, k.label, k.n);
    b.items.push(sub);
    b.lastActivityAt = later(b.lastActivityAt, sub.submittedAt);
  }

  const allLatestScores: number[] = [];
  const students: StudentProgressRow[] = [...buckets.values()].map((b) => {
    const sorted = [...b.items].sort((x, y) => (y.submittedAt ?? '').localeCompare(x.submittedAt ?? ''));
    const byLesson = new Map<number, Set<string>>();
    const latestScoreByQuestion = new Map<string, number>();
    for (const item of sorted) {
      if (item.lesson !== null) {
        if (!byLesson.has(item.lesson)) byLesson.set(item.lesson, new Set());
        byLesson.get(item.lesson)!.add(item.questionId);
      }
      // sorted가 새것부터이므로 처음 만난 채점 점수가 그 문항의 마지막 점수다.
      if (item.score !== null && !latestScoreByQuestion.has(item.questionId)) {
        latestScoreByQuestion.set(item.questionId, item.score);
      }
    }
    const latestScored = sorted.find((i) => i.score !== null) ?? null;
    const questionScores = [...latestScoreByQuestion.values()];
    if (!research) allLatestScores.push(...questionScores);

    return {
      key: b.key,
      label: b.label,
      studentNumber: b.studentNumber,
      online: b.online,
      // 연구 수업은 시각도 블라인드 대상이므로 내보내지 않는다.
      lastActivityAt: research ? null : b.lastActivityAt,
      attemptedByLesson: Object.fromEntries([...byLesson.entries()].map(([l, set]) => [l, set.size])),
      questionsAttempted: new Set(sorted.map((i) => i.questionId)).size,
      submissions: sorted.length,
      reviewedCount: new Set(sorted.filter((i) => i.reviewed).map((i) => i.questionId)).size,
      latestScore: research ? null : latestScored?.score ?? null,
      averageScore: research ? null : average(questionScores),
      recent: research
        ? []
        : sorted.slice(0, RECENT_ATTEMPTS_PER_STUDENT).map((i) => ({
            questionId: i.questionId,
            lesson: i.lesson,
            attemptNo: i.attemptNo,
            score: i.score,
            text: i.text ?? '',
            submittedAt: i.submittedAt,
            reviewed: i.reviewed,
          })),
    };
  });

  students.sort((a, b) => {
    if (a.studentNumber !== null && b.studentNumber !== null) return a.studentNumber - b.studentNumber;
    if (a.studentNumber !== null) return -1;
    if (b.studentNumber !== null) return 1;
    return a.label.localeCompare(b.label);
  });

  return {
    detailVisible: !research,
    totals: {
      students: students.length,
      online: students.filter((s) => s.online).length,
      submissions: students.reduce((a, s) => a + s.submissions, 0),
      averageScore: research ? null : average(allLatestScores),
    },
    students,
  };
}
