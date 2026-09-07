/**
 * 공개 경로·소스에 비공개 연구 자산이 섞이지 않았는지 훑는 시험.
 *
 * 대응: 수용시험 12. 다만 이 시험은 저장소의 정적 점검일 뿐이며,
 * 배포된 번들·소스맵·콘솔 상태를 대신 확인해 주지 않는다.
 * 또한 학생이 허용된 검사 중 화면의 이미지를 복사하는 것까지 막지는 못한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
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

test('클라이언트 번들에 들어가는 소스에 검사 앵커 문자열이 없다', () => {
  // 서버 전용 경로(src/server)는 제외한다. 그 아래에서만 비공개 자산을 다룬다.
  const suspicious = ['초록 물뿌리개', '노란 상의', '건물 사이 골목'];
  const files = walk(path.join(ROOT, 'src')).filter(
    (f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes(`${path.sep}server${path.sep}`)
  );
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const needle of suspicious) {
      assert.equal(
        text.includes(needle),
        false,
        `${path.relative(ROOT, file)}에 검사 단서 문자열 '${needle}'이 있다`
      );
    }
  }
});
