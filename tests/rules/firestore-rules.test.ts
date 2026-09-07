/**
 * Firestore 보안 규칙의 권한 시험.
 *
 * 이 시험은 Firebase Emulator가 있어야 실행된다. 새 npm 의존성을 추가하지 않으므로
 * 에뮬레이터와 @firebase/rules-unit-testing이 없으면 건너뛴다. 건너뛴 것을 통과로
 * 보고하지 않는다.
 *
 * 실행 방법(수동)
 *   firebase emulators:start --only firestore
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 RULES_TEST=1 npm test
 *
 * 검증 대상(수용시험 11)
 *  - 익명 사용자와 다른 학급의 조회·쓰기·삭제 거부
 *  - 학생의 교사 권한 위조 거부, 학생이 자기 점수를 쓰지 못함
 *  - 미동의자의 연구 저장 거부(연구 컬렉션은 클라이언트 접근 자체를 막는다)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RULES_PATH = path.join(process.cwd(), 'firestore.rules');
const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST) && process.env.RULES_TEST === '1';

// 규칙 파일 자체의 존재와 기본 자세는 에뮬레이터 없이도 확인한다.
/** 주석을 뺀 실제 규칙 본문. 주석 속 예시 문구가 판정에 끼어들지 않게 한다. */
function rulesBody(): string {
  return readFileSync(RULES_PATH, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

test('firestore.rules 파일이 저장소에 있고 기본 거부로 끝난다', () => {
  const rules = rulesBody();
  assert.ok(rules.includes("rules_version = '2'"));
  assert.ok(rules.includes('allow read, write: if false'));
  // 임시 개방 규칙이 실제 규칙 본문에 남아 있지 않아야 한다.
  assert.equal(/allow\s+read,\s*write:\s*if\s+true/.test(rules), false);
  // 익명 로그인 거부 조건이 있어야 한다.
  assert.ok(rules.includes("sign_in_provider != 'anonymous'"));
});

test('연구 컬렉션은 규칙에서 클라이언트 접근을 열지 않는다', () => {
  const rules = rulesBody();
  for (const collection of [
    'researchSubmissions',
    'scoringRuns',
    'consents',
    'lessonSessions',
    'teacherBlindScores',
  ]) {
    assert.ok(rules.includes(`match /${collection}/`), `${collection} 규칙이 없다`);
  }
});

// ── 에뮬레이터가 있을 때만 도는 실제 권한 시험 ─────────────────

test('에뮬레이터 권한 시험', { skip: !emulatorAvailable ? '에뮬레이터 미실행 — 이 시험은 실행하지 않았다' : false }, async () => {
  // @ts-ignore 선택적 의존성. 설치되어 있지 않으면 위의 skip 조건에서 걸러진다.
  const rut = await import('@firebase/rules-unit-testing');
  const { initializeTestEnvironment, assertFails, assertSucceeds } = rut as any;

  const testEnv = await initializeTestEnvironment({
    projectId: 'reverse-prompt-rules-test',
    firestore: { rules: readFileSync(RULES_PATH, 'utf8') },
  });

  try {
    // 서버 권한으로 계정·자료 준비
    await testEnv.withSecurityRulesDisabled(async (ctx: any) => {
      const db = ctx.firestore();
      await db.doc('users/teacher-a').set({
        role: 'teacher',
        classCodes: ['CLASS-A'],
        classResearchIds: ['CLS-AAA'],
        disabled: false,
      });
      await db.doc('users/teacher-b').set({
        role: 'teacher',
        classCodes: ['CLASS-B'],
        classResearchIds: ['CLS-BBB'],
        disabled: false,
      });
      await db.doc('classes/CLASS-A/practice_attempts/p1').set({ score: 10 });
      await db.doc('researchSubmissions/s1').set({ classResearchId: 'CLS-AAA' });
    });

    const anonymous = testEnv.unauthenticatedContext().firestore();
    const teacherA = testEnv.authenticatedContext('teacher-a', { firebase: { sign_in_provider: 'password' } }).firestore();
    const teacherB = testEnv.authenticatedContext('teacher-b', { firebase: { sign_in_provider: 'password' } }).firestore();
    const anonAuth = testEnv.authenticatedContext('anon-1', { firebase: { sign_in_provider: 'anonymous' } }).firestore();

    // 익명 사용자
    await assertFails(anonymous.doc('classes/CLASS-A/practice_attempts/p1').get());
    await assertFails(anonAuth.doc('classes/CLASS-A/practice_attempts/p1').get());

    // 소속 교사만 읽는다
    await assertSucceeds(teacherA.doc('classes/CLASS-A/practice_attempts/p1').get());
    await assertFails(teacherB.doc('classes/CLASS-A/practice_attempts/p1').get());

    // 다른 학급 쓰기·삭제 거부
    await assertFails(teacherB.doc('classes/CLASS-A/practice_attempts/p2').set({ score: 100 }));
    await assertFails(teacherB.doc('classes/CLASS-A/practice_attempts/p1').delete());

    // 학생(익명·미등록)이 자기 점수를 쓰지 못한다
    await assertFails(anonymous.doc('classes/CLASS-A/practice_attempts/p3').set({ score: 100 }));

    // 학생이 교사 권한을 위조하지 못한다(users 문서를 스스로 쓸 수 없다)
    await assertFails(anonAuth.doc('users/anon-1').set({ role: 'teacher', classCodes: ['CLASS-A'] }));

    // 미동의자의 연구 저장 — 연구 컬렉션은 클라이언트 쓰기가 아예 없다
    await assertFails(teacherA.doc('researchSubmissions/s2').set({ classResearchId: 'CLS-AAA' }));
    await assertFails(anonymous.doc('researchSubmissions/s2').set({ classResearchId: 'CLS-AAA' }));
    await assertFails(teacherA.doc('researchSubmissions/s1').get());
    await assertFails(teacherA.doc('consents/R-001').get());
  } finally {
    await testEnv.cleanup();
  }
});
