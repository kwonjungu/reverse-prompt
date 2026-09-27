/**
 * 비공개 단서 팩의 보관·적재 — 순수 구현(파일 시스템·Firestore를 직접 만지지 않는다).
 *
 * 단서 팩은 두 곳 가운데 한 곳에서 온다.
 *   1. 파일   RESEARCH_ASSET_DIR/cue-pack.json — 로컬·개발, 또는 저장소 밖 파일을 둘 수 있는 서버.
 *   2. 사본   Firestore admin_config/cue_pack — Vercel 운영. 관리 화면(연구 자료 탭의 단서 팩)에서 올린다.
 *             클라이언트 규칙은 admin_config/* 읽기·쓰기를 모두 거부하고 서버 Admin SDK만 읽는다.
 *
 * 우선순위: 파일이 있으면 파일이 이긴다. 파일이 깨져 있어도 사본으로 내려가지 않는다(fail closed —
 * 어느 팩으로 채점했는지 헷갈리지 않게 한다). 파일이 없을 때만 사본을 쓴다.
 *
 * 레지스트리 API는 동기다. 그래서 사본은 비동기로 미리 읽어 메모리에 두고(ensureLoaded, TTL 60초),
 * 레지스트리는 그 캐시를 동기로 읽는다(current). 서버 진입점(server action·API route·채점기)이
 * 레지스트리를 쓰기 전에 ensureLoaded를 기다린다. 다른 서버 인스턴스는 TTL 안에 새 사본을 읽는다.
 *
 * 실패는 닫힌 쪽으로 간다. 사본을 읽지 못했거나 해시가 맞지 않거나 JSON이 깨졌으면
 * 빈 팩(error에 사유)을 쓰고, 일부만 맞는 자료로 채점하지 않는다.
 *
 * 이 모듈의 어떤 결과도 단서 본문을 담지 않는다(요약·점검 결과는 문항 ID·상태·고정 사유·개수·해시뿐).
 * 실 배선(파일 읽기·Firestore)은 같은 디렉터리의 index.ts가 주입한다.
 */

import { createHash } from 'node:crypto';

import { PRACTICE_QUESTION_IDS, findBaseEntry } from './entries';
import { emptyCuePack, parseCuePack, type LoadedCuePack } from './core';

/* ────────────────────────── 상수 ────────────────────────── */

/** Firestore 사본 문서의 형식 버전 */
export const CUE_PACK_STORE_SCHEMA = 'cue-pack-store-1';
/** 올릴 수 있는 팩의 최대 크기(UTF-8 바이트). Firestore 문서 한도(1 MiB)보다 넉넉히 작게 둔다. */
export const CUE_PACK_MAX_BYTES = 900 * 1024;
/** 사본 캐시의 유효 시간. 다른 서버 인스턴스가 새 사본을 읽기까지 걸리는 최대 시간이다. */
export const CUE_PACK_TTL_MS = 60_000;
/** cueVersion 문자열의 최대 길이. 화면·기록에 그대로 남는 값이라 짧게 제한한다. */
export const CUE_VERSION_MAX_LENGTH = 100;

const FILE_NAME = 'cue-pack.json';

/** 지금 쓰는 단서 팩의 출처. none은 파일도 사본도 쓸 수 없는 상태다. */
export type CuePackSourceKind = 'file' | 'firestore' | 'none';

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 앞의 BOM 하나만 뗀다(메모장 등으로 저장한 JSON). 나머지는 손대지 않는다. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/* ────────────────────────── Firestore 사본 문서 ────────────────────────── */

/** admin_config/cue_pack 문서의 필드. json 외에는 본문이 없다. */
export interface StoredCuePackDoc {
  schemaVersion: typeof CUE_PACK_STORE_SCHEMA;
  /** 올린 팩의 JSON 원문(BOM만 뗀 것). 서버만 읽는다. */
  json: string;
  /** json의 SHA-256(hex). 읽을 때 다시 계산해 다르면 쓰지 않는다. */
  sha256: string;
  /** 팩이 스스로 밝힌 단서 버전 */
  cueVersion: string;
  /** 검증을 통과한 문항 수(연습·검사 모두) */
  questionCount: number;
  /** 검증에서 실격된 항목 수(등록되지 않은 ID 포함) */
  invalidCount: number;
  /** json의 UTF-8 바이트 수 */
  byteLength: number;
  updatedAt: string;
  updatedBy: string;
}

/** 사본의 본문 없는 정보. 관리 화면·조작 기록에 쓴다. */
export interface CuePackCopyMeta {
  cueVersion: string | null;
  sha256: string | null;
  questionCount: number | null;
  invalidCount: number | null;
  byteLength: number | null;
  updatedAt: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 문서 필드에서 본문(json)을 뺀 정보만 꺼낸다. 형식이 틀려도 던지지 않는다. */
export function copyMetaOf(data: unknown): CuePackCopyMeta {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    cueVersion: str(d.cueVersion),
    sha256: str(d.sha256),
    questionCount: num(d.questionCount),
    invalidCount: num(d.invalidCount),
    byteLength: num(d.byteLength),
    updatedAt: str(d.updatedAt),
  };
}

/**
 * Firestore 사본 문서를 단서 팩으로 읽는다. 형식·해시·JSON 가운데 하나라도 어긋나면 빈 팩이다.
 * 사유는 고정 문구이며 문서 내용을 담지 않는다.
 */
export function parseStoredCuePack(data: unknown): { pack: LoadedCuePack; sha256: string | null } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { pack: emptyCuePack('단서 팩 사본 문서의 형식이 올바르지 않습니다.'), sha256: null };
  }
  const d = data as Record<string, unknown>;
  if (d.schemaVersion !== CUE_PACK_STORE_SCHEMA) {
    return { pack: emptyCuePack('단서 팩 사본의 형식 버전(schemaVersion)을 알 수 없습니다.'), sha256: null };
  }
  if (typeof d.json !== 'string' || typeof d.sha256 !== 'string') {
    return { pack: emptyCuePack('단서 팩 사본에 json·sha256이 없습니다.'), sha256: null };
  }
  const digest = sha256Text(d.json);
  if (digest !== d.sha256) {
    // 콘솔에서 손으로 고친 문서 등. 어느 쪽이 맞는지 알 수 없으므로 쓰지 않는다.
    return { pack: emptyCuePack('단서 팩 사본의 SHA-256이 내용과 맞지 않습니다. 관리 화면에서 다시 올려 주세요.'), sha256: null };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(d.json);
  } catch {
    return { pack: emptyCuePack('단서 팩 사본을 JSON으로 읽지 못했습니다.'), sha256: null };
  }
  return { pack: parseCuePack(raw), sha256: digest };
}

/* ────────────────────────── 문항별 적재 상태 ────────────────────────── */

/** 사본의 본문 없는 정보 + 읽을 수 있는지와 연습 문항 적재 수. 관리 화면·올리기 점검이 쓴다. */
export interface CuePackCopyInfo extends CuePackCopyMeta {
  /** 사본을 단서 팩으로 읽을 수 있는가(형식 버전·해시·JSON·최상위 형식) */
  readable: boolean;
  /** 읽을 수 없으면 그 사유(고정 문구) */
  problem: string | null;
  /** 사본이 적재하는 연습 문항(L01~L36) 수. 읽을 수 없으면 null. */
  practiceLoadedCount: number | null;
}

export function copyInfoOf(data: unknown): CuePackCopyInfo {
  const { pack } = parseStoredCuePack(data);
  return {
    ...copyMetaOf(data),
    readable: pack.loaded,
    problem: pack.error,
    practiceLoadedCount: pack.loaded ? coverageOf(pack).practiceLoadedCount : null,
  };
}


export type CueRowState = 'loaded' | 'invalid' | 'absent';

/** 문항 하나의 적재 상태. 사유는 검증의 고정 문구이며 단서 본문이 아니다. */
export interface CueRow {
  questionId: string;
  state: CueRowState;
  reason: string | null;
}

/** 팩의 적재 상태 요약. 단서 본문·등록되지 않은 ID 문자열은 담지 않는다. */
export interface CuePackCoverage {
  /** L01~L36 번호 순 */
  practice: CueRow[];
  practiceLoadedCount: number;
  practiceTotal: number;
  /** 연습 밖의 등록된 문항(검사 T1·T2_v7·T3 등) 가운데 팩에 있는 것 */
  others: CueRow[];
  /** 레지스트리에 없는 ID의 개수. ID 문자열은 돌려주지 않는다(파일에서 온 임의 문자열이다). */
  unknownIdCount: number;
  /** 검증을 통과한 전체 문항 수 */
  validCount: number;
  /** 실격된 전체 항목 수(등록되지 않은 ID 포함) */
  invalidCount: number;
}

function rowOf(pack: LoadedCuePack, questionId: string): CueRow {
  if (pack.questions[questionId]) return { questionId, state: 'loaded', reason: null };
  const reason = pack.invalid[questionId];
  if (reason !== undefined) return { questionId, state: 'invalid', reason };
  return { questionId, state: 'absent', reason: null };
}

export function coverageOf(pack: LoadedCuePack): CuePackCoverage {
  const practice = PRACTICE_QUESTION_IDS.map((id) => rowOf(pack, id));
  const practiceSet = new Set(PRACTICE_QUESTION_IDS);
  const others: CueRow[] = [];
  let unknownIdCount = 0;
  const seen = new Set<string>();
  for (const id of [...Object.keys(pack.questions), ...Object.keys(pack.invalid)]) {
    if (seen.has(id) || practiceSet.has(id)) continue;
    seen.add(id);
    if (!findBaseEntry(id)) {
      unknownIdCount += 1;
      continue;
    }
    others.push(rowOf(pack, id));
  }
  others.sort((a, b) => a.questionId.localeCompare(b.questionId));
  return {
    practice,
    practiceLoadedCount: practice.filter((r) => r.state === 'loaded').length,
    practiceTotal: practice.length,
    others,
    unknownIdCount,
    validCount: Object.keys(pack.questions).length,
    invalidCount: Object.keys(pack.invalid).length,
  };
}

/* ────────────────────────── 올리기 전 점검 ────────────────────────── */

/** 관리 화면이 올린 팩을 점검한 결과. 단서 본문은 담지 않는다. */
export interface CuePackUploadCheck extends CuePackCoverage {
  /** 이대로 저장할 수 있는가 */
  ok: boolean;
  /** 저장할 수 없는 까닭(고정 문구). ok면 null. */
  problem: string | null;
  cueVersion: string | null;
  sha256: string | null;
  byteLength: number;
  /** 저장은 되지만 알아 둘 점 */
  warnings: string[];
}

const EMPTY_COVERAGE = (): CuePackCoverage => coverageOf(emptyCuePack(''));

function rejected(problem: string, byteLength: number, coverage?: CuePackCoverage): CuePackUploadCheck {
  return {
    ...(coverage ?? EMPTY_COVERAGE()),
    ok: false,
    problem,
    cueVersion: null,
    sha256: null,
    byteLength,
    warnings: [],
  };
}

/** 점검에 쓰는 지금 상태. 본문은 필요 없다. */
export interface CuePackUploadContext {
  /** 지금 Firestore 사본의 정보. 없으면 null. */
  current: CuePackCopyMeta | null;
  /** 지금 사본이 적재하는 연습 문항 수(사본이 없거나 깨졌으면 null) */
  currentPracticeLoadedCount: number | null;
  /** 이 서버가 RESEARCH_ASSET_DIR 파일을 쓰고 있어 사본이 쓰이지 않는가 */
  fileSourceActive: boolean;
}

/**
 * 관리 화면에서 올린 팩을 저장하기 전에 점검한다. 저장은 ok일 때만 한다.
 *
 * 거부(저장하지 않음): 비었거나 너무 큼, JSON이 아님, 최상위 형식 오류, cueVersion 없음,
 * 검증을 통과한 문항이 하나도 없음, 지금 사본과 cueVersion은 같은데 내용이 다름,
 * 지금 사본과 똑같음(바꿀 것이 없음).
 * 경고(저장은 함): 연습 36문항이 다 차지 않음, 지금 사본보다 연습 문항이 줄어듦, 이 서버는 파일을 씀.
 *
 * JSON 해석 오류의 원문 메시지는 쓰지 않는다(V8 메시지가 입력의 일부를 인용하기 때문이다).
 */
export function checkCuePackUpload(text: unknown, context: CuePackUploadContext): CuePackUploadCheck {
  if (typeof text !== 'string') return rejected('파일 내용을 읽지 못했습니다.', 0);
  const json = stripBom(text);
  const byteLength = Buffer.byteLength(json, 'utf8');
  if (!json.trim()) return rejected('빈 파일입니다.', byteLength);
  if (byteLength > CUE_PACK_MAX_BYTES) {
    return rejected(`파일이 너무 큽니다(최대 ${Math.floor(CUE_PACK_MAX_BYTES / 1024)}KB).`, byteLength);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return rejected('JSON 형식이 아닙니다. 파일을 JSON 검사기로 확인해 주세요.', byteLength);
  }
  const pack = parseCuePack(raw);
  if (!pack.loaded) return rejected(pack.error ?? '단서 팩 형식이 올바르지 않습니다.', byteLength);

  const coverage = coverageOf(pack);
  const sha256 = sha256Text(json);
  const base: CuePackUploadCheck = {
    ...coverage,
    ok: true,
    problem: null,
    cueVersion: pack.cueVersion,
    sha256,
    byteLength,
    warnings: [],
  };
  const fail = (problem: string): CuePackUploadCheck => ({ ...base, ok: false, problem });

  if (!pack.cueVersion) {
    return fail('cueVersion이 없습니다. 채점 기록에 어떤 단서로 채점했는지 남기려면 최상위에 cueVersion을 적어 주세요.');
  }
  if (pack.cueVersion.length > CUE_VERSION_MAX_LENGTH) {
    return fail(`cueVersion이 너무 깁니다(최대 ${CUE_VERSION_MAX_LENGTH}자).`);
  }
  if (coverage.validCount === 0) {
    return fail('검증을 통과한 문항이 하나도 없어 저장하지 않았습니다. 아래 사유를 확인해 주세요.');
  }

  const current = context.current;
  if (current?.sha256 && current.sha256 === sha256) {
    return fail('지금 올라가 있는 사본과 똑같은 파일입니다. 바꿀 것이 없습니다.');
  }
  if (current?.cueVersion && current.cueVersion === pack.cueVersion) {
    // 채점 기록에는 cueVersion만 남는다. 같은 이름으로 내용을 바꾸면 어느 단서로 채점했는지 가릴 수 없다.
    return fail(
      `지금 사본과 cueVersion(${pack.cueVersion})이 같은데 내용이 다릅니다. 단서를 고쳤으면 cueVersion을 올려 주세요.`,
    );
  }

  const warnings: string[] = [];
  if (coverage.practiceLoadedCount < coverage.practiceTotal) {
    warnings.push(
      `연습 문항 ${coverage.practiceTotal}개 가운데 ${coverage.practiceLoadedCount}개만 적재됩니다. ` +
        '연구 수업을 열려면 L01~L36이 모두 적재되어야 하고, 빠진 문항의 연구 채점은 결측이 됩니다.',
    );
  }
  if (
    context.currentPracticeLoadedCount !== null &&
    coverage.practiceLoadedCount < context.currentPracticeLoadedCount
  ) {
    warnings.push(
      `지금 사본(연습 ${context.currentPracticeLoadedCount}개 적재)보다 적재되는 연습 문항이 적습니다.`,
    );
  }
  if (coverage.unknownIdCount > 0) {
    warnings.push(`레지스트리에 없는 문항 ID ${coverage.unknownIdCount}개는 무시됩니다.`);
  }
  if (context.fileSourceActive) {
    warnings.push(
      `이 서버는 RESEARCH_ASSET_DIR의 ${FILE_NAME}을 쓰고 있어 올린 사본은 쓰이지 않습니다(파일이 우선합니다).`,
    );
  }
  return { ...base, warnings };
}

/** 점검을 통과한 팩으로 저장할 문서를 만든다. ok가 아니면 null. */
export function storedDocOf(
  text: string,
  check: CuePackUploadCheck,
  options: { now: Date; actor: string },
): StoredCuePackDoc | null {
  if (!check.ok || !check.sha256 || !check.cueVersion) return null;
  const json = stripBom(text);
  // 점검한 내용과 저장하는 내용이 같은지 한 번 더 확인한다.
  if (sha256Text(json) !== check.sha256) return null;
  return {
    schemaVersion: CUE_PACK_STORE_SCHEMA,
    json,
    sha256: check.sha256,
    cueVersion: check.cueVersion,
    questionCount: check.validCount,
    invalidCount: check.invalidCount,
    byteLength: check.byteLength,
    updatedAt: options.now.toISOString(),
    updatedBy: options.actor,
  };
}

/* ────────────────────────── 적재기(파일 우선, 사본은 TTL 캐시) ────────────────────────── */

/** 파일 쪽 상태. present면 key(수정 시각·크기)가 같을 때 다시 읽지 않는다. */
export type CuePackFileProbe =
  | { kind: 'no_dir' }
  | { kind: 'missing' }
  | { kind: 'present'; key: string; read(): string };

export type CuePackDocRead = { exists: false } | { exists: true; data: unknown };

export interface CuePackLoaderDeps {
  probeFile(): CuePackFileProbe;
  /** Firestore 사본 문서를 읽는다. 자격증명이 없거나 네트워크 오류면 던진다. */
  readDoc(): Promise<CuePackDocRead>;
  now(): number;
  ttlMs?: number;
  /** 사본 읽기 실패를 남길 곳(서버 로그). 오류 코드만 남기고 내용은 싣지 않는다. */
  onReadError?(err: unknown): void;
}

/** 지금 쓰는 단서 팩과 그 출처 */
export interface ActiveCuePack {
  source: CuePackSourceKind;
  pack: LoadedCuePack;
  /** 쓰고 있는 팩 원문의 SHA-256. 없으면 null. */
  sha256: string | null;
  /** Firestore 사본을 마지막으로 읽은 시각(ms). 파일을 쓰거나 아직 읽지 않았으면 null. */
  copyReadAt: number | null;
}

export interface CuePackLoader {
  /** 동기. 파일이 있으면 파일, 없으면 마지막으로 읽은 사본(없으면 빈 팩). */
  current(): ActiveCuePack;
  /** 파일이 없으면 사본을 TTL 안에서 한 번 읽어 둔다. force면 TTL을 무시한다. */
  ensureLoaded(options?: { force?: boolean }): Promise<ActiveCuePack>;
  /** 사본 캐시를 버린다(관리 화면에서 올리거나 지운 뒤). */
  invalidate(): void;
}

const NO_COPY_MESSAGE =
  `단서 팩이 없습니다. RESEARCH_ASSET_DIR에 ${FILE_NAME}을 두거나 관리 화면(연구 자료 → 단서 팩)에서 올려 주세요.`;
const COPY_READ_FAILED = '단서 팩 사본(Firestore)을 읽지 못했습니다.';
const COPY_NOT_READ_YET = '단서 팩 사본을 아직 읽지 않았습니다.';

interface RemoteState {
  active: ActiveCuePack;
  /** TTL 판정 기준 시각. 읽기에 실패했으면 null(다음 요청이 다시 읽는다). */
  freshSince: number | null;
}

export function createCuePackLoader(deps: CuePackLoaderDeps): CuePackLoader {
  const ttl = deps.ttlMs ?? CUE_PACK_TTL_MS;

  let fileCache: { key: string; active: ActiveCuePack } | null = null;
  let remote: RemoteState | null = null;
  /** invalidate마다 오른다. 그 전에 시작한 읽기의 결과는 버린다. */
  let generation = 0;
  let inflight: { generation: number; promise: Promise<void> } | null = null;

  const fromFile = (probe: Extract<CuePackFileProbe, { kind: 'present' }>): ActiveCuePack => {
    if (fileCache && fileCache.key === probe.key) return fileCache.active;
    let active: ActiveCuePack;
    try {
      const text = stripBom(probe.read());
      let pack: LoadedCuePack;
      try {
        pack = parseCuePack(JSON.parse(text));
      } catch {
        pack = emptyCuePack(`${FILE_NAME}을 JSON으로 읽지 못했습니다.`);
      }
      active = { source: 'file', pack, sha256: sha256Text(text), copyReadAt: null };
    } catch {
      // 실제 경로 문자열을 오류 문구에 넣지 않는다.
      active = { source: 'file', pack: emptyCuePack(`${FILE_NAME}을 읽지 못했습니다.`), sha256: null, copyReadAt: null };
    }
    fileCache = { key: probe.key, active };
    return active;
  };

  const current = (): ActiveCuePack => {
    const probe = deps.probeFile();
    if (probe.kind === 'present') return fromFile(probe);
    if (remote) return remote.active;
    return { source: 'none', pack: emptyCuePack(COPY_NOT_READ_YET), sha256: null, copyReadAt: null };
  };

  const readRemote = async (gen: number): Promise<void> => {
    let next: RemoteState;
    const at = deps.now();
    try {
      const doc = await deps.readDoc();
      if (!doc.exists) {
        next = {
          active: { source: 'none', pack: emptyCuePack(NO_COPY_MESSAGE), sha256: null, copyReadAt: at },
          freshSince: at,
        };
      } else {
        const { pack, sha256 } = parseStoredCuePack(doc.data);
        next = { active: { source: 'firestore', pack, sha256, copyReadAt: at }, freshSince: at };
      }
    } catch (err) {
      deps.onReadError?.(err);
      // 앞서 읽은 사본을 계속 쓰지 않는다. 지워졌을 수도 있는 팩으로 채점하지 않기 위해서다.
      next = {
        active: { source: 'none', pack: emptyCuePack(COPY_READ_FAILED), sha256: null, copyReadAt: at },
        freshSince: null,
      };
    }
    if (gen === generation) remote = next;
  };

  const ensureLoaded = async (options?: { force?: boolean }): Promise<ActiveCuePack> => {
    if (deps.probeFile().kind === 'present') return current();
    const fresh =
      !options?.force &&
      remote !== null &&
      remote.freshSince !== null &&
      deps.now() - remote.freshSince < ttl;
    if (fresh) return current();

    if (options?.force) generation += 1;
    if (!inflight || inflight.generation !== generation) {
      const gen = generation;
      const promise = readRemote(gen).finally(() => {
        if (inflight?.generation === gen) inflight = null;
      });
      inflight = { generation: gen, promise };
    }
    await inflight.promise;
    return current();
  };

  const invalidate = () => {
    generation += 1;
    remote = null;
    inflight = null;
  };

  return { current, ensureLoaded, invalidate };
}

/* ────────────────────────── 상태 요약 ────────────────────────── */

/** 단서 팩의 현재 상태 요약. 단서 본문은 담지 않는다. */
export interface CuePackStatusSummary {
  /** 지금 쓰는 출처 */
  source: CuePackSourceKind;
  loaded: boolean;
  cueVersion: string | null;
  error: string | null;
  /** 쓰고 있는 팩 원문 SHA-256의 앞 12자리 */
  sha256Prefix: string | null;
  loadedQuestionIds: string[];
  /** 실격 사유. 레지스트리에 등록된 문항만 담는다(등록되지 않은 ID는 개수만 coverage에). */
  invalid: Record<string, string>;
  coverage: CuePackCoverage;
}

export function summarizeActive(active: ActiveCuePack): CuePackStatusSummary {
  const coverage = coverageOf(active.pack);
  const invalid: Record<string, string> = {};
  for (const [id, reason] of Object.entries(active.pack.invalid)) {
    if (findBaseEntry(id)) invalid[id] = reason;
  }
  return {
    source: active.source,
    loaded: active.pack.loaded,
    cueVersion: active.pack.cueVersion,
    error: active.pack.error,
    sha256Prefix: active.sha256 ? active.sha256.slice(0, 12) : null,
    loadedQuestionIds: Object.keys(active.pack.questions).sort(),
    invalid,
    coverage,
  };
}
