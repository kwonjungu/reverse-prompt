/**
 * 공개 저장소에 단서성 내용(단서 팩에 무엇을 필수로 둘지·어떤 표현을 인정할지)을 두지 않는다(99-1 A4).
 *
 *   - docs/practice-image-audit.md 5절은 한 줄 안내만 남긴다(원문은 연구자에게 파일로만 넘겼다).
 *   - scripts/print-practice-hints.mjs에는 그림 확인 메모(NOTES)·예전 초안을 두지 않는다(연구자 비공개 hint-review-notes.json으로 옮김).
 *   - 그 스크립트로 만드는 docs/practice-hints-review.md에도 판단 문구가 없다.
 * git 이력에 남은 것은 되돌리지 않았다(이력 정리는 연구자가 정한다).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/** 단서 팩 판단을 드러내는 말. 공통 규칙 설명(예: research-assets/README.md)은 대상이 아니다. */
const CUE_JUDGMENT = [
  /허용할 색 이름/,
  /인정하고|불인정|인정 여부|인정할지/,
  /필수 속성으로 둘지/,
  /필수 여부는 단서/,
  /필수 단서로 두지/,
  /관계 단서를 [^\n]*적을 것/,
  /함께 정할 것/,
  /단서 팩에서 정할/,
];

function assertNoCueJudgment(text: string, where: string) {
  for (const re of CUE_JUDGMENT) assert.doesNotMatch(text, re, `${where}에 단서성 판단(${re})이 남았다`);
}

test('A4: 사진 조사 문서 5절은 한 줄 안내만 남는다', () => {
  const doc = read('docs/practice-image-audit.md');
  const s5 = doc.split('## 5. ')[1]?.split('\n## 6. ')[0] ?? '';
  assert.match(s5, /비공개 단서 팩 작성 메모로 옮김\(연구자 보관\)/);
  assert.doesNotMatch(s5, /\|/, '5절에 표가 남으면 안 된다');
  assertNoCueJudgment(doc, 'docs/practice-image-audit.md');
});

test('A4: 검수 스크립트와 검수표에 그림 메모·필수 여부·허용 판단 문구가 없다', () => {
  const script = read('scripts/print-practice-hints.mjs');
  assert.doesNotMatch(script, /const (NOTES|LEGACY_DRAFTS) =/, '검수 스크립트에 그림 메모가 남아 있다');
  assertNoCueJudgment(script, 'scripts/print-practice-hints.mjs');
  assertNoCueJudgment(read('docs/practice-hints-review.md'), 'docs/practice-hints-review.md');
});
