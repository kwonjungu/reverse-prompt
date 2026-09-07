/**
 * 연구ID 비식별 헬퍼.
 *
 * 연구자가 받는 연구ID 자료에는 학교 실명 대응표·출석번호·학교명이 없어야 한다.
 * AI 채점·생성·감수 payload에는 신원 ID가 필요 없다.
 *
 * 이 파일은 순수 변환만 하므로 'server-only'를 import 하지 않는다.
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §6, 수용시험 10·12
 */

/** 연구자 자료·모델 payload에서 제거할 식별 정보 필드 이름. */
export const IDENTIFYING_FIELDS = [
  'schoolCode',
  'schoolName',
  'school',
  'attendanceNumber',
  'studentName',
  'name',
  'nickname',
  'grade',
  'classNumber',
  'classCode',
  'classLabel',
  'uid',
  'email',
  'deviceId',
  'ip',
] as const;

/** 교사 블라인드 채점에서 가려야 할 필드. 시점·AI 점수가 없어야 한다. */
export const TEACHER_BLIND_HIDDEN_FIELDS = [
  'phase',
  'aiScore',
  'aiLevels',
  'aiAxisScores',
  'score',
  'levels',
  'axisScores',
  'operationalResult',
  'feedback',
  'feedbackStatus',
  'submittedAt',
  'startedAt',
  'sessionOpenedAt',
  'otherTeacherScores',
  'teacherScores',
] as const;

function omit(record: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (fields.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/** 식별 정보를 제거한 사본. 원본을 바꾸지 않는다. */
export function stripIdentifiers<T extends Record<string, unknown>>(
  record: T
): Record<string, unknown> {
  return omit(record, IDENTIFYING_FIELDS);
}

/** 연구자에게 내보낼 비식별 읽기 뷰. 삭제 권한과는 분리되어 있다. */
export function toResearcherView(record: Record<string, unknown>): Record<string, unknown> {
  return stripIdentifiers(record);
}

/**
 * 교사 블라인드 채점용 레코드.
 * 시점(pre/post)과 AI 점수, 다른 교사의 점수를 모두 뺀다.
 */
export function toTeacherBlindRecord(record: Record<string, unknown>): Record<string, unknown> {
  return omit(stripIdentifiers(record), TEACHER_BLIND_HIDDEN_FIELDS);
}

/** 남아 있는 식별 필드 이름 목록. 비어 있어야 정상이다. */
export function remainingIdentifiers(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter((k) =>
    (IDENTIFYING_FIELDS as readonly string[]).includes(k)
  );
}

export interface ModelPayload {
  /** 평가 대상 텍스트. 채점 지시가 아니라 데이터로 다룬다. */
  text: string;
  questionId: string;
  band: string;
  cueVersion: string;
  rubricVersion: string;
}

/**
 * AI 채점·생성·감수에 보낼 payload. 신원 ID를 넣지 않는다.
 * researchId·classResearchId도 모델에 보낼 이유가 없으므로 제외한다.
 */
export function buildModelPayload(input: {
  text: string;
  questionId: string;
  band: string;
  cueVersion: string;
  rubricVersion: string;
}): ModelPayload {
  return {
    text: input.text,
    questionId: input.questionId,
    band: input.band,
    cueVersion: input.cueVersion,
    rubricVersion: input.rubricVersion,
  };
}
