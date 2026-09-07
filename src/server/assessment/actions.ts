'use server';

/**
 * 검사 수집 server action — 수집만 하고 채점은 하지 않는다.
 *
 * 판정과 저장의 본체는 ./collect.ts에 있다. 이 파일은 실제 인증·레지스트리·개인정보
 * 점검·Firestore 저장소를 넣어 부르기만 한다. 시험은 같은 본체에 가짜 의존을 넣어
 * 돌리므로, 학생이 쓰는 코드와 시험이 도는 코드가 같다.
 *
 * 'use server' 파일이므로 모든 export는 async 함수다. 의존을 갈아 끼우는 export를
 * 두지 않는다(그런 export는 클라이언트가 부를 수 있는 구멍이 된다).
 *
 * 설계서 §5
 *  - 검사 화면 요청 시 AI를 호출하지 않는다. 이 파일은 grading을 import 하지 않는다.
 *  - 점수·피드백·힌트·모범답이 없고 제출 후 재도전이 없다.
 *  - 최초 유효 제출은 (researchId, phase, questionId) 한 칸에 대해 불변이다.
 */

import { auth } from '@/server/auth';
import { registry } from '@/server/registry';
import { privacy } from '@/server/privacy';
import { CONSENT_VERSION } from '@/server/config';
import type { AssessmentPhase } from '@/lib/research/types';
import * as collect from './collect';
import type { AssessmentStateResponse, CollectDeps, SubmitResult } from './collect';
import { createFirestoreAssessmentStore } from './firestore-store';
import type { AssessmentStore } from './store';

export type { AssessmentStateResponse, SubmitResult };

let cachedStore: AssessmentStore | null = null;
function store(): AssessmentStore {
  if (!cachedStore) cachedStore = createFirestoreAssessmentStore();
  return cachedStore;
}

function deps(): CollectDeps {
  return {
    auth,
    registry,
    privacy,
    store: store(),
    consentVersion: CONSENT_VERSION,
  };
}

/* ────────────────────── 교사: 세션 열기·닫기 ────────────────────── */

export async function openAssessmentSession(
  classResearchId: string,
  phase: AssessmentPhase
): Promise<{ ok: boolean; assessmentSessionId?: string; blockers?: string[] }> {
  return collect.openAssessmentSession(deps(), classResearchId, phase);
}

export async function closeAssessmentSession(
  assessmentSessionId: string
): Promise<{ ok: boolean }> {
  return collect.closeAssessmentSession(deps(), assessmentSessionId);
}

/* ────────────────────── 학생: 상태 조회·문항 열기 ────────────────────── */

export async function getAssessmentState(): Promise<AssessmentStateResponse> {
  return collect.getAssessmentState(deps());
}

export async function startAssessmentItem(
  requestedQuestionId: string | null
): Promise<AssessmentStateResponse> {
  return collect.startAssessmentItem(deps(), requestedQuestionId);
}

/* ────────────────────── 학생: 제출 ────────────────────── */

export async function submitAssessmentResponse(input: {
  submissionId: string;
  questionId: string;
  text: string;
}): Promise<SubmitResult> {
  return collect.submitAssessmentResponse(deps(), input);
}

/* ────────────────────── 기술 실패 ────────────────────── */

/**
 * 학생 신고를 남긴다. 결측 사유를 확정하지 않으며 없는 문항 창을 만들지 않는다.
 */
export async function reportTechnicalFailure(input: {
  questionId: string;
  reason: string;
}): Promise<{ ok: boolean; recorded: boolean }> {
  return collect.reportTechnicalFailure(deps(), input);
}

/** 교사가 확인한 기술 실패. 이 값만이 결측 사유를 technical_failure로 만든다. */
export async function confirmTechnicalFailure(input: {
  classResearchId: string;
  researchId: string;
  phase: AssessmentPhase;
  questionId: string;
  reason: string;
}): Promise<{ ok: boolean }> {
  return collect.confirmTechnicalFailure(deps(), input);
}

/* ────────────────────── 마감 처리 ────────────────────── */

export async function finalizeTimeouts(
  assessmentSessionId: string,
  researchIds: string[]
): Promise<{ ok: boolean; created: number }> {
  return collect.finalizeTimeouts(deps(), assessmentSessionId, researchIds);
}
