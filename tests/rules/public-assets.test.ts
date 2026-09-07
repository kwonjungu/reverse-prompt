/**
 * 공개 경로·소스에 비공개 연구 자산이 섞이지 않았는지 훑는 시험.
 *
 * 대응: 수용시험 12. 다만 이 시험은 저장소의 정적 점검일 뿐이며,
 * 배포된 번들·소스맵·콘솔 상태를 대신 확인해 주지 않는다.
 * 또한 학생이 허용된 검사 중 화면의 이미지를 복사하는 것까지 막지는 못한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test('public 경로에 검사 이미지(T1·T2_v7·T3)가 없다', () => {
  const files = walk(path.join(ROOT, 'public')).map((f) => path.basename(f));
  for (const name of ['T1.png', 'T2.png', 'T2_v7.png', 'T3.png']) {
    assert.equal(files.includes(name), false, `public에 ${name}이 있다`);
  }
});

test('public 경로에 단서·앵커 문서가 없다', () => {
  const files = walk(path.join(ROOT, 'public')).map((f) => path.basename(f).toLowerCase());
  for (const file of files) {
    assert.equal(file.includes('채점명세'), false, `public에 ${file}이 있다`);
    assert.equal(file.includes('검사문항'), false, `public에 ${file}이 있다`);
  }
});

test('저장소에 학교 실명 대응표 파일이 없다', () => {
  const targets = ['src', 'public', 'docs', 'scripts'];
  for (const target of targets) {
    for (const full of walk(path.join(ROOT, target))) {
      const name = path.basename(full).toLowerCase();
      assert.equal(name.includes('대응표'), false, `${full}이 있다`);
      assert.equal(name.includes('roster'), false, `${full}이 있다`);
    }
  }
});

/**
 * 검사 단서 노출 점검.
 *
 * 표지 문자열을 이 파일에 적어 두면 그 목록 자체가 단서를 공개하게 된다.
 * 그래서 비공개 단서 팩(RESEARCH_ASSET_DIR/cue-pack.json)이 있을 때에만
 * 그 안의 실제 문장을 표지로 삼아 저장소를 훑는다. 팩이 없으면 훑지 않고
 * 건너뛴다. 건너뛴 것은 통과가 아니다.
 */

/** 팩에서 표지로 쓸 문장·낱말을 모은다. 너무 짧은 조각은 오탐이 많아 뺀다. */
function markersFromCuePack(pack: unknown): string[] {
  const out = new Set<string>();
  const push = (v: unknown) => {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t.length >= 4) out.add(t);
    }
  };
  const questions = (pack as { questions?: Record<string, unknown> })?.questions ?? {};
  for (const q of Object.values(questions)) {
    const cues = q as Record<string, unknown>;
    for (const key of [
      'coreObjects',
      'requiredAttributes',
      'requiredContext',
      'acceptedExpressions',
      'contradictions',
    ]) {
      const list = cues[key];
      if (Array.isArray(list)) list.forEach(push);
    }
    const anchors = cues.anchors as Record<string, Record<string, unknown>> | undefined;
    for (const byLevel of Object.values(anchors ?? {})) {
      for (const text of Object.values(byLevel ?? {})) push(text);
    }
  }
  return [...out];
}

function loadCuePack(): unknown | null {
  const dir = process.env.RESEARCH_ASSET_DIR?.trim();
  if (!dir) return null;
  const file = path.join(dir, 'cue-pack.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

test('저장소의 어떤 텍스트 파일에도 검사 단서 문장이 없다', (t) => {
  const pack = loadCuePack();
  if (!pack) {
    t.skip('RESEARCH_ASSET_DIR의 cue-pack.json이 없어 실제 단서로 훑지 못했다 — 미실행');
    return;
  }
  const markers = markersFromCuePack(pack);
  assert.ok(markers.length > 0, '단서 팩에서 표지 문장을 하나도 얻지 못했다');

  // src/server도 검사한다. 단서는 코드가 아니라 RESEARCH_ASSET_DIR에서만 읽어야 한다.
  const targets = ['src', 'tests', 'scripts', 'docs', 'research-assets', 'public'];
  const exts = ['.ts', '.tsx', '.mjs', '.js', '.json', '.md', '.rules'];
  for (const target of targets) {
    const dir = path.join(ROOT, target);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      if (!exts.some((e) => file.endsWith(e))) continue;
      const text = readFileSync(file, 'utf8');
      for (const needle of markers) {
        assert.equal(
          text.includes(needle),
          false,
          `${path.relative(ROOT, file)}에 검사 단서 문장이 그대로 있다`
        );
      }
    }
  }
});

/**
 * 단서 팩이 없어도 늘 돌아가는 구조 점검.
 * 실제 단서 문장을 여기에 적지 않고, 단서를 담는 파일이 저장소에 들어왔는지만 본다.
 */
test('비공개 단서 팩이 저장소에 커밋되지 않았다', () => {
  const targets = ['src', 'tests', 'scripts', 'docs', 'research-assets', 'public'];
  for (const target of targets) {
    const dir = path.join(ROOT, target);
    if (!existsSync(dir)) continue;
    for (const full of walk(dir)) {
      const name = path.basename(full);
      assert.notEqual(name, 'cue-pack.json', `${path.relative(ROOT, full)}이 커밋되어 있다`);
    }
  }
});

test('예시 단서 팩은 빈 껍데기여야 한다', () => {
  const file = path.join(ROOT, 'research-assets', 'cue-pack.example.json');
  if (!existsSync(file)) return;
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const markers = markersFromCuePack(parsed);
  assert.deepEqual(markers, [], '예시 파일에 실제 단서 문장이 들어 있다');
});
