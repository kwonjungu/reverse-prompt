import 'server-only';

/**
 * 문항 레지스트리 구현. 계약은 ./contract.ts.
 *
 * 여기서만 비공개 연구 자산을 연다. 검사 이미지는 저장소에 커밋하지 않고 RESEARCH_ASSET_DIR 아래에서 읽는다.
 * 문항별 단서·경계·앵커(단서 팩)는 RESEARCH_ASSET_DIR/cue-pack.json 파일이 있으면 그 파일을,
 * 없으면 관리 화면에서 올린 Firestore 사본(admin_config/cue_pack)을 읽는다(./cue-pack-store.ts).
 * 판정 규칙 자체는 ./core.ts와 ./entries.ts에 있고 이 파일은 파일 시스템·Firestore·설정 배선만 맡는다.
 *
 * 레지스트리 API는 동기다. Firestore 사본은 ensureCuePackLoaded()가 미리 읽어 두므로
 * 서버 진입점(server action·API route·채점기)은 레지스트리를 쓰기 전에 그 함수를 기다린다.
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
import { COLLECTIONS, CUE_PACK_DOC_ID, getAdminFirestore, isAdminConfigured } from '@/server/firebase-admin';
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
  listEntries,
  type AssessmentImageStatus,
  type ImageBytes,
  type LoadedCuePack,
} from './core';
import {
  copyInfoOf,
  copyMetaOf,
  createCuePackLoader,
  summarizeActive,
  type ActiveCuePack,
  type CuePackCopyInfo,
  type CuePackCopyMeta,
  type CuePackDocRead,
  type CuePackFileProbe,
  type CuePackStatusSummary,
  type StoredCuePackDoc,
} from './cue-pack-store';

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

/** 파일 쪽 상태. 경로 문자열은 밖으로 내보내지 않는다. */
function probeCuePackFile(): CuePackFileProbe {
  const path = assetPath(CUE_PACK_FILENAME);
  if (!path) return { kind: 'no_dir' };
  try {
    const st = statSync(path);
    if (!st.isFile()) return { kind: 'missing' };
    // 수정 시각과 크기가 같으면 다시 읽지 않는다.
    return { kind: 'present', key: `${st.mtimeMs}:${st.size}`, read: () => readFileSync(path, 'utf8') };
  } catch {
    return { kind: 'missing' };
  }
}

function cuePackDocRef() {
  return getAdminFirestore().collection(COLLECTIONS.adminConfig).doc(CUE_PACK_DOC_ID);
}

async function readCuePackDoc(): Promise<CuePackDocRead> {
  // 서버 자격증명이 없으면(로컬에서 파일 없이 띄운 경우) 사본도 없는 것으로 본다. 요청마다 오류 로그를 남기지 않기 위해서다.
  // 연구 세션 채점은 어차피 빈 팩으로 cues_missing이 되고, 관리 화면은 자격증명 없이는 열리지 않는다.
  if (!isAdminConfigured()) return { exists: false };
  const snap = await cuePackDocRef().get();
  return snap.exists ? { exists: true, data: snap.data() } : { exists: false };
}

const cuePackLoader = createCuePackLoader({
  probeFile: probeCuePackFile,
  readDoc: readCuePackDoc,
  now: () => Date.now(),
  onReadError: (err) => {
    // 오류 코드만 남긴다. 문서 내용·자격증명은 싣지 않는다.
    const code = (err as { code?: unknown } | null)?.code;
    console.error('[cue-pack] Firestore 사본을 읽지 못했습니다', typeof code === 'string' || typeof code === 'number' ? code : '');
  },
});

/** 레지스트리가 동기로 읽는 지금의 단서 팩(파일 우선, 없으면 마지막으로 읽은 사본). */
function readCuePack(): LoadedCuePack {
  return cuePackLoader.current().pack;
}

/**
 * 레지스트리를 쓰기 전에 기다린다. 파일이 있으면 아무것도 읽지 않고, 없으면 Firestore 사본을
 * TTL(60초) 안에서 한 번 읽어 둔다. 읽지 못하면 빈 팩(사유 포함)으로 두고 던지지 않는다 —
 * 연구 세션 채점은 그 뒤 cues_missing으로 거부된다(fail closed).
 */
export async function ensureCuePackLoaded(): Promise<void> {
  await cuePackLoader.ensureLoaded();
}

/** TTL을 무시하고 사본을 다시 읽는다. 관리 화면의 상태 조회가 쓴다. */
export async function refreshCuePack(): Promise<CuePackStatusSummary> {
  return summarizeActive(await cuePackLoader.ensureLoaded({ force: true }));
}

/** 캐시를 버리고 지금 상태를 동기로 다시 읽는다(파일은 다시 읽고, 사본은 다음 ensureCuePackLoaded 때 읽는다). */
export function reloadCuePack(): LoadedCuePack {
  cuePackLoader.invalidate();
  return readCuePack();
}

/** 이 서버가 RESEARCH_ASSET_DIR의 cue-pack.json을 쓰는가(있으면 Firestore 사본보다 우선한다). */
export function cuePackFileActive(): boolean {
  return probeCuePackFile().kind === 'present';
}

/** Firestore 사본의 본문 없는 정보(읽을 수 있는지·연습 적재 수 포함). 사본이 없으면 null. 읽지 못하면 던진다. */
export async function readCuePackCopyInfo(): Promise<CuePackCopyInfo | null> {
  const doc = await readCuePackDoc();
  return doc.exists ? copyInfoOf(doc.data) : null;
}

/** 점검을 통과한 팩을 Firestore 사본으로 저장한다(덮어쓴다). 이 인스턴스의 캐시는 바로 버린다. */
export async function writeCuePackCopy(doc: StoredCuePackDoc): Promise<void> {
  await cuePackDocRef().set(doc);
  cuePackLoader.invalidate();
}

/** Firestore 사본을 지운다. 지우기 전의 본문 없는 정보를 돌려준다(조작 기록용). */
export async function deleteCuePackCopy(): Promise<CuePackCopyMeta | null> {
  const doc = await readCuePackDoc();
  const before = doc.exists ? copyMetaOf(doc.data) : null;
  if (doc.exists) await cuePackDocRef().delete();
  cuePackLoader.invalidate();
  return before;
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

/**
 * 단서 팩의 현재 상태 요약. 단서 본문은 담지 않는다.
 * source가 지금 쓰는 출처(file | firestore | none)다. 사본은 마지막으로 읽은 것 기준이므로
 * 최신 상태가 필요하면 먼저 ensureCuePackLoaded()나 refreshCuePack()을 부른다.
 */
export function cuePackStatus(): CuePackStatusSummary {
  return summarizeActive(cuePackLoader.current());
}

export type { ActiveCuePack, CuePackCopyInfo, CuePackCopyMeta, CuePackStatusSummary };
export { RegistryError } from './contract';
export type { PublicQuestionView, QuestionCues, RegistryEntry } from './contract';
