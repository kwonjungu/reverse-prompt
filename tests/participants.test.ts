/**
 * 통합 관리 화면 '참가자'(연구 참가코드 일괄 발급·보호자 동의·학생 승낙)의 순수 규칙 시험.
 *
 * 여기서 고정하는 것
 *   1. 참가코드는 헷갈리는 글자(0·O·1·I) 없이 8자, 연구ID는 P- + 12자이고 한 묶음 안에서 겹치지 않는다
 *   2. 발급이 저장하는 해시와 학생 입장이 찾는 해시가 같은 식(participant-code.ts 하나)이다
 *   3. 관리 화면이 쓰는 동의 문서를 학생 입장·연구 자료의 판정이 그대로 받아들인다
 *   4. 철회하면 비활성이 되고 되돌리지 않는다. 동의서 버전이 없으면 동의를 받지 않는다
 *   5. 목록·기록에 참가코드·이름·번호가 없다
 *
 * Firestore 배선(participant-actions.ts)은 정적으로만 확인한다.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  PARTICIPANT_CODE_ALPHABET,
  hashParticipantCode,
  normalizeParticipantCode,
  participantCodeLookupHashes,
  readParticipantCodePepper,
} from '../src/server/auth/participant-code';
import {
  PARTICIPANT_BATCH_MAX,
  PARTICIPANT_CODE_LENGTH,
  applyConsentChange,
  consentUpdateProblem,
  consentViewOf,
  formatParticipantCode,
  generateParticipantCode,
  generateResearchId,
  initialConsentDoc,
  isConsentField,
  nextParticipantSeq,
  participantBatchSizeProblem,
  planParticipantBatch,
  readConsentDoc,
} from '../src/server/admin/participants';
import { isConsentDocActive } from '../src/server/export/practice-summary';
import { evaluateResearchCollection } from '../src/server/auth/access';
import { isResearchConsentActive } from '../src/lib/research/types';

const ROOT = process.cwd();
/** 줄바꿈을 \n으로 맞춘다(윈도우에서 CRLF로 체크아웃해도 '\n}\n' 같은 찾기가 같게 동작하도록, 99-1 C2). */
const normalizeNewlines = (text: string) => text.replace(/\r\n?/g, '\n');
const readSource = (relative: string) => normalizeNewlines(readFileSync(path.join(ROOT, relative), 'utf8'));

/** 함수 머리부터 그 함수를 닫는 줄('\n}\n')까지. 줄바꿈을 정규화한 소스에서 찾는다. */
function functionBody(src: string, head: string): string {
  const start = src.indexOf(head);
  return src.slice(start, src.indexOf('\n}\n', start));
}

const PEPPER = 'test-pepper';
const VERSION = 'consent-2026-1';
const NOW = '2026-09-27T01:00:00.000Z';
const ACTOR = 'admin-console';
const CLASS_ID = '123456';
const CODE_RE = new RegExp(`^[${PARTICIPANT_CODE_ALPHABET}]{${PARTICIPANT_CODE_LENGTH}}$`);
const RESEARCH_ID_RE = new RegExp(`^P-[${PARTICIPANT_CODE_ALPHABET}]{12}$`);

/** 학생 입장(auth.issueStudentSession)과 같은 판정. */
function studentEntryAllows(researchId: string, doc: Record<string, unknown> | null, required = VERSION) {
  const record = readConsentDoc(researchId, doc);
  return evaluateResearchCollection({
    consentActive: isResearchConsentActive(record),
    withdrawnAt: record?.withdrawnAt ?? null,
    consentVersion: record?.consentVersion ?? null,
    requiredConsentVersion: required,
  }).allowed;
}

/* ────────────────── 참가코드·연구ID ────────────────── */

test('참가코드 글자는 헷갈리는 0·O·1·I가 없는 32자다', () => {
  assert.equal(PARTICIPANT_CODE_ALPHABET.length, 32);
  assert.equal(new Set(PARTICIPANT_CODE_ALPHABET).size, 32);
  for (const ch of ['0', 'O', '1', 'I']) assert.equal(PARTICIPANT_CODE_ALPHABET.includes(ch), false, ch);
  for (let i = 0; i < 500; i += 1) {
    assert.match(generateParticipantCode(), CODE_RE);
    assert.match(generateResearchId(), RESEARCH_ID_RE);
  }
});

test('한 묶음 안에서 참가코드·연구ID가 겹치지 않고 순번이 이어진다', () => {
  const planned = planParticipantBatch({ count: PARTICIPANT_BATCH_MAX, startSeq: 31 });
  assert.equal(planned.length, 60);
  assert.equal(new Set(planned.map((p) => p.code)).size, 60);
  assert.equal(new Set(planned.map((p) => p.researchId)).size, 60);
  assert.deepEqual(planned.map((p) => p.seq), Array.from({ length: 60 }, (_, i) => 31 + i));
  for (const p of planned) {
    assert.match(p.code, CODE_RE);
    assert.match(p.researchId, RESEARCH_ID_RE);
    // 문서 ID로 그대로 쓴다.
    assert.equal(/[/\x00-\x1f]/.test(p.researchId), false);
  }
});

test('겹치는 값은 다시 뽑고, 이미 있는 코드(해시로 비교)와 연구ID도 피한다', () => {
  // 같은 값을 두 번씩 내는 난수 — 묶음 안 중복을 버리고 새로 뽑아야 한다.
  let n = 0;
  const repeating = (min: number, max: number) => {
    const v = Math.floor(n / 40) % (max - min);
    n += 1;
    return min + v;
  };
  const dup = planParticipantBatch({ count: 3, startSeq: 1, pick: repeating });
  assert.equal(new Set(dup.map((p) => p.code)).size, 3);
  assert.equal(new Set(dup.map((p) => p.researchId)).size, 3);

  const first = planParticipantBatch({ count: 1, startSeq: 1 });
  const takenHash = hashParticipantCode(first[0].code, PEPPER);
  const planned = planParticipantBatch({
    count: 5,
    startSeq: 2,
    isTakenCode: (code) => hashParticipantCode(code, PEPPER) === takenHash,
    isTakenResearchId: (id) => id === first[0].researchId,
  });
  assert.equal(planned.some((p) => p.code === first[0].code), false);
  assert.equal(planned.some((p) => p.researchId === first[0].researchId), false);

  // 늘 같은 값만 내면 끝없이 돌지 않고 멈춘다.
  assert.throws(() => planParticipantBatch({ count: 2, startSeq: 1, pick: (min) => min }));
});

test('발급 수는 1~60 정수만 받는다', () => {
  for (const bad of [0, 61, 1.5, -1, Number.NaN, '3', null, undefined]) {
    assert.ok(participantBatchSizeProblem(bad), String(bad));
  }
  assert.equal(participantBatchSizeProblem(1), null);
  assert.equal(participantBatchSizeProblem(60), null);
  assert.throws(() => planParticipantBatch({ count: 61, startSeq: 1 }));
});

test('순번은 기존 참가자 다음부터 잇는다', () => {
  assert.equal(nextParticipantSeq([]), 1);
  assert.equal(nextParticipantSeq([{ seq: 3 }, { seq: 12 }, { seq: 'x' }, {}]), 13);
});

test('인쇄 모양은 네 자씩 끊고, 학생이 소문자·빈칸·-를 섞어 적어도 같은 코드가 된다', () => {
  assert.equal(formatParticipantCode('ABCDEFGH'), 'ABCD-EFGH');
  for (const typed of ['ABCD-EFGH', 'abcd-efgh', ' abcd efgh ', 'ＡＢＣＤ－ＥＦＧＨ', 'Abcd_Efgh']) {
    assert.equal(normalizeParticipantCode(typed), 'ABCDEFGH', typed);
  }
});

/* ────────────────── 해시: 발급과 학생 입장이 같은 식 ────────────────── */

test('발급이 저장하는 해시를 학생 입장이 찾는다', () => {
  const [p] = planParticipantBatch({ count: 1, startSeq: 1 });
  const stored = hashParticipantCode(p.code, PEPPER);
  // 예전부터 쓰던 식 그대로다: sha256(`${pepper}:${code.trim()}`)
  assert.equal(stored, createHash('sha256').update(`${PEPPER}:${p.code}`).digest('hex'));
  // 인쇄된 모양·소문자로 적어도 찾는다.
  const printed = formatParticipantCode(p.code);
  assert.ok(participantCodeLookupHashes(printed, PEPPER).includes(stored));
  assert.ok(participantCodeLookupHashes(printed.toLowerCase(), PEPPER).includes(stored));
  // pepper가 다르면 맞지 않는다.
  assert.equal(participantCodeLookupHashes(printed, 'other').includes(stored), false);
});

test('손으로 넣었던 옛 참가코드(적은 그대로 해시)도 여전히 찾는다', () => {
  const legacy = 'my-code-7';
  const stored = hashParticipantCode(legacy, PEPPER);
  assert.ok(participantCodeLookupHashes(`  ${legacy} `, PEPPER).includes(stored));
  assert.ok(participantCodeLookupHashes(legacy, PEPPER).length <= 2);
  assert.deepEqual(participantCodeLookupHashes('   ', PEPPER), []);
});

test('pepper가 없으면 해시를 만들지 않는다', () => {
  assert.throws(() => hashParticipantCode('ABCDEFGH', ''));
  assert.equal(readParticipantCodePepper({}), '');
  assert.equal(readParticipantCodePepper({ PARTICIPANT_CODE_PEPPER: '  x  ' }), 'x');
});

test('학생 입장과 발급이 같은 해시 모듈을 쓴다(두 번째 해시 식이 없다)', () => {
  const entry = readSource('src/server/auth/index.ts');
  assert.match(entry, /participantCodeLookupHashes\(/);
  assert.match(entry, /\.where\('codeHash', 'in', hashes\)/);
  assert.equal(/createHash\(/.test(entry), false, '학생 입장이 해시를 따로 계산하지 않는다');
  assert.match(entry, /PARTICIPANTS_SUBCOLLECTION/);

  const actions = readSource('src/server/admin/participant-actions.ts');
  assert.match(actions, /codeHash: hashParticipantCode\(p\.code, pepper\)/);
  assert.equal(/createHash\(/.test(actions), false);
  assert.match(actions, /PARTICIPANTS_SUBCOLLECTION/);
  assert.equal(/collection\('participants'\)/.test(actions + entry), false, '경로는 firebase-admin.ts에서만 정한다');
});

/* ────────────────── 동의 문서 ────────────────── */

function grantBoth(record: Record<string, unknown> | null, researchId = 'P-AAAAAAAAAAAA') {
  const first = applyConsentChange({
    researchId,
    record: readConsentDoc(researchId, record),
    field: 'guardianConsent',
    granted: true,
    requiredVersion: VERSION,
    classResearchId: CLASS_ID,
    now: NOW,
    actor: ACTOR,
  });
  const second = applyConsentChange({
    researchId,
    record: readConsentDoc(researchId, first.doc),
    field: 'studentAssent',
    granted: true,
    requiredVersion: VERSION,
    classResearchId: CLASS_ID,
    now: NOW,
    actor: ACTOR,
  });
  return { first, second };
}

test('발급 때 만든 동의 문서는 아직 수집을 허락하지 않는다', () => {
  const doc = initialConsentDoc({ classResearchId: CLASS_ID, now: NOW, actor: ACTOR });
  assert.equal(isConsentDocActive('P-X', doc), false);
  assert.equal(studentEntryAllows('P-X', doc), false);
  const view = consentViewOf(readConsentDoc('P-X', doc), VERSION);
  assert.equal(view.active, false);
  assert.equal(view.guardianConsent, 'unknown');
  assert.equal(view.studentAssent, 'unknown');
});

test('보호자 동의와 학생 승낙을 모두 체크하면 학생 입장·연구 자료가 받아들인다', () => {
  const id = 'P-AAAAAAAAAAAA';
  const { first, second } = grantBoth(initialConsentDoc({ classResearchId: CLASS_ID, now: NOW, actor: ACTOR }), id);
  // 한쪽만으로는 아니다.
  assert.equal(isConsentDocActive(id, first.doc), false);
  assert.equal(studentEntryAllows(id, first.doc), false);
  // 둘 다면 된다 — 두 읽기 쪽이 같은 모양을 받아들인다.
  assert.equal(isConsentDocActive(id, second.doc), true);
  assert.equal(studentEntryAllows(id, second.doc), true);
  assert.equal(consentViewOf(readConsentDoc(id, second.doc), VERSION).active, true);
  assert.deepEqual(
    { g: second.doc.guardianConsent, s: second.doc.studentAssent, v: second.doc.consentVersion, w: second.doc.withdrawnAt },
    { g: 'granted', s: 'granted', v: VERSION, w: null }
  );
});

test('바꿀 때마다 누가·언제·무엇을 바꿨는지 이력을 만든다', () => {
  const { first } = grantBoth(null);
  assert.equal(first.changed, true);
  assert.equal(first.event.event, 'consent_updated');
  assert.equal(first.event.actorUid, ACTOR);
  assert.equal(first.event.recordedAt, NOW);
  assert.equal(first.event.classResearchId, CLASS_ID);
  assert.equal(first.event.consentVersion, VERSION);
  assert.deepEqual(first.event.changes, [{ field: 'guardianConsent', from: 'unknown', to: 'granted' }]);
});

test('체크를 풀면 확인 전(unknown)으로 돌아가고, 같은 값이면 쓰지 않는다', () => {
  const id = 'P-BBBBBBBBBBBB';
  const { second } = grantBoth(null, id);
  const unchecked = applyConsentChange({
    researchId: id,
    record: readConsentDoc(id, second.doc),
    field: 'guardianConsent',
    granted: false,
    requiredVersion: VERSION,
    classResearchId: CLASS_ID,
    now: NOW,
    actor: ACTOR,
  });
  assert.equal(unchecked.doc.guardianConsent, 'unknown');
  assert.equal(isConsentDocActive(id, unchecked.doc), false);

  const same = applyConsentChange({
    researchId: id,
    record: readConsentDoc(id, second.doc),
    field: 'studentAssent',
    granted: true,
    requiredVersion: VERSION,
    classResearchId: CLASS_ID,
    now: NOW,
    actor: ACTOR,
  });
  assert.equal(same.changed, false);
});

test('동의서 버전이 바뀌면 옛 버전의 동의는 효력이 없고, 다른 칸도 다시 받아야 한다', () => {
  const id = 'P-CCCCCCCCCCCC';
  const old = { guardianConsent: 'granted', studentAssent: 'granted', consentVersion: 'old', withdrawnAt: null, updatedAt: NOW };
  const view = consentViewOf(readConsentDoc(id, old), VERSION);
  assert.equal(view.versionCurrent, false);
  assert.equal(view.active, false);
  assert.equal(studentEntryAllows(id, old), false);

  const next = applyConsentChange({
    researchId: id,
    record: readConsentDoc(id, old),
    field: 'guardianConsent',
    granted: true,
    requiredVersion: VERSION,
    classResearchId: CLASS_ID,
    now: NOW,
    actor: ACTOR,
  });
  assert.equal(next.doc.consentVersion, VERSION);
  assert.equal(next.doc.studentAssent, 'unknown', '옛 버전으로 받은 승낙을 새 버전으로 옮기지 않는다');
  assert.equal(next.event.previousConsentVersion, 'old');
});

test('동의서 버전(CONSENT_VERSION)이 없으면 동의를 받지 않는다', () => {
  assert.ok(consentUpdateProblem(null, ''));
  assert.ok(consentUpdateProblem(null, '   '));
  assert.throws(() =>
    applyConsentChange({
      researchId: 'P-D',
      record: null,
      field: 'guardianConsent',
      granted: true,
      requiredVersion: '',
      classResearchId: CLASS_ID,
      now: NOW,
      actor: ACTOR,
    })
  );
  const { second } = grantBoth(null, 'P-D');
  assert.equal(consentViewOf(readConsentDoc('P-D', second.doc), '').active, false);
});

test('철회하면 비활성이 되고 되돌리지 않는다', () => {
  const id = 'P-EEEEEEEEEEEE';
  const { second } = grantBoth(null, id);
  // auth.recordConsentWithdrawal이 병합하는 값
  const withdrawn = { ...second.doc, withdrawnAt: NOW, updatedAt: NOW };
  assert.equal(isConsentDocActive(id, withdrawn), false);
  assert.equal(studentEntryAllows(id, withdrawn), false);
  const view = consentViewOf(readConsentDoc(id, withdrawn), VERSION);
  assert.equal(view.withdrawn, true);
  assert.equal(view.active, false);
  assert.ok(consentUpdateProblem(readConsentDoc(id, withdrawn), VERSION));
  assert.throws(() =>
    applyConsentChange({
      researchId: id,
      record: readConsentDoc(id, withdrawn),
      field: 'guardianConsent',
      granted: true,
      requiredVersion: VERSION,
      classResearchId: CLASS_ID,
      now: NOW,
      actor: ACTOR,
    })
  );
});

test('바꿀 수 있는 항목은 보호자 동의·학생 승낙 둘뿐이다', () => {
  assert.equal(isConsentField('guardianConsent'), true);
  assert.equal(isConsentField('studentAssent'), true);
  for (const bad of ['withdrawnAt', 'consentVersion', '', null]) assert.equal(isConsentField(bad), false);
});

/* ────────────────── 목록·기록에 코드·이름이 없다 ────────────────── */

test('목록 한 줄에는 참가코드·해시·이름·번호가 없다', () => {
  const { second } = grantBoth(null);
  const keys = Object.keys(consentViewOf(readConsentDoc('P-A', second.doc), VERSION)).sort();
  assert.deepEqual(keys, [
    'active',
    'consentVersion',
    'guardianConsent',
    'studentAssent',
    'updatedAt',
    'versionCurrent',
    'withdrawn',
    'withdrawnAt',
  ]);
  for (const doc of [second.doc, second.event, initialConsentDoc({ classResearchId: CLASS_ID, now: NOW, actor: ACTOR })]) {
    const text = JSON.stringify(doc);
    assert.equal(/code|name|studentNumber|attendance/i.test(text), false, text);
  }
});

test('참가자 배선: 목록은 해시를 돌려주지 않고, 기록에 참가코드를 남기지 않는다', () => {
  const src = readSource('src/server/admin/participant-actions.ts');
  // 목록을 만드는 부분은 codeHash를 읽지 않는다.
  const rowsBody = functionBody(src, 'async function readRows(');
  assert.equal(/codeHash/.test(rowsBody), false);
  // 조작 기록에는 참가코드·해시가 없다.
  for (const m of src.matchAll(/recordAdminEvent\(([\s\S]*?)\);/g)) {
    assert.equal(/\bcode\b|codeHash|p\.code/.test(m[1]), false, m[1]);
  }
  // 이름·출석 번호를 받거나 쓰지 않는다.
  assert.equal(/studentNumber|attendance|displayName|realName/.test(src), false);
  // 철회는 자료를 지우지 않는다.
  assert.equal(/\.delete\(\)/.test(src), false);
  assert.match(src, /auth\.recordConsentWithdrawal\(/);
});

test('참가자 server action은 모두 관리자 세션을 먼저 확인하고 async 함수만 내보낸다', () => {
  const file = 'src/server/admin/participant-actions.ts';
  const src = readSource(file);
  assert.match(src, /^'use server';/);
  assert.equal(/^export (const|let|function|class) /m.test(src), false, 'use server 파일은 async 함수만 내보낸다');
  const exported = [...src.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(exported.sort(), [
    'issueParticipantCodesAction',
    'listParticipantsAction',
    'setParticipantConsentAction',
    'withdrawParticipantAction',
  ]);
  for (const name of exported) {
    const start = src.indexOf(`export async function ${name}(`);
    const next = src.indexOf('export async function', start + 10);
    const body = src.slice(start, next === -1 ? undefined : next);
    // run(async () => { 다음 첫 문장이 관리자 확인이다.
    assert.match(body, /return run\(async \(\) => \{\s*await requireAdmin\(\);/, `${file}의 ${name}`);
  }
});

test('99-1 C2: CRLF로 체크아웃한 소스에서도 함수 몸통 찾기가 같다', () => {
  const src = readSource('src/server/admin/participant-actions.ts');
  const crlf = src.replace(/\n/g, '\r\n');
  const body = functionBody(src, 'async function readRows(');
  assert.ok(body.length > 50 && !body.includes('codeHash'));
  assert.equal(functionBody(normalizeNewlines(crlf), 'async function readRows('), body);
  // 정규화하지 않으면 닫는 줄('\n}\n')이 없어 함수 끝을 못 찾는다 — 정규화가 필요한 까닭
  assert.equal(crlf.indexOf('\n}\n'), -1);
});

