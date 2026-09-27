'use server';

/**
 * 통합 관리 화면의 '단서 팩' — 비공개 단서 팩을 Firestore 사본(admin_config/cue_pack)으로 올리고 지운다.
 *
 * 왜 필요한가
 *   Vercel에는 저장소 밖 파일(RESEARCH_ASSET_DIR/cue-pack.json)을 둘 자리가 없다. 그래서 운영 서버는
 *   관리자가 여기서 올린 사본을 읽는다(src/server/registry/cue-pack-store.ts). 공개 저장소에는 올리지 않는다.
 *   서버에 파일이 있으면 파일이 우선한다(로컬·개발).
 *
 * 지키는 것
 *   - 모든 action은 첫 줄에서 requireAdmin()을 부른다(tests/admin.test.ts가 정적으로 확인).
 *   - 저장하기 전에 레지스트리와 같은 검증(parseCuePack)을 먼저 한다. 최상위 형식이 틀리거나 cueVersion이
 *     없거나 통과한 문항이 없거나, 지금 사본과 cueVersion이 같은데 내용이 다르면 저장하지 않는다.
 *   - 단서 본문을 화면에 돌려주지 않는다. 돌려주는 것은 문항 ID(L01~L36·검사 T1~T3)별 상태·고정 사유·개수·
 *     cueVersion·SHA-256뿐이다. 레지스트리에 없는 ID는 문자열이 아니라 개수만 돌려준다.
 *   - 조작 기록(admin_events)에는 SHA-256·개수·cueVersion만 남긴다. 본문은 남기지 않는다.
 *
 * 'use server' 파일이므로 export는 모두 async 함수다. 오류는 던지지 않고 값으로 돌려준다.
 */

import 'server-only';

import { AuthError } from '@/server/auth/contract';
import { CUE_PACK_DOC_ID } from '@/server/firebase-admin';
import {
  cuePackFileActive,
  deleteCuePackCopy,
  readCuePackCopyInfo,
  refreshCuePack,
  registry,
  writeCuePackCopy,
} from '@/server/registry';
import {
  CUE_PACK_MAX_BYTES,
  CUE_PACK_TTL_MS,
  checkCuePackUpload,
  storedDocOf,
  type CuePackCopyInfo,
  type CuePackCoverage,
  type CuePackSourceKind,
  type CuePackUploadCheck,
} from '@/server/registry/cue-pack-store';
import { ADMIN_ACTOR, recordAdminEvent, requireAdmin } from './auth';

export type CuePackResult<T> = { ok: true; data: T } | { ok: false; error: string; signedOut: boolean };

/** 화면에 그대로 보여 줄 입력 오류 */
class CuePackInputError extends Error {}

async function run<T>(fn: () => Promise<T>): Promise<CuePackResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof AuthError) {
      return { ok: false, error: err.message, signedOut: err.code === 'unauthenticated' };
    }
    if (err instanceof CuePackInputError) return { ok: false, error: err.message, signedOut: false };
    // 오류 코드만 남긴다. 올린 파일 내용은 싣지 않는다.
    const code = (err as { code?: unknown } | null)?.code;
    console.error('[admin/cue-pack] 처리 실패', typeof code === 'string' || typeof code === 'number' ? code : '');
    return { ok: false, error: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.', signedOut: false };
  }
}

/* ────────────────────────── 상태 ────────────────────────── */

export interface CuePackAdminStatus {
  /** 이 서버가 지금 채점에 쓰는 출처 */
  source: CuePackSourceKind;
  /** 이 서버에 RESEARCH_ASSET_DIR/cue-pack.json이 있어 사본보다 우선하는가 */
  fileActive: boolean;
  /** 지금 쓰는 팩 */
  active: {
    loaded: boolean;
    cueVersion: string | null;
    error: string | null;
    sha256Prefix: string | null;
    coverage: CuePackCoverage;
  };
  /** Firestore 사본(없으면 null). 파일이 우선하는 서버에서도 보여 준다. */
  copy: (Omit<CuePackCopyInfo, 'sha256'> & { sha256Prefix: string | null }) | null;
  /** 사본 정보를 읽지 못했을 때의 안내 */
  copyError: string | null;
  /** 논문 v12 연구 수업 준비 조건(registry.readiness)의 결과 */
  research: { ready: boolean; blockers: string[] };
  maxBytes: number;
  /** 다른 서버 인스턴스가 새 사본을 읽기까지 걸리는 최대 시간(초) */
  ttlSeconds: number;
}

const prefixOf = (sha: string | null) => (sha ? sha.slice(0, 12) : null);

async function loadStatus(): Promise<CuePackAdminStatus> {
  // TTL을 무시하고 다시 읽는다. 관리자가 보는 상태는 지금 사본이어야 한다.
  const summary = await refreshCuePack();
  let copy: CuePackAdminStatus['copy'] = null;
  let copyError: string | null = null;
  try {
    const info = await readCuePackCopyInfo();
    if (info) {
      const { sha256, ...rest } = info;
      copy = { ...rest, sha256Prefix: prefixOf(sha256) };
    }
  } catch {
    copyError = 'Firestore 사본 정보를 읽지 못했습니다. 서버 자격증명(FIREBASE_SERVICE_ACCOUNT_JSON)을 확인해 주세요.';
  }
  const readiness = registry.readiness();
  return {
    source: summary.source,
    fileActive: cuePackFileActive(),
    active: {
      loaded: summary.loaded,
      cueVersion: summary.cueVersion,
      error: summary.error,
      sha256Prefix: summary.sha256Prefix,
      coverage: summary.coverage,
    },
    copy,
    copyError,
    research: { ready: readiness.researchReady, blockers: readiness.blockers },
    maxBytes: CUE_PACK_MAX_BYTES,
    ttlSeconds: Math.round(CUE_PACK_TTL_MS / 1000),
  };
}

export async function getCuePackStatusAction(): Promise<CuePackResult<CuePackAdminStatus>> {
  return run(async () => {
    await requireAdmin();
    return loadStatus();
  });
}

/* ────────────────────────── 점검·저장·삭제 ────────────────────────── */

/** 올린 팩을 지금 사본과 견주어 점검한다. 저장하지 않는다. */
async function checkAgainstCurrent(text: unknown): Promise<{ check: CuePackUploadCheck; previous: CuePackCopyInfo | null }> {
  // 사본을 읽지 못하면 던진다. 지금 상태를 모른 채 덮어쓰지 않는다.
  const previous = await readCuePackCopyInfo();
  const check = checkCuePackUpload(text, {
    current: previous,
    currentPracticeLoadedCount: previous?.practiceLoadedCount ?? null,
    fileSourceActive: cuePackFileActive(),
  });
  return { check, previous };
}

/**
 * 올릴 파일을 점검만 한다(저장·기록 없음). 화면이 파일을 고르자마자 부르고,
 * 문항별 적재 상태와 저장 가능 여부를 보여 준 뒤 관리자가 저장을 누르게 한다.
 */
export async function checkCuePackAction(text: string): Promise<CuePackResult<CuePackUploadCheck>> {
  return run(async () => {
    await requireAdmin();
    return (await checkAgainstCurrent(text)).check;
  });
}

export interface CuePackSaveOutcome {
  saved: boolean;
  check: CuePackUploadCheck;
  /** 저장했으면 저장 뒤 상태 */
  status: CuePackAdminStatus | null;
}

/**
 * 점검을 통과한 팩을 Firestore 사본으로 저장한다(지금 사본을 덮어쓴다).
 * 서버에서 다시 점검하므로 화면의 점검 결과를 믿지 않는다. 통과하지 못하면 saved:false와 까닭을 돌려준다.
 */
export async function saveCuePackAction(text: string): Promise<CuePackResult<CuePackSaveOutcome>> {
  return run(async () => {
    await requireAdmin();
    const { check, previous } = await checkAgainstCurrent(text);
    if (!check.ok) return { saved: false, check, status: null };

    const doc = storedDocOf(String(text), check, { now: new Date(), actor: ADMIN_ACTOR });
    if (!doc) throw new CuePackInputError('점검한 내용과 저장할 내용이 달라 저장하지 않았습니다. 다시 올려 주세요.');
    await writeCuePackCopy(doc);
    await recordAdminEvent('upload_cue_pack', CUE_PACK_DOC_ID, {
      sha256: doc.sha256,
      cueVersion: doc.cueVersion,
      questionCount: doc.questionCount,
      invalidCount: doc.invalidCount,
      practiceLoadedCount: check.practiceLoadedCount,
      byteLength: doc.byteLength,
      previousSha256: previous?.sha256 ?? null,
      previousCueVersion: previous?.cueVersion ?? null,
    });
    return { saved: true, check, status: await loadStatus() };
  });
}

/** Firestore 사본을 지운다. 지운 뒤에는 파일이 없는 서버에서 연구 세션 채점이 cues_missing으로 멈춘다. */
export async function deleteCuePackAction(): Promise<CuePackResult<CuePackAdminStatus>> {
  return run(async () => {
    await requireAdmin();
    const before = await deleteCuePackCopy();
    if (!before) throw new CuePackInputError('지울 사본이 없습니다.');
    await recordAdminEvent('delete_cue_pack', CUE_PACK_DOC_ID, {
      sha256: before.sha256,
      cueVersion: before.cueVersion,
      questionCount: before.questionCount,
    });
    return loadStatus();
  });
}
