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
  const result = privacy.checkBeforeSend('노란 세모 블록의 밑면이 넓고 위쪽 꼭짓점이 뾰족하다.');
  assert.equal(result.decision, 'pass');
  assert.deepEqual(result.matchedTypes, []);
  assert.equal(result.checkVersion, PII_CHECK_VERSION);
});

test('통과 문구가 완전 제거를 뜻하지 않는다고 밝힌다', () => {
  const result = privacy.checkBeforeSend('아이가 책상 앞에 앉아 있다.');
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
  assert.ok(detectPiiTypes('내 이름은 민수예요').includes('name'), '사람으로 밝힌 이름은 성씨가 없어도 잡는다');
  assert.ok(detectPiiTypes('저는 김민수야').includes('name'));
  assert.ok(detectPiiTypes('김민수 선생님이 계세요').includes('name'));
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
    text: '노란 세모 블록이 있다.',
    questionId: 'T1',
    band: 'A',
  });
});

/* ─────────────────── D7 그림 묘사 문장의 오탐 (실측 사례) ───────────────────
 * 아래 문장은 감사에서 실제로 차단된 정상 응답이다. 점검 중에는 재시도가 없으므로
 * 오탐 하나가 그대로 결측이 된다. 규칙을 되돌리면 이 시험이 먼저 깨진다.
 * 모두 합성 문장이며 검사 문항의 실제 단서·앵커를 쓰지 않는다.
 */

const PICTURE_DESCRIPTIONS = [
  '가로 3칸 세로 2칸',
  '우리 집은 파란색이에요',
  '강아지 이름은 초코',
  '노란 옷을 입은 이모님',
  '이모님이 노란 옷을 입고 계세요',
  '겨울 장면이에요',
  '이건 정말 최고예요',
  '이 동물은 고양이라고 해요',
  '친구 머리가 길어요',
  '친구 두마리가 놀고 있어요',
  '친구 운동 좋아해요',
  '강아지 두 마리가 마당에서 뛰어요',
  '앞으로 3걸음 걸어가요',
  '왼쪽 위에 2층 건물이 있어요',
  '책상 위 연필 5자루가 나란히 놓여 있어요',
  '노을이 지는 바닷가 풍경이에요',
  '아침 햇살이 교실 창문으로 들어와요',
  '학교 운동장에서 아이들이 뛰어요',
  '유치원 가방을 멘 아이가 있어요',
  '길이 3미터쯤 되어 보여요',
  '큰길 옆에 나무가 서 있어요',
  '가로로 긴 창문이 있어요',
  '세로로 줄이 세 개 있어요',
  '아이가 이름표를 달고 있어요',
  '고모가 준 인형이에요',
  '2층 집이 한 채 있어요',
  '인스타 사진 같은 그림이에요',
  '나는 파란색이 좋아요',
  '저는 이 그림이 좋아요',
  '집은 언덕 위에 있어요',
];

test('D7 — 그림 묘사 문장을 개인정보로 막지 않는다', () => {
  for (const text of PICTURE_DESCRIPTIONS) {
    const result = privacy.checkBeforeSend(text);
    assert.equal(
      result.decision,
      'pass',
      `정상 응답이 막혔다: "${text}" → ${result.matchedTypes.join(',')}`
    );
  }
});

test('D7 — 실제 개인정보는 계속 막는다', () => {
  const cases: [string, string][] = [
    ['전화번호는 010-1234-5678', 'phone'],
    ['우리 집은 부산시 해운대구 좌동이에요', 'address'],
    ['우리 집은 행복로 12-3 이에요', 'address'],
    ['사랑로 25번길 3', 'address'],
    ['서울특별시 강남구 역삼동에 살아요', 'address'],
    ['101동 902호에 살아요', 'address'],
    ['나는 백암초등학교에 다녀요', 'school'],
    ['학교 이름은 백암초예요', 'school'],
    ['생일은 2015년 3월 4일', 'birthdate'],
    ['140305-3123456', 'national_id'],
    ['메일은 abc@example.com 이야', 'account'],
    ['카톡 아이디는 sunny2014', 'account'],
    ['출석번호는 12번이에요', 'student_number'],
    ['제 이름은 김민준입니다', 'name'],
  ];
  for (const [text, type] of cases) {
    const result = privacy.checkBeforeSend(text);
    assert.equal(result.decision, 'hold_for_teacher', `놓쳤다: "${text}"`);
    assert.ok(result.matchedTypes.includes(type), `${text} → ${result.matchedTypes.join(',')}`);
  }
});

/**
 * 알려진 미탐. 이 규칙은 '개인정보를 밝히는 진술'을 잡으며 낱말 하나로 적힌 이름은
 * 판별하지 못한다. 통과가 개인정보 없음을 뜻하지 않는다는 고지를 그대로 두는 이유다.
 * 여기서 통과한다는 사실을 시험으로 고정해 두어, 나중에 이 한계를 알고 다루게 한다.
 */
test('D7 — 알려진 미탐을 사실대로 남긴다(통과를 안전으로 읽지 않는다)', () => {
  const knownMisses = ['민수', '친구 김민수랑 놀았어요'];
  for (const text of knownMisses) {
    assert.equal(privacy.checkBeforeSend(text).decision, 'pass');
  }
  // 그래서 통과 문구가 '완전 제거'로 읽히지 않아야 한다.
  assert.ok(privacy.checkBeforeSend('민수').notice.includes('아니'));
});

test('D7 — 규칙을 고쳤으므로 점검 버전이 올라가 있다', () => {
  // 저장된 점검 기록이 어떤 규칙으로 판정한 것인지 구별할 수 있어야 한다.
  assert.notEqual(PII_CHECK_VERSION, 'pii-v7.0');
  assert.match(PII_CHECK_VERSION, /^pii-v7\./);
});
