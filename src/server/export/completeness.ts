/**
 * 학생ID × 시점 × 문항의 중복·완전성 점검
 *
 * 설계서 §7 "학생ID×시점×문항의 중복·완전 6응답 확인 도구를 제공한다."
 * 설계서 §5 "검증 학생 36명은 학생 단위로 표집하고 각 6응답을 유지한다."
 *
 * 표집 규칙(코드로 강제하는 부분)
 *  - 표집 단위는 응답이 아니라 학생이다. 응답 단위로 무작위로 뽑으면 한 학생의 6응답이
 *    쪼개져 문항 간·시점 간 비교가 깨진다. pickStudentLevelSample은 학생 목록에서만 뽑고
 *    뽑힌 학생의 6응답을 모두 남긴다.
 *  - 생성 결과 대조 표본은 위 검증 표본 안에서 다시 학생 단위로 12명을 뽑는다.
 *    12명 × 6응답 = 72문장이며 문장마다 생성 3개와 각각의 실패 상태를 모두 보존한다.
 *    최고 이미지 한 장을 고르는 기능은 만들지 않는다.
 *
 * 이 모듈은 저장소 구현을 모른다. 필요한 열만 가진 평면 행을 받는다.
 */

/** 연구 검사 시점 */
export type AssessmentPhase = 'pre' | 'post';

export const ASSESSMENT_PHASES: readonly AssessmentPhase[] = ['pre', 'post'];

/** 검사 문항 순서. 레지스트리의 assessmentOrder와 같은 값이어야 한다. */
export const ASSESSMENT_QUESTION_IDS: readonly string[] = ['T1', 'T2_v7', 'T3'];

/** 학생 한 명이 가져야 할 응답 수 = 시점 2 × 문항 3 */
export const RESPONSES_PER_STUDENT =
  ASSESSMENT_PHASES.length * ASSESSMENT_QUESTION_IDS.length;

/** 점검에 필요한 최소한의 열. 실명·출석번호·학교명은 받지 않는다. */
export interface CompletenessRow {
  researchId: string;
  phase: AssessmentPhase;
  questionId: string;
  submissionId: string;
  /** 'submitted' 외의 값은 결측 사유가 있는 칸으로 센다. */
  responseStatus: string;
  missingReason?: string | null;
}

export type CompletenessIssueKind =
  /** 같은 학생·시점·문항에 유효 제출이 둘 이상 저장되었다. 최초 제출 불변 규칙 위반이다. */
  | 'duplicate'
  /** 그 칸의 행이 아예 없다. 수집 자체가 이루어지지 않았다. */
  | 'absent'
  /** 행은 있으나 제출 상태가 아니다. 결측 사유를 확인한다. */
  | 'not_submitted'
  /** 레지스트리에 없는 문항ID가 섞였다. */
  | 'unknown_question';

export interface CompletenessIssue {
  kind: CompletenessIssueKind;
  researchId: string;
  phase: AssessmentPhase | null;
  questionId: string | null;
  /** 중복일 때 관련 제출ID 전체 */
  submissionIds: string[];
  detail: string;
}

export interface StudentCompleteness {
  researchId: string;
  /** 제출 상태로 채워진 칸 수 */
  submittedCount: number;
  /** 행은 있으나 결측인 칸 수 */
  missingCount: number;
  /** 행 자체가 없는 칸 수 */
  absentCount: number;
  /** 6칸이 모두 제출 상태인가 */
  complete: boolean;
}

export interface CompletenessReport {
  students: StudentCompleteness[];
  issues: CompletenessIssue[];
  /** 6응답이 모두 제출 상태인 학생 수 */
  completeStudentCount: number;
  /** 점검한 전체 학생 수 */
  studentCount: number;
}

const cellKey = (phase: string, questionId: string) => `${phase}::${questionId}`;

/**
 * 학생ID × 시점 × 문항 격자를 채워 보고 중복·결손을 찾는다.
 * 결손을 0점이나 빈 응답으로 채우지 않는다. 보고만 한다.
 */
export function checkCompleteness(
  rows: readonly CompletenessRow[],
  options?: {
    /** 점검 대상 학생 목록. 주면 행이 하나도 없는 학생의 결손도 잡는다. */
    expectedResearchIds?: readonly string[];
    questionIds?: readonly string[];
    phases?: readonly AssessmentPhase[];
  }
): CompletenessReport {
  const questionIds = options?.questionIds ?? ASSESSMENT_QUESTION_IDS;
  const phases = options?.phases ?? ASSESSMENT_PHASES;
  const knownQuestions = new Set(questionIds);

  const issues: CompletenessIssue[] = [];
  /** researchId → 격자 칸 → 그 칸의 행들 */
  const grid = new Map<string, Map<string, CompletenessRow[]>>();

  const ensure = (researchId: string) => {
    let cells = grid.get(researchId);
    if (!cells) {
      cells = new Map();
      grid.set(researchId, cells);
    }
    return cells;
  };

  for (const id of options?.expectedResearchIds ?? []) ensure(id);

  for (const row of rows) {
    const cells = ensure(row.researchId);
    if (!knownQuestions.has(row.questionId)) {
      issues.push({
        kind: 'unknown_question',
        researchId: row.researchId,
        phase: row.phase,
        questionId: row.questionId,
        submissionIds: [row.submissionId],
        detail: '검사 레지스트리에 없는 문항ID',
      });
      continue;
    }
    const key = cellKey(row.phase, row.questionId);
    const bucket = cells.get(key);
    if (bucket) bucket.push(row);
    else cells.set(key, [row]);
  }

  const students: StudentCompleteness[] = [];

  for (const [researchId, cells] of grid) {
    let submittedCount = 0;
    let missingCount = 0;
    let absentCount = 0;

    for (const phase of phases) {
      for (const questionId of questionIds) {
        const bucket = cells.get(cellKey(phase, questionId)) ?? [];

        // 중복은 유효 제출이 둘 이상일 때만 문제로 본다.
        // 거절 기록(rejected_duplicate)은 정상적인 감사 흔적이므로 중복으로 세지 않는다.
        const submitted = bucket.filter((r) => r.responseStatus === 'submitted');
        if (submitted.length > 1) {
          issues.push({
            kind: 'duplicate',
            researchId,
            phase,
            questionId,
            submissionIds: submitted.map((r) => r.submissionId),
            detail: `유효 제출 ${submitted.length}건. 최초 제출 불변 규칙 확인 필요`,
          });
        }

        if (submitted.length >= 1) {
          submittedCount += 1;
        } else if (bucket.length > 0) {
          missingCount += 1;
          issues.push({
            kind: 'not_submitted',
            researchId,
            phase,
            questionId,
            submissionIds: bucket.map((r) => r.submissionId),
            detail: `결측 사유: ${bucket.map((r) => r.missingReason ?? r.responseStatus).join(', ')}`,
          });
        } else {
          absentCount += 1;
          issues.push({
            kind: 'absent',
            researchId,
            phase,
            questionId,
            submissionIds: [],
            detail: '해당 칸의 기록이 없음',
          });
        }
      }
    }

    students.push({
      researchId,
      submittedCount,
      missingCount,
      absentCount,
      complete: submittedCount === phases.length * questionIds.length,
    });
  }

  students.sort((a, b) => (a.researchId < b.researchId ? -1 : a.researchId > b.researchId ? 1 : 0));

  return {
    students,
    issues,
    completeStudentCount: students.filter((s) => s.complete).length,
    studentCount: students.length,
  };
}

/**
 * 재현 가능한 의사난수. 시드를 인자로 받아 기록할 수 있게 한다.
 * 표집과 시점 혼합의 순서를 나중에 그대로 다시 만들 수 있어야 한다.
 */
export function createSeededRandom(seed: string): () => number {
  // FNV-1a 32비트로 시드 문자열을 정수로 만든 뒤 mulberry32를 돌린다.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 학생 단위 무선 표집. 응답이 아니라 학생 목록에서 뽑는다.
 * 뽑힌 학생의 6응답은 이후 단계에서 통째로 유지한다.
 */
export function pickStudentLevelSample(
  researchIds: readonly string[],
  size: number,
  seed: string
): string[] {
  const pool = [...new Set(researchIds)].sort();
  const rand = createSeededRandom(seed);
  // Fisher-Yates. 시드가 같으면 같은 순서가 나온다.
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(size, pool.length)).sort();
}

/**
 * 표집한 학생의 응답을 학생 단위로 모두 가져온다.
 * 응답 단위로 잘라내지 않으므로 각 학생의 6응답이 그대로 남는다.
 */
export function keepAllResponsesOfSampledStudents<T extends { researchId: string }>(
  rows: readonly T[],
  sampledResearchIds: readonly string[]
): T[] {
  const set = new Set(sampledResearchIds);
  return rows.filter((r) => set.has(r.researchId));
}
