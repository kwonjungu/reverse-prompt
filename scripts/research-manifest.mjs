/**
 * 연구용 manifest 생성 — 문항·지시문·코드 해시를 한 파일로 모은다.
 *
 * 사용법:
 *   npm run manifest                       # research-manifest.json 생성
 *   node scripts/research-manifest.mjs --out 경로.json
 *
 * 담는 것: questionId·kind·band·durationSeconds·imageSha256(명세/실측)·cueVersion·
 * rubricVersion·status·approvedAt·cuesLoaded·cueHash·promptHash·codeCommit·생성 시각.
 * 담지 않는 것: 문항별 단서·경계·앵커의 본문, 검사 이미지 자체, 학교 실명 대응표,
 * 자산 디렉터리의 실제 경로 문자열.
 *
 * 자산이 없어도 실패하지 않는다. 누락 항목을 missing과 readiness.blockers에 적는다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §9
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), '..');

// entries.ts는 TypeScript라 tsx 로더가 필요하다. package.json의 실행 명령을 바꾸지
// 않고 쓰기 위해, 로더가 없으면 한 번만 스스로를 다시 띄운다.
if (!process.env.RESEARCH_MANIFEST_TSX) {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', SELF, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, RESEARCH_MANIFEST_TSX: '1' } },
  );
  if (result.error) {
    console.error('tsx 로더로 다시 실행하지 못했습니다:', result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

const MANIFEST_VERSION = 'v7.0';

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 커밋 해시. git 명령을 돌리지 않고 환경 변수와 .git/HEAD만 읽는다. */
function codeCommit() {
  const fromEnv =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_COMMIT_SHA ||
    process.env.CODE_COMMIT;
  if (fromEnv) return fromEnv.trim();
  try {
    const head = readFileSync(join(ROOT, '.git', 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref: ')) {
      const refPath = join(ROOT, '.git', head.slice(5).trim());
      if (existsSync(refPath)) return readFileSync(refPath, 'utf8').trim();
      const packed = join(ROOT, '.git', 'packed-refs');
      if (existsSync(packed)) {
        const want = head.slice(5).trim();
        for (const line of readFileSync(packed, 'utf8').split('\n')) {
          const [hash, ref] = line.trim().split(' ');
          if (ref === want) return hash;
        }
      }
      return 'unknown';
    }
    return head;
  } catch {
    return 'unknown';
  }
}

/** 자산 디렉터리 안의 경로. 바깥을 가리키면 null. */
function assetPath(dir, name) {
  if (!dir) return null;
  const base = resolve(dir);
  const target = resolve(base, name);
  const rel = relative(base, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
}

/** 키 순서를 고정해 같은 내용이면 같은 해시가 나오게 한다. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

async function main() {
  const registryDir = join(ROOT, 'src', 'server', 'registry');
  const entriesModule = await import(pathToFileURL(join(registryDir, 'entries.ts')).href);
  const coreModule = await import(pathToFileURL(join(registryDir, 'core.ts')).href);
  const { ASSESSMENT_ORDER, baseEntries, collectBlockers, assessmentImageFile } = entriesModule;
  const { parseCuePack } = coreModule;

  const missing = [];

  /* ── 지시문·코드 해시 ── */
  const hashedSources = [
    'src/lib/evaluation-prompt.ts',
    'src/lib/scoring.ts',
    'src/lib/questions.ts',
    'src/server/registry/entries.ts',
    'src/server/registry/core.ts',
  ];
  const promptSources = hashedSources.map((rel) => {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) {
      missing.push(`지시문·코드 파일 없음: ${rel}`);
      return { path: rel, sha256: null };
    }
    return { path: rel, sha256: sha256(readFileSync(abs)) };
  });
  const promptHash = sha256(
    Buffer.from(promptSources.map((s) => `${s.path}:${s.sha256 ?? 'missing'}`).join('\n'), 'utf8'),
  );

  /* ── 비공개 단서 팩 ── */
  const assetDir = (process.env.RESEARCH_ASSET_DIR || '').trim();
  if (!assetDir) missing.push('RESEARCH_ASSET_DIR 미설정');

  let cuePackRaw = null;
  let cuePackLoaded = false;
  let cuePackError = null;
  const cuePackFile = assetPath(assetDir, 'cue-pack.json');
  if (assetDir && !cuePackFile) {
    cuePackError = '자산 디렉터리 바깥을 가리키는 경로입니다.';
  } else if (cuePackFile && existsSync(cuePackFile)) {
    try {
      cuePackRaw = JSON.parse(readFileSync(cuePackFile, 'utf8'));
      cuePackLoaded = true;
    } catch (e) {
      cuePackError = 'cue-pack.json을 JSON으로 읽지 못했습니다.';
    }
  } else if (assetDir) {
    cuePackError = 'cue-pack.json을 찾지 못했습니다.';
  } else {
    cuePackError = 'RESEARCH_ASSET_DIR이 없어 단서 팩을 찾지 못했습니다.';
  }
  if (cuePackError) missing.push(`단서 팩: ${cuePackError}`);

  // 레지스트리와 같은 검증을 쓴다. 필수 항목이 빈 단서는 적재된 것으로 세지 않는다.
  const parsedPack = cuePackLoaded ? parseCuePack(cuePackRaw) : { questions: {}, invalid: {} };
  const packQuestions = parsedPack.questions;
  const packInvalid = parsedPack.invalid;
  for (const [questionId, reason] of Object.entries(packInvalid)) {
    missing.push(`단서 실격(${questionId}): ${reason}`);
  }

  /** 단서 본문 대신 해시만 남긴다. */
  function cueHashOf(questionId) {
    const cues = packQuestions[questionId];
    if (!cues) return null;
    return sha256(Buffer.from(canonicalJson(cues), 'utf8'));
  }

  /* ── 이미지 ── */
  const imagesMissing = [];
  const imageMismatch = [];

  function imageStatusOf(entry) {
    if (entry.kind === 'assessment') {
      const rel = assessmentImageFile(entry.questionId);
      const abs = rel ? assetPath(assetDir, rel) : null;
      if (!abs || !existsSync(abs)) {
        imagesMissing.push(entry.questionId);
        missing.push(`검사 이미지 없음: ${entry.questionId}`);
        return { present: false, sha256Actual: null, matchesSpec: null };
      }
      const actual = sha256(readFileSync(abs));
      const matches = actual === entry.imageSha256;
      if (!matches) {
        imageMismatch.push(entry.questionId);
        missing.push(`검사 이미지 해시 불일치: ${entry.questionId}`);
      }
      return { present: true, sha256Actual: actual, matchesSpec: matches };
    }
    const abs = join(ROOT, 'public', 'questions', `${entry.questionId}.jpg`);
    if (!existsSync(abs)) {
      missing.push(`연습 이미지 없음: ${entry.questionId}`);
      return { present: false, sha256Actual: null, matchesSpec: null };
    }
    // 연습 문항은 명세 해시를 두지 않으므로 실측값만 기록한다.
    return { present: true, sha256Actual: sha256(readFileSync(abs)), matchesSpec: null };
  }

  const entries = baseEntries();
  const items = entries.map((entry) => {
    const image = imageStatusOf(entry);
    const cueHash = cueHashOf(entry.questionId);
    if (entry.kind === 'assessment' && !cueHash) missing.push(`검사 문항 단서 없음: ${entry.questionId}`);
    return {
      questionId: entry.questionId,
      kind: entry.kind,
      band: entry.band,
      lesson: entry.lesson,
      durationSeconds: entry.durationSeconds,
      imageVersion: entry.imageVersion,
      imageSha256Spec: entry.imageSha256 || null,
      imageSha256Actual: image.sha256Actual,
      imagePresent: image.present,
      imageMatchesSpec: image.matchesSpec,
      cueVersion: entry.cueVersion,
      rubricVersion: entry.rubricVersion,
      status: entry.status,
      approvedAt: entry.approvedAt,
      allowedSessionTypes: entry.allowedSessionTypes,
      cuesLoaded: Boolean(cueHash),
      cueHash,
    };
  });

  const assessmentCuesMissing = ASSESSMENT_ORDER.filter((id) => !cueHashOf(id));

  const consentVersion = (process.env.CONSENT_VERSION || '').trim();
  const irbApproval = (process.env.IRB_APPROVAL || '').trim();
  const modelAccessVerified = process.env.EVALUATION_MODEL_VERIFIED === 'true';
  if (!consentVersion) missing.push('CONSENT_VERSION 미설정');
  if (!irbApproval) missing.push('IRB_APPROVAL 미설정');
  if (!modelAccessVerified) missing.push('EVALUATION_MODEL_VERIFIED 미설정');

  const blockers = collectBlockers({
    researchAssetDir: assetDir,
    consentVersion,
    irbApproval,
    modelAccessVerified,
    cuePackLoaded,
    assessmentCuesMissing: [...assessmentCuesMissing],
    assessmentImagesMissing: imagesMissing,
    assessmentImageHashMismatch: imageMismatch,
  });

  const manifest = {
    manifestVersion: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    codeCommit: codeCommit(),
    promptHash,
    promptSources,
    // 실제 디렉터리 경로는 로컬 정보라 남기지 않고 설정 여부만 남긴다.
    researchAssetDirConfigured: Boolean(assetDir),
    cuePack: {
      loaded: cuePackLoaded,
      error: cuePackError,
      cueVersion: cuePackRaw && typeof cuePackRaw.cueVersion === 'string' ? cuePackRaw.cueVersion : null,
      rubricVersion:
        cuePackRaw && typeof cuePackRaw.rubricVersion === 'string' ? cuePackRaw.rubricVersion : null,
    },
    operationalValues: {
      consentVersion: consentVersion || null,
      irbApproval: irbApproval || null,
      modelId: (process.env.EVALUATION_MODEL_ID || '').trim() || null,
      modelAccessVerified,
    },
    assessmentOrder: [...ASSESSMENT_ORDER],
    items,
    readiness: { researchReady: blockers.length === 0, blockers },
    missing,
    note:
      '단서·앵커 본문과 검사 이미지는 이 파일에 담지 않는다. 단서는 해시로만 기록한다. ' +
      'candidate 상태와 비어 있는 승인·계약 값은 그대로 두며 코드가 채우지 않는다.',
  };

  const outPath = argValue('--out') || join(ROOT, 'research-manifest.json');
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`manifest 생성: ${outPath}`);
  console.log(`문항 ${items.length}개, researchReady=${manifest.readiness.researchReady}`);
  if (blockers.length) {
    console.log('연구 시작을 막는 사유:');
    for (const b of blockers) console.log(`  - ${b}`);
  }
  if (missing.length) {
    console.log(`누락 항목 ${missing.length}건은 manifest의 missing 목록에 있습니다.`);
  }
}

main().catch((e) => {
  console.error('manifest 생성 실패:', e?.message ?? e);
  process.exit(1);
});
