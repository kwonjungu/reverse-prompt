import 'server-only';

/**
 * 문항 레지스트리 구현. 계약은 ./contract.ts.
 *
 * 여기서만 비공개 연구 자산을 연다. 검사 이미지와 문항별 단서·경계·앵커는
 * 저장소에 커밋하지 않고 RESEARCH_ASSET_DIR 아래에서 읽는다. 판정 규칙 자체는
 * ./core.ts와 ./entries.ts에 있고 이 파일은 파일 시스템·설정 배선만 맡는다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §2, §6
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative as relativePath, resolve } from 'node:path';

import {
  CONSENT_VERSION,
  IRB_APPROVAL,
  MODEL_ACCESS_VERIFIED,
  RESEARCH_ASSET_DIR,
} from '@/server/config';
import { RegistryError } from './contract';
import type { QuestionCues, RegistryEntry } from './contract';
import type { SessionType } from '@/lib/research/types';
import {
  ASSESSMENT_ORDER,
  assessmentImageFile,
  findBaseEntry,
} from './entries';
import {
  createRegistry,
  cuesForSession as coreCuesForSession,
  emptyCuePack,
  listEntries,
  parseCuePack,
  type AssessmentImageStatus,
  type ImageBytes,
  type LoadedCuePack,
} from './core';

const CUE_PACK_FILENAME = 'cue-pack.json';

/** 자산 디렉터리 내부로만 접근한다. 상대 경로로 바깥을 가리키면 거부한다. */
function assetPath(relativeName: string): string | null {
  if (!RESEARCH_ASSET_DIR) return null;
  const base = resolve(RESEARCH_ASSET_DIR);
  const target = resolve(base, relativeName);
  const rel = relativePath(base, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/* ────────────────────────── 단서 팩 ────────────────────────── */

let cachedPack: LoadedCuePack | null = null;
let cachedPackKey = '';

/** 파일 경로와 수정 시각이 같으면 다시 읽지 않는다. */
function cuePackCacheKey(path: string | null): string {
  if (!path) return 'no-dir';
  try {
    const st = statSync(path);
    return `${path}:${st.mtimeMs}:${st.size}`;
  } catch {
    return `${path}:missing`;
  }
}

function readCuePack(): LoadedCuePack {
  const path = assetPath(CUE_PACK_FILENAME);
  const key = cuePackCacheKey(path);
  if (cachedPack && cachedPackKey === key) return cachedPack;

  let pack: LoadedCuePack;
  if (!path) {
    pack = emptyCuePack('RESEARCH_ASSET_DIR이 설정되지 않았습니다.');
  } else if (!existsSync(path)) {
    // 실제 경로 문자열을 오류 문구에 넣지 않는다.
    pack = emptyCuePack(`${CUE_PACK_FILENAME}을 자산 디렉터리에서 찾지 못했습니다.`);
  } else {
    try {
      pack = parseCuePack(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      pack = emptyCuePack(`${CUE_PACK_FILENAME}을 JSON으로 읽지 못했습니다.`);
    }
  }

  cachedPack = pack;
  cachedPackKey = key;
  return pack;
}

/** 팩을 고친 뒤 다시 읽게 한다. 운영 중 재적재와 테스트에서 쓴다. */
export function reloadCuePack(): LoadedCuePack {
  cachedPack = null;
  cachedPackKey = '';
  return readCuePack();
}

/* ────────────────────────── 이미지 ────────────────────────── */

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

function contentTypeOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * 문항 이미지의 실제 파일 경로.
 * 검사 이미지는 비공개 자산 디렉터리에만 둔다. public/ 아래에 두지 않는다.
 * 연습 이미지는 이미 공개된 학습용 파일이므로 저장소의 public/questions를 읽는다.
 */
function imagePathOf(entry: RegistryEntry): string | null {
  if (entry.kind === 'assessment') {
    const rel = assessmentImageFile(entry.questionId);
    return rel ? assetPath(rel) : null;
  }
  return resolve(process.cwd(), 'public', 'questions', `${entry.questionId}.jpg`);
}

/**
 * 파일을 읽어 SHA-256을 계산한다. 레지스트리에 고정 해시가 있으면 다르면 거부한다.
 * 연습 문항은 고정 해시를 두지 않으므로(빈 문자열) 계산값만 돌려준다.
 */
async function loadImageBytes(entry: RegistryEntry): Promise<ImageBytes | null> {
  const path = imagePathOf(entry);
  if (!path) return null;
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    return null;
  }
  const digest = sha256(bytes);
  if (entry.imageSha256 && entry.imageSha256 !== digest) return null;
  return { bytes, contentType: contentTypeOf(path), sha256: digest };
}

/** readiness용 동기 점검. 검사 문항만 확인한다. */
function assessmentImageStatus(): AssessmentImageStatus {
  const missing: string[] = [];
  const mismatch: string[] = [];
  for (const questionId of ASSESSMENT_ORDER) {
    const entry = findBaseEntry(questionId);
    if (!entry) continue;
    const path = imagePathOf(entry);
    if (!path || !existsSync(path)) {
      missing.push(questionId);
      continue;
    }
    try {
      if (sha256(readFileSync(path)) !== entry.imageSha256) mismatch.push(questionId);
    } catch {
      missing.push(questionId);
    }
  }
  return { missing, mismatch };
}

/* ────────────────────────── 배선 ────────────────────────── */

export const registry = createRegistry({
  makeError: (message, code) => new RegistryError(message, code),
  cuePack: readCuePack,
  loadImageBytes,
  assessmentImageStatus,
  config: {
    researchAssetDir: RESEARCH_ASSET_DIR,
    consentVersion: CONSENT_VERSION,
    irbApproval: IRB_APPROVAL,
    modelAccessVerified: MODEL_ACCESS_VERIFIED,
  },
});

/**
 * 세션 성격에 맞는 채점 단서. 연구 세션은 단서가 없으면 거부하고,
 * 일반 체험은 null을 돌려주어 호출자가 공통 루브릭만으로 채점할지 판단하게 한다.
 */
export function cuesForSession(questionId: string, sessionType: SessionType): QuestionCues | null {
  return coreCuesForSession(registry, questionId, sessionType);
}

/** 교사·연구자 화면과 manifest가 쓰는 전체 목록(단서 적재 상태 포함) */
export function allEntries(): RegistryEntry[] {
  return listEntries({ cuePack: readCuePack });
}

/** 단서 팩의 현재 상태 요약. 단서 본문은 담지 않는다. */
export function cuePackStatus(): {
  loaded: boolean;
  cueVersion: string | null;
  error: string | null;
  loadedQuestionIds: string[];
  invalid: Record<string, string>;
} {
  const pack = readCuePack();
  return {
    loaded: pack.loaded,
    cueVersion: pack.cueVersion,
    error: pack.error,
    loadedQuestionIds: Object.keys(pack.questions).sort(),
    invalid: pack.invalid,
  };
}

export { RegistryError } from './contract';
export type { PublicQuestionView, QuestionCues, RegistryEntry } from './contract';
