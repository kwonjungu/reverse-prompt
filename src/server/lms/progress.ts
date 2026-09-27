/**
 * 교사 학생 현황(LMS)의 집계 — 저장소를 읽지 않는 순수 함수.
 *
 * 배선(권한 확인·Firestore 조회)은 src/server/auth/class-data-actions.ts의
 * loadClassProgress가 맡고, 여기서는 읽어 온 문서를 학생별 줄로 묶기만 한다.
 * tests/lms.test.ts가 그대로 불러 쓴다.
 *
 * 보여 주는 범위
 *   - 일반 수업(experience): 번호별로 단계 진행·제출 수·영역별 수준·최근 답안을 보여 준다.
 *     비연구 수업 기록이며 담당 교사만 본다.
 *   - 연구 수업: 교사 블라인드 채점을 흐리지 않도록 AI 채점 결과와 답안·시각을 보여 주지 않는다
 *     (deidentify.ts의 TEACHER_BLIND_HIDDEN_FIELDS와 같은 취지). 연구ID별 진행 수만 센다.
 *   - 채점 결과는 공통 루브릭 v12-2(3영역 4수준)다. 100점 점수는 쓰지 않는다.
 *     평균·최근은 종합 수준(해당 영역 평균을 반올림한 1~4, src/lib/scoring.ts의 overallLevelOf)이다.
 *   - 옛 v7 기록(축별 5수준·100점)은 legacyScore로만 남긴다. 화면에는 '옛 채점'으로 보이고
 *     v12-2 평균·최근 수준에 섞지 않는다. 옛 기록에서 영역 수준을 지어내지 않는다.
 *   - 결측은 1수준도 0점도 아니라 null이다. 평균에 넣지 않는다.
 *   - 제출 수는 진행 정보일 뿐 단계 개방 조건이 아니다.
 */

import type { SessionType } from '@/lib/research/types';
import { overallLevelOf, type AreaLevel, type AreaLevels } from '@/lib/scoring';
import { chasiOfLevel } from '@/lib/stages';
import { isLegacyPracticeRecord, storedAreaLevels } from '@/server/lessons/store-core';

/* ────────────────────────── 저장된 채점 결과 읽기 ────────────────────────── */

/**
 * 저장된 제출 문서 한 건의 채점 결과를 화면에 보일 모양으로 줄인 것.
 *   areas   공통 루브릭 v12-2로 채점됨. 영역별 수준(해당 없음 포함)과 종합 수준.
 *   legacy  옛 v7(또는 그 이전) 방식 기록. 100점 점수는 화면·내보내기에 싣지 않으므로 읽지 않는다(논문 v12-2 B1).
 *   missing v12-2 기록인데 채점하지 못했다(결측) 또는 채점 결과가 없다.
 */
export type ScoringView =
  | { kind: 'areas'; levels: AreaLevels; overallLevel: AreaLevel | null }
  | { kind: 'legacy' }
  | { kind: 'missing' };

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 옛 기록의 100점 점수·축 점수를 화면으로 보내지 않는다(논문 v12-2 B1 — 합계·100점이 어디에도 남지 않게).
 * 저장된 문서는 그대로 두고 응답에서만 뺀다. 채점 결과 분류(scoringViewOf)는 이 필드 없이도 옛 기록으로 읽는다.
 */
export function stripLegacyScores(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...doc };
  for (const key of ['score', 'totalScore', 'axisScores']) delete out[key];
  const scoring = out.scoring;
  if (scoring && typeof scoring === 'object' && !Array.isArray(scoring)) {
    const sc = { ...(scoring as Record<string, unknown>) };
    const result = sc.result;
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const r = { ...(result as Record<string, unknown>) };
      delete r.score;
      delete r.axisScores;
      sc.result = r;
    }
    out.scoring = sc;
  }
  return out;
}

/**
 * 제출 문서에서 채점 결과를 읽는다.
 *
 *   - scoring 필드가 있으면 옛 기록 여부를 store-core의 isLegacyPracticeRecord로 가른다
 *     (result에 areas가 없고 levels·score가 있거나, rubricVersion이 v12로 시작하지 않음).
 *   - scoring 필드 없이 맨 위에 score만 있는 문서(classes/{code}/practice_attempts의 옛 연습 기록)는 옛 기록이다.
 *   - v12-2 결과는 세 영역 모두 형식이 맞을 때만 수준으로 읽는다. 하나라도 어긋나면 결측으로 본다
 *     (보정하거나 빈 영역을 1수준·해당 없음으로 채우지 않는다).
 */
export function scoringViewOf(raw: Record<string, unknown>): ScoringView {
  const scoring = isObject(raw.scoring) ? raw.scoring : null;
  if (!scoring) {
    if ('score' in raw) return { kind: 'legacy' };
    return { kind: 'missing' };
  }
  const result = isObject(scoring.result) ? scoring.result : null;
  if (isLegacyPracticeRecord(raw)) {
    return { kind: 'legacy' };
  }
  const levels = storedAreaLevels(result);
  if (!levels) return { kind: 'missing' };
  return { kind: 'areas', levels, overallLevel: overallLevelOf(levels) };
}

/**
 * 제출의 단계. 연습 문항(L01~L36)이면 문항 번호로 지금 단계 배치(src/lib/stages.ts)에서 다시 정한다.
 * 옛 기록의 lesson은 옛 차시 배치(3·4단계 문항이 지금과 뒤바뀜)라 그대로 세면 단계 열이 섞이기 때문이다.
 * 연습 문항이 아니면 저장된 lesson을 그대로 쓴다.
 */
export function stageOfSubmission(questionId: string, storedLesson: number | null): number | null {
  const m = /^L(\d{2})$/.exec(questionId);
  if (m) {
    const stage = chasiOfLevel(Number(m[1]));
    if (stage !== null) return stage;
  }
  return storedLesson;
}

/* ────────────────────────── 집계 입력 ────────────────────────── */

export interface ProgressSubmission {
  ownerKey: string | null;
  researchId: string | null;
  questionId: string;
  /** 단계(1~6). stageOfSubmission으로 정한 값 */
  lesson: number | null;
  attemptNo: number | null;
  text: string | null;
  submittedAt: string | null;
  /** v12-2로 채점된 영역별 수준. 결측·옛 기록이면 null */
  levels: AreaLevels | null;
  /** v12-2 종합 수준(1~4). levels가 null이면 null */
  overallLevel: AreaLevel | null;
  /** 옛 v7 기록인가. 옛 기록은 v12-2 평균·최근 수준에 넣지 않고 점수도 싣지 않는다. */
  legacy: boolean;
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
  /** v12-2 영역별 수준. 결측·옛 기록이면 null */
  levels: AreaLevels | null;
  overallLevel: AreaLevel | null;
  /** 옛 v7 기록. 화면에는 '옛 채점 기록'으로만 보이고 점수는 없다. */
  legacy: boolean;
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
  /** 단계 → 한 번 이상 제출한 서로 다른 문항 수 */
  attemptedByLesson: Record<number, number>;
  questionsAttempted: number;
  submissions: number;
  reviewedCount: number;
  /** 가장 최근 v12-2 채점 제출의 종합 수준(1~4). 연구 수업이면 항상 null. */
  latestLevel: AreaLevel | null;
  /** 그 제출의 영역별 수준. 연구 수업이면 항상 null. */
  latestLevels: AreaLevels | null;
  /**
   * 문항마다 마지막으로 v12-2 채점된 종합 수준의 평균(소수 한 자리, 정수로 반올림하지 않는다).
   * 결측·옛 기록은 넣지 않는다. 연구 수업이면 null.
   */
  averageLevel: number | null;
  /** 옛 채점(v7) 기록 수. 평균에 넣지 않았다는 것을 알리려고 센다. 연구 수업이면 0. */
  legacySubmissions: number;
  /** 최근 제출(새것부터). 연구 수업이면 비어 있다. */
  recent: RecentAttempt[];
}

export interface ClassProgress {
  /** 채점 결과·답안을 보여 주는가. 연구 수업이면 false. */
  detailVisible: boolean;
  totals: {
    students: number;
    online: number;
    submissions: number;
    /** 학생·문항마다 마지막 v12-2 종합 수준의 평균(소수 한 자리). 연구 수업이면 null. */
    averageLevel: number | null;
    /** 옛 채점 기록 수(평균에 넣지 않음). 연구 수업이면 0. */
    legacySubmissions: number;
  };
  students: StudentProgressRow[];
}

export const RECENT_ATTEMPTS_PER_STUDENT = 12;

/** Firestore에서 읽은 제출 문서를 집계용으로 줄인다. 제출되지 않았거나 저장에 실패한 것은 뺀다. */
export function toProgressSubmission(raw: Record<string, unknown>): ProgressSubmission | null {
  if (raw.responseStatus !== undefined && raw.responseStatus !== 'submitted') return null;
  if (raw.persistStatus === 'failed') return null;
  const questionId = str(raw.questionId);
  if (!questionId) return null;
  const view = scoringViewOf(raw);
  return {
    ownerKey: str(raw.ownerKey),
    researchId: str(raw.researchId),
    questionId,
    lesson: stageOfSubmission(questionId, num(raw.lesson)),
    attemptNo: num(raw.attemptNo),
    text: str(raw.text),
    submittedAt: str(raw.submittedAt) ?? str(raw.createdAt),
    levels: view.kind === 'areas' ? view.levels : null,
    overallLevel: view.kind === 'areas' ? view.overallLevel : null,
    legacy: view.kind === 'legacy',
    reviewed: raw.feedbackReview !== null && raw.feedbackReview !== undefined,
  };
}

/* ────────────────────────── 연구 자료 탭의 한 줄 ────────────────────────── */

/**
 * 교사 화면 '연구 자료' 탭이 표로 보여 줄 한 줄. 비식별 연구 제출 문서에서 만든다.
 * blind(교사)면 AI 채점 결과·피드백 상태를 담지 않는다(교사 블라인드 채점 보호).
 * 학생 글·시각은 이 줄에 담지 않는다. 원문은 연구자에게만 비식별 문서로 따로 간다.
 */
export interface ResearchRecordRow {
  id: string;
  researchId: string | null;
  questionId: string | null;
  /** 단계(1~6). stageOfSubmission으로 정한 값 */
  stage: number | null;
  attemptNo: number | null;
  responseStatus: string | null;
  rubricVersion: string | null;
  /** 옛 v7 기록인가(영역 수준이 없다). 채점 결과가 아니라 기준 버전 정보라 교사에게도 보인다. */
  legacy: boolean;
  /** 채점 결과. blind면 null. */
  scoring: ScoringView | null;
  /** 피드백 상태(verified·fallback·not_requested). blind면 null. */
  feedbackStatus: string | null;
}

export function toResearchRecordRow(
  raw: Record<string, unknown>,
  options: { blind: boolean }
): ResearchRecordRow {
  const questionId = str(raw.questionId);
  const scoring = isObject(raw.scoring) ? raw.scoring : null;
  const feedback = scoring && isObject(scoring.feedback) ? scoring.feedback : null;
  return {
    id: str(raw.id) ?? '',
    researchId: str(raw.researchId),
    questionId,
    stage: questionId ? stageOfSubmission(questionId, num(raw.lesson)) : num(raw.lesson),
    attemptNo: num(raw.attemptNo),
    responseStatus: str(raw.responseStatus),
    rubricVersion: str(raw.rubricVersion),
    legacy: isLegacyPracticeRecord(raw),
    scoring: options.blind ? null : scoringViewOf(raw),
    feedbackStatus: options.blind ? null : str(feedback?.status),
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

/** 평균을 소수 한 자리로 낸다. 정수 수준으로 반올림하지 않는다. 값이 없으면 null. */
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

  const allLatestLevels: number[] = [];
  let allLegacy = 0;
  const students: StudentProgressRow[] = [...buckets.values()].map((b) => {
    const sorted = [...b.items].sort((x, y) => (y.submittedAt ?? '').localeCompare(x.submittedAt ?? ''));
    const byLesson = new Map<number, Set<string>>();
    const latestLevelByQuestion = new Map<string, number>();
    for (const item of sorted) {
      if (item.lesson !== null) {
        if (!byLesson.has(item.lesson)) byLesson.set(item.lesson, new Set());
        byLesson.get(item.lesson)!.add(item.questionId);
      }
      // sorted가 새것부터이므로 처음 만난 v12-2 종합 수준이 그 문항의 마지막 수준이다.
      // 옛 채점·결측은 건너뛴다(평균에 넣지 않는다).
      if (item.overallLevel !== null && !latestLevelByQuestion.has(item.questionId)) {
        latestLevelByQuestion.set(item.questionId, item.overallLevel);
      }
    }
    const latestScored = sorted.find((i) => i.overallLevel !== null) ?? null;
    const questionLevels = [...latestLevelByQuestion.values()];
    const legacySubmissions = sorted.filter((i) => i.legacy).length;
    if (!research) {
      allLatestLevels.push(...questionLevels);
      allLegacy += legacySubmissions;
    }

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
      latestLevel: research ? null : latestScored?.overallLevel ?? null,
      latestLevels: research ? null : latestScored?.levels ?? null,
      averageLevel: research ? null : average(questionLevels),
      legacySubmissions: research ? 0 : legacySubmissions,
      recent: research
        ? []
        : sorted.slice(0, RECENT_ATTEMPTS_PER_STUDENT).map((i) => ({
            questionId: i.questionId,
            lesson: i.lesson,
            attemptNo: i.attemptNo,
            levels: i.levels,
            overallLevel: i.overallLevel,
            legacy: i.legacy,
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
      averageLevel: research ? null : average(allLatestLevels),
      legacySubmissions: research ? 0 : allLegacy,
    },
    students,
  };
}
