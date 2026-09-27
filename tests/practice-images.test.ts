/**
 * 연습 그림 36장과 제작 기록 (2026-09-27 12장 교체).
 *
 *   - public/questions/L01~L36.jpg는 모두 1024×1024 JPEG다.
 *   - 다시 만든 12장의 제작 프롬프트 기록은 docs/practice-image-audit.md 2절 문장 + 3절 공통 문구 그대로다
 *     (L12·L36은 다시 만들 때 덧붙인 한 문장이 끝에 더 있다).
 *   - 교체표의 새 제목이 src/lib/questions.ts의 제목과 같다.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { PRACTICE_QUESTIONS } from '@/lib/questions';

const ROOT = process.cwd();
/** 줄바꿈을 \n으로 맞춘다(윈도우 CRLF 체크아웃에서도 문서 구간 찾기가 같게, 99-1 C2). */
const normalizeNewlines = (text: string) => text.replace(/\r\n?/g, '\n');
const DOC = normalizeNewlines(readFileSync(path.join(ROOT, 'docs/practice-image-audit.md'), 'utf8'));
const REMADE_IDS = ['L03', 'L08', 'L12', 'L15', 'L17', 'L25', 'L27', 'L28', 'L30', 'L31', 'L33', 'L36'];
const idOf = (level: number) => `L${String(level).padStart(2, '0')}`;

/** server-only를 빈 모듈로 바꾼다. 스크립트 preload와 같은 방법이다. */
function stubServerOnly(): void {
  const req = createRequire(import.meta.url);
  const resolved = req.resolve('server-only');
  (req.cache as unknown as Record<string, unknown>)[resolved] = {
    id: resolved, filename: resolved, loaded: true, children: [], paths: [], exports: {},
  };
}

async function sourcePrompts() {
  stubServerOnly();
  return import('@/server/registry/practice-source-prompts');
}

function docBlock(label: string, doc: string = DOC): string {
  const m = new RegExp(`\\*\\*${label}\\*\\*[^\\n]*\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\``).exec(doc);
  assert.ok(m, `문서에 ${label} 프롬프트가 없다`);
  return m[1].trim();
}

/** 문서 2절 문장의 [STYLE-…] 자리에 3절 공통 문구를 넣은 것 — 생성 때 보낸 문자열의 앞부분 */
function docPrompt(id: string): string {
  return docBlock(id)
    .replace('[STYLE-OBJECT]', docBlock('\\[STYLE-OBJECT\\]'))
    .replace('[STYLE-SCENE]', docBlock('\\[STYLE-SCENE\\]'));
}

/** JPEG의 SOF 표식에서 가로·세로를 읽는다. */
function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

test('연습 그림 36장은 모두 1024×1024 JPEG다', () => {
  assert.equal(PRACTICE_QUESTIONS.length, 36);
  for (const q of PRACTICE_QUESTIONS) {
    const file = path.join(ROOT, 'public/questions', `${idOf(q.level)}.jpg`);
    assert.deepEqual(jpegSize(readFileSync(file)), { width: 1024, height: 1024 }, idOf(q.level));
  }
});

test('다시 만든 12장의 제작 기록은 문서의 프롬프트 그대로다', async () => {
  const { REMADE_PRACTICE_QUESTIONS, practiceSourcePrompt } = await sourcePrompts();
  assert.deepEqual([...REMADE_PRACTICE_QUESTIONS].sort(), REMADE_IDS);
  for (const id of REMADE_IDS) {
    const recorded = practiceSourcePrompt(id);
    assert.ok(recorded, id);
    const expected = docPrompt(id);
    assert.ok(!/\[STYLE-/.test(expected), id);
    if (id === 'L12' || id === 'L36') {
      // 첫 그림이 어긋나 한 문장을 덧붙여 다시 만들었다.
      assert.ok(recorded.startsWith(`${expected} `) && recorded.length > expected.length + 20, id);
    } else {
      assert.equal(recorded, expected, id);
    }
  }
});

test('연습 36문항 모두 제작 기록이 하나씩 있다', async () => {
  const { allPracticeSourcePrompts } = await sourcePrompts();
  const ids = allPracticeSourcePrompts().map((p) => p.questionId);
  assert.deepEqual(ids, PRACTICE_QUESTIONS.map((q) => idOf(q.level)).sort());
  for (const p of allPracticeSourcePrompts()) assert.ok(p.sourcePrompt.length > 40, p.questionId);
});

test('교체표의 새 제목이 문항 제목과 같다', () => {
  const section = DOC.split('## 2. 교체·다시 그리기 문항')[1]?.split('### 프롬프트')[0] ?? '';
  const rows = [...section.matchAll(/^\| (L\d\d) \| [^|]+ \| ([^|]+) \|$/gm)];
  assert.equal(rows.length, REMADE_IDS.length);
  for (const [, id, cell] of rows) {
    const title = PRACTICE_QUESTIONS.find((q) => idOf(q.level) === id)?.koreanTitle;
    const named = cell.trim().replace(/^\(그대로\)\s*/, '');
    if (!named) continue; // "(그대로)"만 적힌 행은 제목을 바꾸지 않았다
    assert.equal(title, named, id);
  }
});

test('99-1 C2: CRLF로 체크아웃한 문서에서도 프롬프트 구간을 똑같이 찾는다', () => {
  const crlf = DOC.replace(/\n/g, '\r\n');
  for (const id of REMADE_IDS) assert.equal(docBlock(id, normalizeNewlines(crlf)), docBlock(id), id);
});

