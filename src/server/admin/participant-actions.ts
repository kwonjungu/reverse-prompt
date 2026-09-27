'use server';

/**
 * 통합 관리 화면의 '참가자' — 연구 수업의 참가코드 일괄 발급과 동의·승낙 입력의 배선.
 *
 * 규칙은 participants.ts(순수)에 있고, 여기서는 관리자 세션 확인과 Firestore 읽기·쓰기만 맡는다.
 *
 * 저장하는 것
 *   - research_classes/{수업ID}/participants/{연구ID}: codeHash · seq · issuedAt · issuedBy
 *     (반 문서에는 마지막 순번 participantSeq)
 *   - consents/{연구ID}: guardianConsent · studentAssent · consentVersion · withdrawnAt ·
 *     classResearchId · updatedAt · updatedBy (학생 입장·연구 자료가 읽는 모양 그대로)
 *   - consent_events: 바꿀 때마다 한 건(누가·언제·무엇을). 지우지 않는다.
 *
 * 지키는 것
 *   - 모든 action은 첫 줄에서 requireAdmin()을 부른다.
 *   - 참가코드 원문은 발급 결과로 한 번만 돌려주고 어디에도 저장·기록하지 않는다.
 *     목록 조회는 해시도 돌려주지 않는다.
 *   - 이름·출석 번호를 받지 않는다. 실명 대응표는 앱 밖에서 학교가 관리한다.
 *   - 연구 수업에서만 쓴다. 일반 수업에는 발급하지 않는다.
 *   - 철회는 auth.recordConsentWithdrawal을 그대로 쓴다(세션 폐기, 자료는 지우지 않음).
 */

import 'server-only';

import { AuthError } from '@/server/auth/contract';
import { auth } from '@/server/auth';
import { hashParticipantCode, readParticipantCodePepper } from '@/server/auth/participant-code';
import { CONSENT_VERSION } from '@/server/config';
import {
  COLLECTIONS,
  PARTICIPANTS_SUBCOLLECTION,
  assertSafeDocId,
  getAdminFirestore,
} from '@/server/firebase-admin';
import { isResearchSession } from '@/lib/research/session-modes';
import type { SessionType } from '@/lib/research/types';
import { ADMIN_ACTOR, recordAdminEvent, requireAdmin } from './auth';
import {
  PARTICIPANT_BATCH_MAX,
  applyConsentChange,
  consentUpdateProblem,
  consentViewOf,
  formatParticipantCode,
  initialConsentDoc,
  isConsentField,
  nextParticipantSeq,
  participantBatchSizeProblem,
  planParticipantBatch,
  readConsentDoc,
  type ConsentField,
  type ParticipantConsentView,
  type PlannedParticipant,
} from './participants';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; signedOut: boolean };

class ParticipantInputError extends Error {}

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof AuthError) {
      return { ok: false, error: err.message, signedOut: err.code === 'unauthenticated' };
    }
    if (err instanceof ParticipantInputError) return { ok: false, error: err.message, signedOut: false };
    // 참가코드·동의 내용은 싣지 않는다.
    const code = (err as { code?: unknown } | null)?.code;
    console.error('[admin/participants] 처리 실패', code ?? '');
    return { ok: false, error: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.', signedOut: false };
  }
}

/* ────────────────────────── 결과 형 ────────────────────────── */

export type ParticipantConsentField = ConsentField;

/** 참가자 한 줄. 참가코드·해시·이름·번호는 없다. */
export interface ParticipantRow extends ParticipantConsentView {
  researchId: string;
  /** 반 안의 발급 순번(1, 2, 3 …). 출석 번호가 아니다. */
  seq: number | null;
  issuedAt: string | null;
}

export interface ParticipantList {
  classId: string;
  label: string | null;
  rows: ParticipantRow[];
  /** 지금 동의서 버전(CONSENT_VERSION). 없으면 동의를 받을 수 없다. */
  consentVersion: string | null;
  /** PARTICIPANT_CODE_PEPPER가 있어 발급할 수 있는가 */
  codeIssuable: boolean;
  /** 한 번에 발급할 수 있는 최대 수 */
  batchMax: number;
  loadedAt: string;
}

export interface IssuedParticipants {
  classId: string;
  label: string | null;
  issuedAt: string;
  /** 이번에 발급한 참가코드. 이 응답에만 있고 다시 받을 수 없다. */
  entries: Array<{ seq: number; researchId: string; code: string }>;
}

/* ────────────────────────── 공통 ────────────────────────── */

function toSessionType(value: unknown): SessionType {
  return value === 'research_practice' || value === 'research_assessment' ? value : 'experience';
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

async function requireResearchClass(classId: string) {
  const id = assertSafeDocId(String(classId ?? ''), '수업 번호');
  const ref = getAdminFirestore().collection(COLLECTIONS.researchClasses).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new ParticipantInputError('없는 반입니다. 목록을 새로 고쳐 주세요.');
  const data = snap.data() ?? {};
  if (!isResearchSession(toSessionType(data.sessionType))) {
    throw new ParticipantInputError('참가 번호와 동의는 연구 수업에서만 씁니다. 일반 수업에는 발급하지 않습니다.');
  }
  return { id, ref, label: str(data.label) };
}

type ResearchClass = Awaited<ReturnType<typeof requireResearchClass>>;

async function requireParticipant(cls: ResearchClass, researchId: string) {
  const id = assertSafeDocId(String(researchId ?? ''), '연구ID');
  const snap = await cls.ref.collection(PARTICIPANTS_SUBCOLLECTION).doc(id).get();
  if (!snap.exists) throw new ParticipantInputError('이 반의 참가자가 아닙니다. 목록을 새로 고쳐 주세요.');
  const data = snap.data() ?? {};
  return {
    researchId: id,
    seq: typeof data.seq === 'number' ? data.seq : null,
    issuedAt: str(data.issuedAt),
  };
}

function consentRef(researchId: string) {
  return getAdminFirestore().collection(COLLECTIONS.consents).doc(researchId);
}

async function readRows(cls: ResearchClass): Promise<ParticipantRow[]> {
  const db = getAdminFirestore();
  const snap = await cls.ref.collection(PARTICIPANTS_SUBCOLLECTION).get();
  const participants = snap.docs.map((d) => {
    const data = d.data();
    return {
      researchId: d.id,
      seq: typeof data.seq === 'number' ? data.seq : null,
      issuedAt: str(data.issuedAt),
    };
  });
  const consents = new Map<string, Record<string, unknown> | null>();
  for (let i = 0; i < participants.length; i += 200) {
    const refs = participants.slice(i, i + 200).map((p) => consentRef(p.researchId));
    if (refs.length === 0) continue;
    const docs = await db.getAll(...refs);
    for (const d of docs) consents.set(d.id, d.exists ? (d.data() ?? null) : null);
  }
  return participants
    .map((p) => ({
      ...p,
      ...consentViewOf(readConsentDoc(p.researchId, consents.get(p.researchId)), CONSENT_VERSION),
    }))
    .sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity) || a.researchId.localeCompare(b.researchId));
}

async function readRow(participant: Awaited<ReturnType<typeof requireParticipant>>): Promise<ParticipantRow> {
  const snap = await consentRef(participant.researchId).get();
  return {
    ...participant,
    ...consentViewOf(
      readConsentDoc(participant.researchId, snap.exists ? snap.data() : null),
      CONSENT_VERSION
    ),
  };
}

function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 6 || code === 'already-exists' || /already exists/i.test(String((err as Error)?.message ?? ''));
}

/* ────────────────────────── 조회 ────────────────────────── */

export async function listParticipantsAction(classId: string): Promise<Result<ParticipantList>> {
  return run(async () => {
    await requireAdmin();
    const cls = await requireResearchClass(classId);
    return {
      classId: cls.id,
      label: cls.label,
      rows: await readRows(cls),
      consentVersion: CONSENT_VERSION || null,
      codeIssuable: readParticipantCodePepper().length > 0,
      batchMax: PARTICIPANT_BATCH_MAX,
      loadedAt: new Date().toISOString(),
    };
  });
}

/* ────────────────────────── 발급 ────────────────────────── */

const ISSUE_ATTEMPTS = 4;

/**
 * 참가코드를 count개 발급한다. 참가자 문서(해시만)와 빈 동의 문서를 한 트랜잭션으로 만든다.
 * 순번은 반 문서의 participantSeq를 트랜잭션으로 올려 정하므로 두 곳에서 함께 눌러도 겹치지 않는다.
 * 연구ID가 다른 반의 것과 겹치면 전체가 실패하고 새로 뽑는다(create는 덮어쓰지 않는다).
 * 돌려준 참가코드는 저장하지 않으므로 다시 볼 수 없다.
 */
export async function issueParticipantCodesAction(
  classId: string,
  count: number
): Promise<Result<IssuedParticipants>> {
  return run(async () => {
    await requireAdmin();
    const sizeProblem = participantBatchSizeProblem(count);
    if (sizeProblem) throw new ParticipantInputError(sizeProblem);
    const pepper = readParticipantCodePepper();
    if (!pepper) {
      throw new ParticipantInputError(
        '서버에 PARTICIPANT_CODE_PEPPER가 설정되지 않아 참가 번호를 발급할 수 없습니다.'
      );
    }
    const cls = await requireResearchClass(classId);
    const db = getAdminFirestore();
    const participants = cls.ref.collection(PARTICIPANTS_SUBCOLLECTION);
    // 겹침 확인용. 참가코드는 해시로만 있으므로 새 코드도 해시로 비교한다.
    const existing = await participants.get();
    const takenHashes = new Set(
      existing.docs.map((d) => d.data().codeHash).filter((h): h is string => typeof h === 'string')
    );
    const takenIds = new Set(existing.docs.map((d) => d.id));
    const existingNext = nextParticipantSeq(existing.docs.map((d) => d.data()));
    const now = new Date().toISOString();

    let issued: PlannedParticipant[] | null = null;
    for (let attempt = 0; attempt < ISSUE_ATTEMPTS && !issued; attempt += 1) {
      try {
        issued = await db.runTransaction(async (tx) => {
          const classSnap = await tx.get(cls.ref);
          const counter = classSnap.data()?.participantSeq;
          const startSeq = Math.max(
            existingNext,
            typeof counter === 'number' && Number.isInteger(counter) ? counter + 1 : 1
          );
          const planned = planParticipantBatch({
            count,
            startSeq,
            isTakenCode: (code) => takenHashes.has(hashParticipantCode(code, pepper)),
            isTakenResearchId: (id) => takenIds.has(id),
          });
          for (const p of planned) {
            tx.create(participants.doc(p.researchId), {
              codeHash: hashParticipantCode(p.code, pepper),
              seq: p.seq,
              issuedAt: now,
              issuedBy: ADMIN_ACTOR,
            });
            tx.create(
              consentRef(p.researchId),
              initialConsentDoc({ classResearchId: cls.id, now, actor: ADMIN_ACTOR })
            );
          }
          tx.update(cls.ref, { participantSeq: planned[planned.length - 1].seq, updatedAt: now });
          return planned;
        });
      } catch (err) {
        if (!isAlreadyExists(err)) throw err;
      }
    }
    if (!issued) throw new ParticipantInputError('참가 번호를 만들지 못했습니다. 다시 눌러 주세요.');

    // 참가코드와 연구ID 목록은 기록하지 않는다. 몇 명을 몇 번부터 발급했는지만 남긴다.
    await recordAdminEvent('issue_participant_codes', cls.id, {
      count: issued.length,
      firstSeq: issued[0].seq,
      lastSeq: issued[issued.length - 1].seq,
    });
    return {
      classId: cls.id,
      label: cls.label,
      issuedAt: now,
      entries: issued.map((p) => ({
        seq: p.seq,
        researchId: p.researchId,
        code: formatParticipantCode(p.code),
      })),
    };
  });
}

/* ────────────────────────── 동의·승낙 ────────────────────────── */

/**
 * 보호자 동의 또는 학생 승낙 체크 하나를 바꾼다. 동의 문서와 이력을 한 트랜잭션으로 쓴다.
 * 동의서 버전이 설정되지 않았거나 철회한 참가자면 바꾸지 않는다.
 */
export async function setParticipantConsentAction(input: {
  classId: string;
  researchId: string;
  field: ParticipantConsentField;
  granted: boolean;
}): Promise<Result<ParticipantRow>> {
  return run(async () => {
    await requireAdmin();
    if (!isConsentField(input?.field)) throw new ParticipantInputError('바꿀 항목이 올바르지 않습니다.');
    const granted = input.granted === true;
    const cls = await requireResearchClass(input.classId);
    const participant = await requireParticipant(cls, input.researchId);
    const db = getAdminFirestore();
    const ref = consentRef(participant.researchId);
    const now = new Date().toISOString();

    const changed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const record = readConsentDoc(participant.researchId, snap.exists ? snap.data() : null);
      const problem = consentUpdateProblem(record, CONSENT_VERSION);
      if (problem) throw new ParticipantInputError(problem);
      const next = applyConsentChange({
        researchId: participant.researchId,
        record,
        field: input.field,
        granted,
        requiredVersion: CONSENT_VERSION,
        classResearchId: cls.id,
        now,
        actor: ADMIN_ACTOR,
      });
      if (!next.changed) return false;
      tx.set(ref, next.doc, { merge: true });
      tx.create(db.collection(COLLECTIONS.consentEvents).doc(), next.event);
      return true;
    });

    if (changed) {
      await recordAdminEvent('set_participant_consent', cls.id, {
        researchId: participant.researchId,
        field: input.field,
        granted,
      });
    }
    return readRow(participant);
  });
}

/**
 * 철회를 기록한다. 되돌리지 않는다. 그 참가자의 학생 세션을 끊고 새 전송·추가 채점을 막는다.
 * 이미 모은 자료는 지우지 않는다(파기는 승인된 절차로 따로 기록한다).
 */
export async function withdrawParticipantAction(input: {
  classId: string;
  researchId: string;
}): Promise<Result<ParticipantRow>> {
  return run(async () => {
    await requireAdmin();
    const cls = await requireResearchClass(input.classId);
    const participant = await requireParticipant(cls, input.researchId);
    const snap = await consentRef(participant.researchId).get();
    const record = readConsentDoc(participant.researchId, snap.exists ? snap.data() : null);
    if (record?.withdrawnAt) throw new ParticipantInputError('이미 철회를 기록한 참가자입니다.');
    await auth.recordConsentWithdrawal({
      researchId: participant.researchId,
      classResearchId: cls.id,
      actorUid: ADMIN_ACTOR,
      reason: '관리 화면: 철회 기록',
    });
    await recordAdminEvent('withdraw_participant', cls.id, { researchId: participant.researchId });
    return readRow(participant);
  });
}
