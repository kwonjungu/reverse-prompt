/**
 * 전송 전 개인정보 점검의 순수 함수 시험.
 *
 * 확인 사항
 *  - 의심 유형을 찾으면 외부 전송을 멈추고 교사 확인을 받는다.
 *  - 로그에 원문 조각이 남지 않는다.
 *  - 통과가 '개인정보 완전 제거'를 뜻하지 않는다는 문구가 있다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { privacy, detectPiiTypes, toPiiLogEntry, PII_CHECK_VERSION } from '@/server/privacy';

test('개인정보가 없는 응답은 통과한다', () => {
  const result = privacy.checkBeforeSend('초록 물뿌리개가 있고 긴 주둥이 끝이 넓게 퍼져 있다.');
  assert.equal(result.decision, 'pass');
  assert.deepEqual(result.matchedTypes, []);
  assert.equal(result.checkVersion, PII_CHECK_VERSION);
});

test('통과 문구가 완전 제거를 뜻하지 않는다고 밝힌다', () => {
  const result = privacy.checkBeforeSend('노란 옷을 입은 아이가 종이를 접는다.');
  assert.equal(result.decision, 'pass');
  assert.match(result.notice, /아니/);
  assert.ok(result.notice.includes('보조'));
});

test('전화번호를 찾으면 교사 확인으로 멈춘다', () => {
  const result = privacy.checkBeforeSend('내 번호는 010-1234-5678 이야');
  assert.equal(result.decision, 'hold_for_teacher');
  assert.ok(result.matchedTypes.includes('phone'));
});

test('학교명을 찾는다', () => {
  const result = privacy.checkBeforeSend('나는 백암초등학교에 다녀요');
  assert.equal(result.decision, 'hold_for_teacher');
  assert.ok(result.matchedTypes.includes('school'));
});

test('주소를 찾는다', () => {
  assert.ok(detectPiiTypes('우리 집은 행복로 12-3 이에요').includes('address'));
  assert.ok(detectPiiTypes('101동 902호에 살아요').includes('address'));
});

test('생년월일을 찾는다', () => {
  assert.ok(detectPiiTypes('2014년 3월 5일에 태어났어요').includes('birthdate'));
});

test('주민등록번호 형태를 찾는다', () => {
  assert.ok(detectPiiTypes('140305-3123456').includes('national_id'));
});

test('계정·연락 수단을 찾는다', () => {
  assert.ok(detectPiiTypes('메일은 abc@example.com 이야').includes('account'));
  assert.ok(detectPiiTypes('카톡 아이디는 sunny2014').includes('account'));
});

test('이름을 찾는다', () => {
  assert.ok(detectPiiTypes('제 이름은 김민준입니다').includes('name'));
  assert.ok(detectPiiTypes('이름: 이서연').includes('name'));
});

test('출석번호·학번을 찾는다', () => {
  assert.ok(detectPiiTypes('출석번호는 12번이에요').includes('student_number'));
});

test('탐지 결과 로그에 원문 조각이 남지 않는다', () => {
  const text = '내 번호는 010-1234-5678 이고 백암초등학교에 다녀요';
  const entry = toPiiLogEntry(privacy.checkBeforeSend(text));
  const serialized = JSON.stringify(entry);
  assert.equal(serialized.includes('010'), false);
  assert.equal(serialized.includes('1234'), false);
  assert.equal(serialized.includes('백암'), false);
  assert.deepEqual(Object.keys(entry).sort(), ['checkVersion', 'decision', 'matchedTypes']);
});

test('멈춤 안내에도 한계 문구가 함께 있다', () => {
  const result = privacy.checkBeforeSend('전화번호는 010-0000-0000');
  assert.equal(result.decision, 'hold_for_teacher');
  assert.ok(result.notice.includes('보조'));
});

// ── 비밀키·인증토큰 ─────────────────────────────────────────

test('API 키가 섞이면 예외를 던진다', () => {
  assert.throws(
    () => privacy.assertNoSecrets({ note: 'AIzaSyA1234567890abcdefghijklmnopqrstuvw' }),
    /자격정보/
  );
});

test('원시 인증토큰이 섞이면 예외를 던진다', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
  assert.throws(() => privacy.assertNoSecrets({ auth: jwt }), /자격정보/);
  assert.throws(
    () => privacy.assertNoSecrets({ key: '-----BEGIN PRIVATE KEY-----\nabc\n' }),
    /자격정보/
  );
});

test('자격정보 필드 이름만 있어도 막는다', () => {
  assert.throws(() => privacy.assertNoSecrets({ private_key: 'x' }), /자격정보/);
});

test('예외 메시지에 값 자체를 넣지 않는다', () => {
  const secret = 'AIzaSyA1234567890abcdefghijklmnopqrstuvw';
  try {
    privacy.assertNoSecrets({ note: secret });
    assert.fail('예외가 발생해야 한다');
  } catch (e) {
    assert.equal(String((e as Error).message).includes(secret), false);
    assert.ok(String((e as Error).message).includes('google_api_key'));
  }
});

test('정상 payload는 통과한다', () => {
  privacy.assertNoSecrets({
    text: '초록 물뿌리개가 있다.',
    questionId: 'T1',
    band: 'A',
  });
});
