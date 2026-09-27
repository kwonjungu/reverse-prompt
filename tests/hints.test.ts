/**
 * 문항별 힌트(논문 v12) 규칙 시험.
 *
 *   1. L01~L36 모두 초안이 있고 다른 문항 ID는 없다
 *   2. 검수를 마치지 않은 힌트는 학생 화면(PRACTICE_QUESTIONS.hint)에 나가지 않는다
 *   3. 힌트는 정답 값(색 이름·개수)을 적지 않는다 — 무엇을 써야 하는지만 말한다
 *   4. 검수표 문서가 원본과 어긋나지 않는다
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { PRACTICE_HINTS, reviewedHintOf } from '../src/lib/practice-hints';
import { PRACTICE_QUESTIONS } from '../src/lib/questions';

const IDS = Array.from({ length: 36 }, (_, i) => `L${String(i + 1).padStart(2, '0')}`);

test('36개 문항 모두 힌트 초안이 있다', () => {
  assert.deepEqual(Object.keys(PRACTICE_HINTS).sort(), IDS);
  for (const id of IDS) {
    const hint = PRACTICE_HINTS[id].hint;
    assert.ok(hint === null || hint.trim().length > 10, `${id} 힌트가 너무 짧다`);
  }
});

test('검수를 마치지 않은 힌트는 학생 화면에 나가지 않는다', () => {
  for (const q of PRACTICE_QUESTIONS) {
    const id = `L${String(q.level).padStart(2, '0')}`;
    const draft = PRACTICE_HINTS[id];
    if (!draft.reviewed) assert.equal(q.hint, null, `${id} 초안이 화면에 나간다`);
    else assert.equal(q.hint, draft.hint);
    // 차시 공통 안내는 그대로 남아 대체 문구로 쓰인다.
    assert.ok(q.rubric.length > 0);
  }
  assert.equal(reviewedHintOf('L99'), null);
});

test('힌트는 정답 값(색 이름·개수)을 적지 않는다', () => {
  const colors = ['빨간', '빨강', '노란', '노랑', '파란', '파랑', '초록', '갈색', '주황', '보라', '회색', '흰', '하얀', '검은', '은색', '분홍'];
  const counts = ['한 개', '두 개', '세 개', '네 개', '다섯', '한 마리', '두 명', '한 명', '두 아이', '세 마리'];
  for (const id of IDS) {
    const hint = PRACTICE_HINTS[id].hint ?? '';
    assert.equal(/[0-9]/.test(hint), false, `${id}에 숫자가 있다`);
    for (const word of [...colors, ...counts]) {
      assert.equal(hint.includes(word), false, `${id}에 "${word}"가 있다`);
    }
  }
});

test('C밴드 힌트는 분위기를 근거와 함께 쓰라고 안내한다', () => {
  for (const id of IDS.slice(24)) {
    assert.match(PRACTICE_HINTS[id].hint ?? '', /무엇을 보고 그렇게 느꼈는지/, id);
  }
  for (const id of IDS.slice(0, 24)) {
    assert.equal(/분위기/.test(PRACTICE_HINTS[id].hint ?? ''), false, `${id}는 C밴드가 아니다`);
  }
});

test('검수표 문서가 원본 힌트와 어긋나지 않는다', () => {
  const doc = readFileSync(path.join(process.cwd(), 'docs', 'practice-hints-review.md'), 'utf8');
  for (const id of IDS) {
    const hint = PRACTICE_HINTS[id].hint;
    if (hint) assert.ok(doc.includes(hint.replace(/\|/g, '\\|')), `${id}가 검수표와 다르다 — npm run hints:table`);
  }
});
