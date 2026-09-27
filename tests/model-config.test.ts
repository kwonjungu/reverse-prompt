/**
 * 채점 모델 ID는 한 곳(src/server/config.ts)에서만 정한다(논문 v12-2 H1).
 *
 *   - src 아래에서 Gemini 모델 이름을 적은 곳은 config.ts 하나뿐이다(이미지 제작 스크립트는 채점과 무관한 별도 모델).
 *   - README·CLAUDE.md가 적은 기본값이 config.ts의 기본값과 같다.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

const MODEL_NAME = /gemini-\d/;
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

test('채점 모델 이름은 src/server/config.ts 한 곳에만 있다', () => {
  const hits = walk(path.join(ROOT, 'src'))
    .filter((f) => MODEL_NAME.test(readFileSync(f, 'utf8')))
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
  assert.deepEqual(hits, ['src/server/config.ts']);
});

test('문서가 적은 기본 모델이 config.ts의 기본값과 같다', () => {
  const m = /\|\|\s*'([^']+)'/.exec(read('src/server/config.ts').split('EVALUATION_MODEL_ID =')[1] ?? '');
  assert.ok(m, 'config.ts에서 기본 모델을 찾지 못했다');
  const defaultModel = m[1];
  assert.equal(defaultModel, 'googleai/gemini-3.8-flash');
  for (const doc of ['README.md', 'CLAUDE.md']) {
    const text = read(doc);
    const named = [...text.matchAll(/googleai\/gemini-[\w.-]+/g)].map((x) => x[0]);
    assert.ok(named.length > 0, `${doc}에 기본 모델이 없다`);
    for (const n of named) assert.equal(n, defaultModel, `${doc}가 다른 모델(${n})을 적었다`);
  }
});
