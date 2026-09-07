/**
 * 생성 결과 대조 표본 — 12명 × 6응답 × 3개 생성
 *
 * 설계서 §5
 *  - 생성 결과 대조는 검증 표본 중 사전에 무선 추출한 12명의 72문장 × 3개이다.
 *  - 최고 이미지 선택 기능을 만들지 말고 3개 전부와 실패 상태를 보존한다.
 *  - 생성 도구는 승인된 연구자 작업으로만 쓰이고 수업 모드에서 임의 호출되지 않는다.
 *
 * 이 파일은 생성 호출을 하지 않는다. 표집 규칙과 보존 형식만 정하고,
 * 실제 호출 지점을 만들지 않는다. 어디선가 생성을 붙이려 하면 requireGenerationAuthority가
 * 먼저 걸린다.
 */

import type { SessionType } from '@/lib/research/types';
import {
  RESPONSES_PER_STUDENT,
  keepAllResponsesOfSampledStudents,
  pickStudentLevelSample,
} from './completeness';

/** 검증 표본 학생 수. 학생 단위로 표집하며 각 6응답을 유지한다. */
export const VALIDATION_SAMPLE_STUDENTS = 36;

/** 생성 결과 대조 표본 학생 수. 검증 표본 안에서 다시 학생 단위로 뽑는다. */
export const GENERATION_SAMPLE_STUDENTS = 12;

/** 12명 × 6응답 = 72문장 */
export const GENERATION_SENTENCE_COUNT = GENERATION_SAMPLE_STUDENTS * RESPONSES_PER_STUDENT;

/** 문장 하나마다 만드는 생성 결과 수. 셋을 모두 남긴다. */
export const GENERATIONS_PER_SENTENCE = 3;

/**
 * 검증 표본 36명을 학생 단위로 뽑는다.
 * 응답 단위로 뽑지 않으므로 한 학생의 6응답이 쪼개지지 않는다.
 */
export function pickValidationSample(researchIds: readonly string[], seed: string): string[] {
  return pickStudentLevelSample(researchIds, VALIDATION_SAMPLE_STUDENTS, seed);
}

/**
 * 생성 대조 표본 12명을 검증 표본 안에서 다시 뽑는다.
 * 검증 표본 밖의 학생은 후보에 들어가지 않는다.
 */
export function pickGenerationSample(
  validationSampleResearchIds: readonly string[],
  seed: string
): string[] {
  return pickStudentLevelSample(validationSampleResearchIds, GENERATION_SAMPLE_STUDENTS, seed);
}

export { keepAllResponsesOfSampledStudents };

/** 생성 1회의 상태. 실패를 재현 0인 정상 이미지로 만들지 않는다. */
export type GenerationStatus = 'generated' | 'refused' | 'technical_failure';

export interface GenerationAttemptRecord {
  /** 1, 2, 3. 셋 다 남긴다. 최고를 고르는 필드는 두지 않는다. */
  attemptIndex: number;
  status: GenerationStatus;
  /** 생성 이미지의 해시. 실패면 null이다. */
  imageSha256: string | null;
  failureReason: string | null;
  modelId: string;
  modelConfig: Record<string, unknown>;
  createdAt: string;
}

export interface GenerationComparisonRecord {
  schemaVersion: string;
  submissionId: string;
  questionId: string;
  /** 세 번의 생성 기록. 길이는 언제나 GENERATIONS_PER_SENTENCE이다. */
  attempts: GenerationAttemptRecord[];
  /** 이 문장의 생성 쌍이 완전한지. 불완전하면 사유와 함께 보고한다. */
  complete: boolean;
}

/**
 * 세 생성 기록이 모두 보존되었는지 확인한다.
 * 하나라도 빠졌으면 완료로 보고하지 않는다.
 */
export function verifyGenerationRecord(
  record: GenerationComparisonRecord
): { ok: true } | { ok: false; reason: string } {
  if (record.attempts.length !== GENERATIONS_PER_SENTENCE) {
    return { ok: false, reason: `생성 기록이 ${record.attempts.length}개(계획 ${GENERATIONS_PER_SENTENCE}개)` };
  }
  const indices = record.attempts.map((a) => a.attemptIndex).sort();
  for (let i = 0; i < GENERATIONS_PER_SENTENCE; i += 1) {
    if (indices[i] !== i + 1) return { ok: false, reason: '생성 회차 번호가 1·2·3이 아님' };
  }
  return { ok: true };
}

/** 성공한 생성 수와 실패 사유를 세어 보고한다. 실패를 0점 결과로 바꾸지 않는다. */
export function summarizeGenerationStatus(records: readonly GenerationComparisonRecord[]) {
  const counts: Record<GenerationStatus, number> = {
    generated: 0,
    refused: 0,
    technical_failure: 0,
  };
  for (const r of records) {
    for (const a of r.attempts) counts[a.status] += 1;
  }
  return {
    sentences: records.length,
    plannedSentences: GENERATION_SENTENCE_COUNT,
    attempts: records.length * GENERATIONS_PER_SENTENCE,
    ...counts,
  };
}

export class GenerationNotAuthorizedError extends Error {
  constructor(reason: string) {
    super(`생성 도구를 쓸 수 없다: ${reason}`);
    this.name = 'GenerationNotAuthorizedError';
  }
}

/**
 * 생성 도구 사용 권한을 확인한다.
 *
 * 승인된 연구자 작업에서만 통과한다. 수업(연습·검사) 세션에서는 언제나 막는다.
 * 이 함수를 통과해도 이 모듈이 생성을 호출하지는 않는다. 호출 지점을 만들지 않는다.
 */
export function requireGenerationAuthority(input: {
  role: string;
  sessionType: SessionType;
  /** 연구 책임자가 명시적으로 부여한 범위. 기본은 빈 배열이다. */
  grantedScopes: readonly string[];
}): void {
  if (input.sessionType !== 'experience') {
    throw new GenerationNotAuthorizedError('수업·검사 세션에서는 생성 도구를 쓰지 않는다');
  }
  if (input.role !== 'researcher' && input.role !== 'admin') {
    throw new GenerationNotAuthorizedError('연구자 역할이 아니다');
  }
  if (!input.grantedScopes.includes('research:generate_comparison')) {
    throw new GenerationNotAuthorizedError('생성 대조 작업 범위가 승인되지 않았다');
  }
}
