/**
 * 통합 관리 화면(/admin)의 순수 규칙 시험.
 *
 * 여기서 고정하는 것
 *   1. 비밀번호는 원문이 아니라 scrypt 해시로만 남고, 해시로 대조된다
 *   2. 관리자 자격은 저장된 해시가 있으면 그것만 쓰고, 없을 때만 ADMIN_PASSWORD를 쓴다
 *   3. 관리자 세션 토큰은 서명·만료·자격 지문을 확인하며, 비밀번호를 바꾸면 무효가 된다
 *   4. 관리 화면에서 만든 반은 체험 성격이어도 교사가 연 차시만 열린다
 *
 * 쿠키·Firestore·Firebase Auth 배선은 여기서 시험하지 않는다(actions.ts는 서버 전용 배선이다).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  ADMIN_SESSION_TTL_MS,
  credentialFingerprint,
  deriveAdminKey,
  generateClassId,
  hashPassword,
  isGeneratedClassId,
  isPasswordHash,
  mintAdminToken,
  normalizeClassLabel,
  normalizeEmail,
  parseStudentNumber,
  passwordProblem,
  resolveAdminCredential,
  sanitizeClassAssignments,
  verifyAdminPassword,
  verifyAdminToken,
  verifyPassword,
} from '../src/server/admin/core';
import {
  decideLessonAccess,
  visibleLessons,
  type LessonOpenState,
} from '../src/server/lessons/policy';
import {
  createLessonStore,
  createMemoryBackend,
  toOpenState,
} from '../src/server/lessons/store-core';

const ROOT = process.cwd();

/* ────────────────── 비밀번호 해시 ────────────────── */

test('비밀번호는 원문 없이 scrypt 해시로만 남는다', async () => {
  const hash = await hashPassword('사과나무2반');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(hash.includes('사과나무2반'), false, '원문이 해시 문자열에 들어 있다');
  assert.ok(isPasswordHash(hash));
  assert.equal(await verifyPassword('사과나무2반', hash), true);
  assert.equal(await verifyPassword('사과나무3반', hash), false);
  assert.equal(await verifyPassword('', hash), false);
});

test('같은 비밀번호도 매번 다른 salt로 해시한다', async () => {
  const a = await hashPassword('same-password');
  const b = await hashPassword('same-password');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('same-password', a), true);
  assert.equal(await verifyPassword('same-password', b), true);
});

test('형식이 틀린 해시는 어떤 입력으로도 통과하지 않는다', async () => {
  for (const bad of ['plain-password', '', null, 'scrypt$1$8$1$a$b', 'scrypt$999999999$8$1$AAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA']) {
    assert.equal(isPasswordHash(bad), false);
    assert.equal(await verifyPassword('plain-password', bad), false);
  }
});

test('비밀번호 길이 규칙은 종류별로 다르다', () => {
  assert.match(passwordProblem('short-pw9', 'admin') ?? '', /10자/);
  assert.equal(passwordProblem('tenchars10', 'admin'), null, '10자는 통과한다');
  assert.equal(passwordProblem('long-enough-admin', 'admin'), null);
  assert.match(passwordProblem('1234567', 'teacher') ?? '', /8자/);
  assert.equal(passwordProblem('12345678', 'teacher'), null);
  assert.match(passwordProblem('123', 'class') ?? '', /4자/);
  assert.equal(passwordProblem('1234', 'class'), null);
  assert.ok(passwordProblem(' 12345', 'class'), '앞뒤 공백은 받지 않는다');
  assert.ok(passwordProblem(undefined, 'class'));
});

/* ────────────────── 관리자 자격 ────────────────── */

test('저장된 해시가 있으면 ADMIN_PASSWORD로는 들어가지 못한다', async () => {
  const stored = await hashPassword('changed-in-console');
  const res = resolveAdminCredential({ storedHash: stored, envPassword: 'initial-env-password' });
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal(res.credential.source, 'stored');
  assert.equal(await verifyAdminPassword('changed-in-console', res.credential), true);
  assert.equal(await verifyAdminPassword('initial-env-password', res.credential), false);
});

test('저장된 값이 깨져 있으면 env로 내려가지 않고 막는다', () => {
  const res = resolveAdminCredential({ storedHash: 'not-a-hash', envPassword: 'initial-env-password' });
  assert.deepEqual(res, { ok: false, reason: 'stored_malformed' });
});

test('저장된 해시가 없으면 ADMIN_PASSWORD를 쓰고, 짧으면 열지 않는다', async () => {
  const env = resolveAdminCredential({ storedHash: undefined, envPassword: 'initial-env-password' });
  assert.ok(env.ok);
  if (env.ok) {
    assert.equal(await verifyAdminPassword('initial-env-password', env.credential), true);
    assert.equal(await verifyAdminPassword('initial-env-passwor', env.credential), false);
  }
  assert.deepEqual(resolveAdminCredential({ storedHash: null, envPassword: '' }), {
    ok: false,
    reason: 'unset',
  });
  assert.deepEqual(resolveAdminCredential({ storedHash: null, envPassword: '1111' }), {
    ok: false,
    reason: 'env_too_short',
  });
});

/* ────────────────── 관리자 세션 토큰 ────────────────── */

test('관리자 토큰은 서명과 만료를 확인한다', () => {
  const key = deriveAdminKey('server-secret', 'fingerprint-a');
  assert.ok(key);
  const now = Date.UTC(2026, 8, 26, 9, 0, 0);
  const token = mintAdminToken(key!, now);
  assert.equal(verifyAdminToken(token, key, now + 1000).ok, true);

  const expired = verifyAdminToken(token, key, now + ADMIN_SESSION_TTL_MS);
  assert.deepEqual(expired, { ok: false, reason: 'expired' });

  const [body, sig] = token.split('.');
  const tampered = `${body}x.${sig}`;
  assert.equal(verifyAdminToken(tampered, key, now).ok, false);
  assert.deepEqual(verifyAdminToken(token, null, now), { ok: false, reason: 'no_key' });
  assert.equal(verifyAdminToken('', key, now).ok, false);
});

test('관리자 비밀번호를 바꾸면 이전 세션이 모두 무효가 된다', async () => {
  const before = { source: 'env' as const, password: 'initial-env-password' };
  const after = { source: 'stored' as const, hash: await hashPassword('changed-in-console') };
  const keyBefore = deriveAdminKey('server-secret', credentialFingerprint(before));
  const keyAfter = deriveAdminKey('server-secret', credentialFingerprint(after));
  const now = Date.now();
  const token = mintAdminToken(keyBefore!, now);
  assert.equal(verifyAdminToken(token, keyBefore, now).ok, true);
  assert.deepEqual(verifyAdminToken(token, keyAfter, now), { ok: false, reason: 'bad_signature' });
});

test('서버 비밀키가 없으면 관리자 서명 키를 만들지 않는다', () => {
  assert.equal(deriveAdminKey('', 'fingerprint'), null);
  assert.equal(deriveAdminKey('secret', ''), null);
});

test('지문에 원문 비밀번호가 드러나지 않는다', () => {
  const fp = credentialFingerprint({ source: 'env', password: 'initial-env-password' });
  assert.match(fp, /^[0-9a-f]{64}$/);
  assert.equal(fp.includes('initial'), false);
});

/* ────────────────── 반·교사 입력 ────────────────── */

test('수업 번호는 첫 자리가 0이 아닌 여섯 자리 숫자다', () => {
  for (let i = 0; i < 200; i += 1) {
    const id = generateClassId();
    assert.ok(isGeneratedClassId(id), id);
  }
  // 난수 원천이 최솟값만 내도 첫 자리는 1이다.
  assert.equal(generateClassId((min) => min), '100000');
  assert.equal(isGeneratedClassId('012345'), false);
  assert.equal(isGeneratedClassId('12345'), false);
});

test('출석 번호는 1~99 정수만 받는다', () => {
  assert.equal(parseStudentNumber('7'), 7);
  assert.equal(parseStudentNumber(' 12 '), 12);
  assert.equal(parseStudentNumber(3), 3);
  for (const bad of ['0', '100', '-1', '3.5', 'abc', '', null, undefined, 3.5]) {
    assert.equal(parseStudentNumber(bad), null, String(bad));
  }
});

test('반 이름·계정 입력을 다듬는다', () => {
  assert.equal(normalizeClassLabel('  3학년 2반  '), '3학년 2반');
  assert.equal(normalizeClassLabel('\u0000'), null);
  assert.equal(normalizeClassLabel('가'.repeat(80))?.length, 40);
  assert.equal(normalizeEmail(' Teacher@School.KR '), 'teacher@school.kr');
  assert.equal(normalizeEmail('not-an-email'), null);
  assert.deepEqual(sanitizeClassAssignments(['222222', '111111', '999999', '111111', 3], ['111111', '222222']), [
    '111111',
    '222222',
  ]);
  assert.deepEqual(sanitizeClassAssignments('111111', ['111111']), []);
});

/* ────────────────── 교사 진행 차시 ────────────────── */

const experienceBase: LessonOpenState = {
  sessionType: 'experience',
  currentLesson: 2,
  allowedLessons: [1, 2],
  closedAt: null,
  sessionVerified: true,
};

test('옛 체험 학급은 그대로 자율 진행이다', () => {
  assert.equal(decideLessonAccess(experienceBase, 5).allowed, true);
  assert.deepEqual(visibleLessons(experienceBase), [1, 2, 3, 4, 5, 6]);
});

test('관리 화면에서 만든 체험 반은 연 차시만 열린다', () => {
  const paced: LessonOpenState = { ...experienceBase, teacherPaced: true };
  assert.equal(decideLessonAccess(paced, 2).allowed, true);
  const denied = decideLessonAccess(paced, 5);
  assert.equal(denied.allowed, false);
  assert.deepEqual(visibleLessons(paced), [1, 2]);

  const ended: LessonOpenState = { ...paced, closedAt: '2026-09-26T03:00:00.000Z' };
  const closed = decideLessonAccess(ended, 1);
  assert.equal(closed.allowed, false);
  if (!closed.allowed) assert.equal(closed.reason, 'session_closed');
  assert.deepEqual(visibleLessons(ended), []);
});

test('teacherPaced=false는 연구 세션의 통제를 풀지 못한다', () => {
  const research: LessonOpenState = {
    ...experienceBase,
    sessionType: 'research_practice',
    teacherPaced: false,
  };
  assert.equal(decideLessonAccess(research, 5).allowed, false);
});

test('차시 기록의 pacing이 판정 상태로 옮겨진다', async () => {
  const backend = createMemoryBackend();
  const store = createLessonStore({
    backend,
    paths: {
      lessonSessions: 'lessons',
      researchPracticeSubmissions: 'research',
      experienceSubmissions: (c) => `classes/${c}/exp`,
    },
    safeDocId: (v) => v,
  });
  await store.ensureLessonSession({ classResearchId: '123456', sessionType: 'experience', pacing: 'teacher' });
  let record = await store.readLessonSession('123456');
  assert.equal(record?.pacing, 'teacher');
  assert.deepEqual(record?.allowedLessons, []);
  assert.deepEqual(visibleLessons(toOpenState(record, 'experience', true)), []);

  await store.openLessonSession({
    classResearchId: '123456',
    sessionType: 'experience',
    lesson: 1,
    openedBy: 'admin-console',
    reason: null,
  });
  record = await store.readLessonSession('123456');
  assert.equal(record?.pacing, 'teacher', '차시를 열어도 진행 방식이 유지된다');
  assert.deepEqual(visibleLessons(toOpenState(record, 'experience', true)), [1]);

  await store.closeLessonSession({ classResearchId: '123456', closedBy: 'admin-console', reason: null });
  record = await store.readLessonSession('123456');
  assert.equal(decideLessonAccess(toOpenState(record, 'experience', true), 1).allowed, false);
});

/* ────────────────── 배선의 정적 확인 ────────────────── */

const readSource = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

test('관리 server action은 모두 관리자 세션을 먼저 확인한다', () => {
  const src = readSource('src/server/admin/actions.ts');
  const exported = [...src.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
  assert.ok(exported.length > 5);
  // 로그인·상태 조회·로그아웃만 세션 없이 부를 수 있다.
  const open = new Set(['getAdminStatusAction', 'adminSignInAction', 'adminSignOutAction']);
  for (const name of exported) {
    if (open.has(name)) continue;
    const start = src.indexOf(`export async function ${name}(`);
    const next = src.indexOf('export async function', start + 10);
    const body = src.slice(start, next === -1 ? undefined : next);
    assert.match(body, /await requireAdmin\(\)/, `${name}이 관리자 세션을 확인하지 않는다`);
  }
});

test('반 입장 비밀번호와 관리자 비밀번호를 원문으로 저장하지 않는다', () => {
  const actions = readSource('src/server/admin/actions.ts');
  assert.match(actions, /entryPassword:\s*await hashPassword\(/);
  const auth = readSource('src/server/admin/auth.ts');
  assert.match(auth, /passwordHash:\s*await hashPassword\(/);
  const studentAuth = readSource('src/server/auth/index.ts');
  assert.match(studentAuth, /verifyPassword\(/, '학생 입장이 해시로 대조한다');
});
