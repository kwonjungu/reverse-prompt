/**
 * 역할·학급 범위 판정과 세션 토큰의 순수 함수 시험.
 *
 * 실제 Firestore·Firebase Admin을 부르지 않는다. 서버가 조회한 principal을
 * 그대로 넣어 판정만 확인한다. 대응: 수용시험 11.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateAccess,
  evaluateResearchCollection,
  routeForNonConsented,
  type ServerPrincipal,
} from '@/server/auth/access';
import {
  mintSessionToken,
  verifySessionToken,
  type StudentSessionClaims,
} from '@/server/auth/session-token';
import {
  remainingIdentifiers,
  toResearcherView,
  toTeacherBlindRecord,
  buildModelPayload,
} from '@/server/auth/deidentify';

const teacher: ServerPrincipal = {
  uid: 'teacher-1',
  role: 'teacher',
  classCodes: ['7531234_3-2'],
  classResearchIds: ['CLS-AAA'],
};

const researcher: ServerPrincipal = {
  uid: 'researcher-1',
  role: 'researcher',
  classResearchIds: ['CLS-AAA'],
};

const developer: ServerPrincipal = {
  uid: 'dev-1',
  role: 'developer',
  classResearchIds: [],
  grantedScopes: [],
};

// ── 학급 범위 ────────────────────────────────────────────────

test('교사는 배정된 학급만 읽는다', () => {
  assert.deepEqual(
    evaluateAccess(teacher, { scope: 'research', classResearchId: 'CLS-AAA' }, 'read'),
    { allowed: true }
  );
});

test('다른 학급의 읽기·쓰기·삭제를 거부한다', () => {
  for (const action of ['read', 'write', 'delete'] as const) {
    const decision = evaluateAccess(
      teacher,
      { scope: 'research', classResearchId: 'CLS-BBB' },
      action
    );
    assert.equal(decision.allowed, false);
    assert.equal(decision.allowed === false && decision.reason, 'class_not_assigned');
  }
});

test('다른 수업 학급의 수업 기록도 거부한다', () => {
  const decision = evaluateAccess(
    teacher,
    { scope: 'lesson', classCode: '9999999_1-1' },
    'read_identifiable'
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, 'class_not_assigned');
});

test('익명·미인증 요청을 거부한다', () => {
  const decision = evaluateAccess(null, { scope: 'research', classResearchId: 'CLS-AAA' }, 'read');
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, 'not_authenticated');
});

// ── 학생의 교사 권한 위조 ────────────────────────────────────

test('학생 세션은 학급 자료 접근이 아예 없다', () => {
  const student: ServerPrincipal = {
    uid: 'session:abc',
    role: 'student',
    classResearchIds: ['CLS-AAA'],
  };
  const decision = evaluateAccess(
    student,
    { scope: 'research', classResearchId: 'CLS-AAA' },
    'read'
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, 'role_forbidden');
});

test('알 수 없는 역할 문자열을 교사로 승격하지 않는다', () => {
  const forged = { uid: 'x', role: 'TEACHER', classResearchIds: ['CLS-AAA'] } as unknown as ServerPrincipal;
  const decision = evaluateAccess(forged, { scope: 'research', classResearchId: 'CLS-AAA' }, 'write');
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, 'unknown_role');
});

test('정지된 계정은 거부한다', () => {
  const decision = evaluateAccess(
    { ...teacher, disabled: true },
    { scope: 'research', classResearchId: 'CLS-AAA' },
    'read'
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, 'account_disabled');
});

// ── 역할 분리 ────────────────────────────────────────────────

test('연구자는 비식별 읽기만 하고 식별 읽기·삭제는 못 한다', () => {
  assert.equal(
    evaluateAccess(researcher, { scope: 'research', classResearchId: 'CLS-AAA' }, 'read').allowed,
    true
  );
  const identifiable = evaluateAccess(
    researcher,
    { scope: 'research', classResearchId: 'CLS-AAA' },
    'read_identifiable'
  );
  assert.equal(identifiable.allowed, false);
  assert.equal(
    identifiable.allowed === false && identifiable.reason,
    'identifiable_read_forbidden'
  );

  const remove = evaluateAccess(
    researcher,
    { scope: 'research', classResearchId: 'CLS-AAA' },
    'delete'
  );
  assert.equal(remove.allowed, false);
  assert.equal(
    remove.allowed === false && remove.reason,
    'delete_requires_approved_procedure'
  );
});

test('연구자는 비연구 수업 기록에 접근하지 못한다', () => {
  const decision = evaluateAccess(researcher, { scope: 'lesson', classCode: '7531234_3-2' }, 'read');
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, 'role_forbidden');
});

test('개발자에게 운영 자료 포괄 접근권한을 기본 제공하지 않는다', () => {
  const decision = evaluateAccess(developer, { scope: 'research', classResearchId: 'CLS-AAA' }, 'read');
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, 'developer_scope_not_granted');
});

test('교사도 연구 저장소를 임의로 삭제하지 못한다', () => {
  const decision = evaluateAccess(
    teacher,
    { scope: 'research', classResearchId: 'CLS-AAA' },
    'delete'
  );
  assert.equal(decision.allowed, false);
  assert.equal(
    decision.allowed === false && decision.reason,
    'delete_requires_approved_procedure'
  );
});

// ── 동의 ─────────────────────────────────────────────────────

const activeConsent = {
  consentActive: true,
  withdrawnAt: null,
  consentVersion: 'c-v7',
  requiredConsentVersion: 'c-v7',
};

test('보호자 동의와 학생 승낙이 모두 활성일 때만 연구 수집이 된다', () => {
  assert.deepEqual(evaluateResearchCollection(activeConsent), { allowed: true });
  const inactive = evaluateResearchCollection({ ...activeConsent, consentActive: false });
  assert.equal(inactive.allowed, false);
  assert.equal(inactive.allowed === false && inactive.reason, 'consent_inactive');
});

test('CONSENT_VERSION이 비어 있으면 연구 동의를 받을 수 없다', () => {
  const decision = evaluateResearchCollection({ ...activeConsent, requiredConsentVersion: '' });
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, 'consent_version_unset');
});

test('철회 직후에는 새 작업을 거부한다', () => {
  const decision = evaluateResearchCollection({
    ...activeConsent,
    withdrawnAt: '2026-09-07T00:00:00.000Z',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, 'consent_withdrawn');
});

test('동의 버전이 다르면 수집하지 않는다', () => {
  const decision = evaluateResearchCollection({ ...activeConsent, consentVersion: 'c-v6' });
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, 'consent_version_mismatch');
});

test('동의 기록이 없으면 수집하지 않는다', () => {
  const decision = evaluateResearchCollection({
    consentActive: false,
    withdrawnAt: null,
    consentVersion: null,
    requiredConsentVersion: 'c-v7',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, 'consent_missing');
});

test('연구 대상이 아닌 학생의 다음 경로를 구분한다', () => {
  assert.equal(routeForNonConsented(true), 'lesson_record_only');
  assert.equal(routeForNonConsented(false), 'offline_alternative');
});

// ── 세션 토큰 ────────────────────────────────────────────────

const baseClaims: Omit<StudentSessionClaims, 'v'> = {
  sid: 'sid-1',
  researchId: 'R-001',
  classResearchId: 'CLS-AAA',
  classCode: '7531234_3-2',
  sessionType: 'research_practice',
  role: 'student',
  iat: 1_000_000,
  exp: 2_000_000,
};

test('자격증명(서명 키)이 없으면 우회 없이 실패한다', () => {
  assert.equal(mintSessionToken(baseClaims, ''), null);
  const result = verifySessionToken('anything.anything', '', 1_500_000);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'no_secret');
});

test('서명한 토큰만 통과한다', () => {
  const token = mintSessionToken(baseClaims, 'secret-a');
  assert.ok(token);
  const good = verifySessionToken(token, 'secret-a', 1_500_000);
  assert.equal(good.ok, true);
  assert.equal(good.ok === true && good.claims.researchId, 'R-001');

  // 다른 키로 서명된 것처럼 꾸며도 통과하지 않는다.
  const bad = verifySessionToken(token, 'secret-b', 1_500_000);
  assert.equal(bad.ok, false);
  assert.equal(bad.ok === false && bad.reason, 'bad_signature');
});

test('본문을 바꾸면 서명 검증에서 걸린다', () => {
  const token = mintSessionToken(baseClaims, 'secret-a')!;
  const [body, sig] = token.split('.');
  const forgedClaims = { ...baseClaims, v: 1, classResearchId: 'CLS-BBB' };
  const forgedBody = Buffer.from(JSON.stringify(forgedClaims), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  assert.notEqual(forgedBody, body);
  const result = verifySessionToken(`${forgedBody}.${sig}`, 'secret-a', 1_500_000);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'bad_signature');
});

test('만료된 토큰을 거부한다', () => {
  const token = mintSessionToken(baseClaims, 'secret-a')!;
  const result = verifySessionToken(token, 'secret-a', 2_000_001);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'expired');
});

// ── 비식별 ───────────────────────────────────────────────────

const rawRecord = {
  researchId: 'R-001',
  classResearchId: 'CLS-AAA',
  schoolName: '○○초등학교',
  schoolCode: '7531234',
  attendanceNumber: '12',
  classCode: '7531234_3-2',
  nickname: '별명',
  phase: 'pre',
  aiScore: 56.25,
  text: '초록 물뿌리개가 있다.',
  questionId: 'T1',
};

test('연구자 자료에 학교명·출석번호·학급코드가 없다', () => {
  const view = toResearcherView(rawRecord);
  assert.deepEqual(remainingIdentifiers(view), []);
  assert.equal('schoolName' in view, false);
  assert.equal('attendanceNumber' in view, false);
  assert.equal(view.researchId, 'R-001');
});

test('교사 블라인드 자료에 시점과 AI 점수가 없다', () => {
  const view = toTeacherBlindRecord(rawRecord);
  assert.equal('phase' in view, false);
  assert.equal('aiScore' in view, false);
  assert.equal(view.text, '초록 물뿌리개가 있다.');
});

test('모델 payload에 신원 ID가 없다', () => {
  const payload = buildModelPayload({
    text: '초록 물뿌리개가 있다.',
    questionId: 'T1',
    band: 'A',
    cueVersion: 'v7-candidate',
    rubricVersion: 'v7-candidate',
  });
  assert.deepEqual(Object.keys(payload).sort(), [
    'band',
    'cueVersion',
    'questionId',
    'rubricVersion',
    'text',
  ]);
});
