/**
 * 통합 관리 화면의 '참가자' — 연구 참가코드 발급과 보호자 동의·학생 승낙 입력의 순수 규칙.
 *
 * 무엇을 지키는가
 *   - 이름·출석 번호를 어디에도 두지 않는다. 앱이 아는 것은 연구ID·순번·참가코드 해시뿐이다.
 *     실명 대응표(이름 ↔ 순번·연구ID)는 학교가 종이로 따로 보관한다.
 *   - 참가코드 원문은 발급한 그 자리에서 한 번만 화면에 보이고 저장하지 않는다.
 *     해시는 학생 입장과 같은 participant-code.ts가 만든다.
 *   - 동의 문서는 학생 입장(auth)·연구 자료(practice-summary)가 읽는 모양 그대로 쓴다.
 *     { guardianConsent, studentAssent: 'granted'|'unknown', consentVersion, updatedAt, withdrawnAt }
 *   - 동의는 지금 동의서 버전(CONSENT_VERSION)으로만 받는다. 비어 있으면 받지 않는다.
 *   - 철회는 되돌리지 않고 자료를 지우지 않는다(파기는 승인된 절차로 따로 기록한다).
 *
 * 이 파일은 'server-only'를 import 하지 않는다. 테스트에서 그대로 불러 쓴다.
 * Firestore 배선은 participant-actions.ts에 있다.
 */

import { randomInt } from 'node:crypto';
import {
  isResearchConsentActive,
  type ConsentRecord,
  type ConsentState,
} from '@/lib/research/types';
import { evaluateResearchCollection } from '@/server/auth/access';
import { PARTICIPANT_CODE_ALPHABET } from '@/server/auth/participant-code';

/** 한 번에 발급할 수 있는 수. 한 반(~30명)과 여유분을 넉넉히 덮는다. */
export const PARTICIPANT_BATCH_MAX = 60;

/** 참가코드 길이. 32자에서 8자(40비트)라 반 비밀번호와 따로 맞혀 들어오기 어렵다. */
export const PARTICIPANT_CODE_LENGTH = 8;

/** 연구ID 모양: P- + 참가코드 글자 12자. 신원 정보를 담지 않는 무작위 값이다. */
export const RESEARCH_ID_PREFIX = 'P-';
const RESEARCH_ID_BODY_LENGTH = 12;

type Pick = (min: number, max: number) => number;

function randomString(length: number, pick: Pick): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += PARTICIPANT_CODE_ALPHABET[pick(0, PARTICIPANT_CODE_ALPHABET.length)];
  }
  return out;
}

/** 참가코드(저장·대조 모양). 대문자 8자, '-' 없음. */
export function generateParticipantCode(pick: Pick = randomInt): string {
  return randomString(PARTICIPANT_CODE_LENGTH, pick);
}

/** 인쇄·화면에 보일 모양. 네 자씩 끊는다(ABCD-EFGH). 학생이 '-'를 적어도 입장에서 맞춰 준다. */
export function formatParticipantCode(code: string): string {
  return code.length === PARTICIPANT_CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function generateResearchId(pick: Pick = randomInt): string {
  return `${RESEARCH_ID_PREFIX}${randomString(RESEARCH_ID_BODY_LENGTH, pick)}`;
}

/** 발급 수가 1~60 정수가 아니면 화면에 보일 문구. */
export function participantBatchSizeProblem(count: unknown): string | null {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > PARTICIPANT_BATCH_MAX) {
    return `한 번에 1~${PARTICIPANT_BATCH_MAX}명까지 발급할 수 있습니다.`;
  }
  return null;
}

/** 발급 한 건. code는 이 자리에서만 쓰고 저장하지 않는다. */
export interface PlannedParticipant {
  seq: number;
  researchId: string;
  code: string;
}

/**
 * 발급할 참가자 목록을 만든다. 순번은 startSeq부터 이어 붙인다(반 안에서 1, 2, 3 …).
 * 이번 묶음 안에서, 그리고 isTakenCode·isTakenResearchId로 알려 준 기존 값과 겹치지 않게 다시 뽑는다.
 * 기존 참가코드는 해시만 있으므로 겹침 확인은 호출하는 쪽이 해시로 한다.
 */
export function planParticipantBatch(input: {
  count: number;
  startSeq: number;
  isTakenCode?: (code: string) => boolean;
  isTakenResearchId?: (researchId: string) => boolean;
  pick?: Pick;
}): PlannedParticipant[] {
  const problem = participantBatchSizeProblem(input.count);
  if (problem) throw new Error(problem);
  const pick = input.pick ?? randomInt;
  const codes = new Set<string>();
  const ids = new Set<string>();
  const out: PlannedParticipant[] = [];
  const maxTries = input.count * 20;
  let tries = 0;
  while (out.length < input.count) {
    tries += 1;
    if (tries > maxTries) throw new Error('겹치지 않는 참가코드를 만들지 못했습니다.');
    const code = generateParticipantCode(pick);
    const researchId = generateResearchId(pick);
    if (codes.has(code) || ids.has(researchId)) continue;
    if (input.isTakenCode?.(code) || input.isTakenResearchId?.(researchId)) continue;
    codes.add(code);
    ids.add(researchId);
    out.push({ seq: input.startSeq + out.length, researchId, code });
  }
  return out;
}

/** 이미 있는 참가자 문서에서 다음 순번을 정한다. */
export function nextParticipantSeq(existing: Array<{ seq?: unknown }>): number {
  let max = 0;
  for (const e of existing) {
    if (typeof e.seq === 'number' && Number.isInteger(e.seq) && e.seq > max) max = e.seq;
  }
  return max + 1;
}

/* ────────────────────────── 동의 ────────────────────────── */

export type ConsentField = 'guardianConsent' | 'studentAssent';

export const CONSENT_FIELD_LABEL: Record<ConsentField, string> = {
  guardianConsent: '보호자 동의',
  studentAssent: '학생 승낙',
};

export function isConsentField(value: unknown): value is ConsentField {
  return value === 'guardianConsent' || value === 'studentAssent';
}

function consentState(value: unknown): ConsentState {
  return value === 'granted' || value === 'declined' || value === 'withdrawn' ? value : 'unknown';
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** consents 문서를 학생 입장(auth.getConsent)과 같은 규칙으로 읽는다. 문서가 없으면 null. */
export function readConsentDoc(
  researchId: string,
  data: Record<string, unknown> | null | undefined
): ConsentRecord | null {
  if (!data) return null;
  return {
    researchId,
    guardianConsent: consentState(data.guardianConsent),
    studentAssent: consentState(data.studentAssent),
    consentVersion: str(data.consentVersion),
    updatedAt: str(data.updatedAt) ?? '',
    withdrawnAt: str(data.withdrawnAt),
  };
}

/** 관리 화면에 보일 동의 상태. 참가코드·해시는 담지 않는다. */
export interface ParticipantConsentView {
  guardianConsent: ConsentState;
  studentAssent: ConsentState;
  /** 문서에 남은 동의서 버전 */
  consentVersion: string | null;
  /** 문서의 버전이 지금 동의서 버전과 같은가. 다르면 그 동의는 지금 효력이 없다. */
  versionCurrent: boolean;
  withdrawn: boolean;
  withdrawnAt: string | null;
  /** 지금 연구 수집이 가능한가. 학생 입장이 쓰는 판정(evaluateResearchCollection)과 같다. */
  active: boolean;
  updatedAt: string | null;
}

export function consentViewOf(
  record: ConsentRecord | null,
  requiredVersion: string
): ParticipantConsentView {
  const required = requiredVersion.trim();
  const decision = evaluateResearchCollection({
    consentActive: isResearchConsentActive(record),
    withdrawnAt: record?.withdrawnAt ?? null,
    consentVersion: record?.consentVersion ?? null,
    requiredConsentVersion: required,
  });
  return {
    guardianConsent: record?.guardianConsent ?? 'unknown',
    studentAssent: record?.studentAssent ?? 'unknown',
    consentVersion: record?.consentVersion ?? null,
    versionCurrent: !!required && record?.consentVersion === required,
    withdrawn: !!record?.withdrawnAt,
    withdrawnAt: record?.withdrawnAt ?? null,
    active: decision.allowed,
    updatedAt: record?.updatedAt || null,
  };
}

/** 발급할 때 함께 만드는 동의 문서. 아직 아무 동의도 받지 않은 상태다. */
export function initialConsentDoc(ctx: {
  classResearchId: string;
  now: string;
  actor: string;
}): Record<string, unknown> {
  return {
    guardianConsent: 'unknown',
    studentAssent: 'unknown',
    consentVersion: null,
    withdrawnAt: null,
    classResearchId: ctx.classResearchId,
    updatedAt: ctx.now,
    updatedBy: ctx.actor,
  };
}

/** 동의를 바꿀 수 없으면 그 까닭. */
export function consentUpdateProblem(
  record: ConsentRecord | null,
  requiredVersion: string
): string | null {
  if (!requiredVersion.trim()) {
    return '동의서 버전(CONSENT_VERSION)이 설정되지 않아 동의를 기록할 수 없습니다.';
  }
  if (record?.withdrawnAt) {
    return '철회한 참가자입니다. 철회는 되돌리지 않습니다. 다시 참여하면 새 참가 번호를 발급해 주세요.';
  }
  return null;
}

export interface ConsentChange {
  field: ConsentField;
  from: ConsentState;
  to: ConsentState;
}

/**
 * 체크 하나를 바꾼 뒤의 동의 문서와 이력 기록을 만든다.
 *
 * 체크하면 'granted', 풀면 'unknown'(확인 전)이다. 거절·철회로 적지 않는다(철회는 따로 한다).
 * 문서의 버전이 지금 버전과 다르면 다른 칸의 동의도 지금 동의서로 받은 것이 아니므로
 * 'unknown'으로 되돌린다. 버전은 늘 지금 버전으로 적는다.
 */
export function applyConsentChange(input: {
  researchId: string;
  record: ConsentRecord | null;
  field: ConsentField;
  granted: boolean;
  requiredVersion: string;
  classResearchId: string;
  now: string;
  actor: string;
}): {
  doc: Record<string, unknown>;
  event: Record<string, unknown>;
  changes: ConsentChange[];
  /** 상태나 버전이 바뀌었는가. 아니면 쓰지 않고 이력도 남기지 않는다. */
  changed: boolean;
} {
  const problem = consentUpdateProblem(input.record, input.requiredVersion);
  if (problem) throw new Error(problem);
  const required = input.requiredVersion.trim();
  const sameVersion = input.record?.consentVersion === required;

  const before: Record<ConsentField, ConsentState> = {
    guardianConsent: input.record?.guardianConsent ?? 'unknown',
    studentAssent: input.record?.studentAssent ?? 'unknown',
  };
  const after: Record<ConsentField, ConsentState> = {
    guardianConsent: sameVersion ? before.guardianConsent : 'unknown',
    studentAssent: sameVersion ? before.studentAssent : 'unknown',
  };
  after[input.field] = input.granted ? 'granted' : 'unknown';

  const changes: ConsentChange[] = (['guardianConsent', 'studentAssent'] as const)
    .filter((f) => before[f] !== after[f])
    .map((f) => ({ field: f, from: before[f], to: after[f] }));

  const doc = {
    guardianConsent: after.guardianConsent,
    studentAssent: after.studentAssent,
    consentVersion: required,
    withdrawnAt: null,
    classResearchId: input.classResearchId,
    updatedAt: input.now,
    updatedBy: input.actor,
  };
  const event = {
    researchId: input.researchId,
    classResearchId: input.classResearchId,
    event: 'consent_updated',
    changes,
    consentVersion: required,
    previousConsentVersion: input.record?.consentVersion ?? null,
    actorUid: input.actor,
    recordedAt: input.now,
  };
  const changed = changes.length > 0 || (input.record?.consentVersion ?? null) !== required;
  return { doc, event, changes, changed };
}
