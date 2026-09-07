/**
 * 레지스트리 본체 — 파일 시스템·환경 변수를 직접 만지지 않는 순수 구현.
 *
 * 실제 자산 접근(단서 팩 파일 읽기, 이미지 바이트 읽기)과 오류 클래스 생성은
 * 주입받는다. 덕분에 이 모듈은 'server-only'를 import 하지 않아도 되고,
 * 순수 함수 테스트가 가짜 자산으로 거부 동작을 그대로 확인할 수 있다.
 * 실 서비스 배선은 같은 디렉터리의 index.ts가 한다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §2
 */

import type { SessionType } from '@/lib/research/types';
import type { Band } from '@/lib/scoring';
import type { PublicQuestionView, QuestionCues, RegistryApi, RegistryEntry } from './contract';
import {
  ASSESSMENT_INSTRUCTION,
  ASSESSMENT_ORDER,
  assessmentImageUrl,
  baseEntries,
  collectBlockers,
  findBaseEntry,
  isSessionTypeAllowed,
  practiceImagePath,
  practiceInstruction,
} from './entries';

export type RegistryErrorCode = 'unknown_question' | 'not_allowed' | 'cues_missing' | 'asset_missing';

/** 단서 팩을 읽어 검증한 결과. 통과한 문항만 questions에 담는다. */
export interface LoadedCuePack {
  /** 파일을 찾아 JSON으로 해석하는 데 성공했는가 */
  loaded: boolean;
  /** 팩이 스스로 밝힌 단서 버전. 없으면 null. */
  cueVersion: string | null;
  /** 필수 항목 검증을 통과한 문항의 단서 */
  questions: Record<string, QuestionCues>;
  /** 팩에는 있으나 필수 항목이 비어 실격된 문항과 사유 */
  invalid: Record<string, string>;
  /** 팩 자체를 열지 못한 사유. 열었으면 null. */
  error: string | null;
}

export function emptyCuePack(error: string): LoadedCuePack {
  return { loaded: false, cueVersion: null, questions: {}, invalid: {}, error };
}

export interface ImageBytes {
  bytes: Buffer;
  contentType: string;
  sha256: string;
}

/** 검사 이미지의 파일 존재·해시 일치 여부. readiness가 동기라서 동기로 받는다. */
export interface AssessmentImageStatus {
  missing: string[];
  mismatch: string[];
}

export interface RegistryConfigView {
  researchAssetDir: string;
  consentVersion: string;
  irbApproval: string;
  modelAccessVerified: boolean;
}

export interface RegistryDeps {
  /** 계약이 정한 RegistryError를 만든다. 테스트는 code만 같은 가짜를 넣는다. */
  makeError(message: string, code: RegistryErrorCode): Error;
  /** 단서 팩. 구현체가 캐시를 관리한다. */
  cuePack(): LoadedCuePack;
  /** 이미지 바이트. 파일이 없거나 해시가 명세와 다르면 null. */
  loadImageBytes(entry: RegistryEntry): Promise<ImageBytes | null>;
  /** readiness 판정에 쓸 검사 이미지 상태 */
  assessmentImageStatus(): AssessmentImageStatus;
  config: RegistryConfigView;
}

/* ────────────────────────── 단서 검증 ────────────────────────── */

const ANCHOR_LEVELS = ['1', '2', '3', '4', '5'] as const;

function nonEmptyStrings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (!t) return null;
    out.push(t);
  }
  return out;
}

function optionalStrings(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  return nonEmptyStrings(value);
}

function readAnchorAxis(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const src = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const lv of ANCHOR_LEVELS) {
    const text = src[lv];
    if (typeof text !== 'string' || !text.trim()) return null;
    out[lv] = text.trim();
  }
  return out;
}

/**
 * 문항 하나의 단서를 검증한다. 비어 있거나 형식이 어긋나면 사유 문자열을 돌려주고
 * 채점에 쓰지 않는다. 빈 단서를 통과시켜 채점하지 않기 위한 관문이다.
 */
export function validateCues(raw: unknown, band: Band): { cues: QuestionCues } | { reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { reason: '단서 항목이 객체가 아닙니다.' };
  }
  const src = raw as Record<string, unknown>;

  const coreObjects = nonEmptyStrings(src.coreObjects);
  if (!coreObjects || !coreObjects.length) return { reason: '핵심 대상(coreObjects)이 비어 있습니다.' };

  const requiredAttributes = nonEmptyStrings(src.requiredAttributes);
  if (!requiredAttributes || !requiredAttributes.length) {
    return { reason: '필수 속성(requiredAttributes)이 비어 있습니다.' };
  }

  const requiredContext = optionalStrings(src.requiredContext);
  if (!requiredContext) return { reason: '필수 맥락(requiredContext) 형식이 어긋납니다.' };
  if (band === 'A' && requiredContext.length) {
    return { reason: 'A밴드는 맥락 축을 적용하지 않으므로 requiredContext가 비어 있어야 합니다.' };
  }
  if (band !== 'A' && !requiredContext.length) {
    return { reason: 'B·C밴드는 필수 맥락(requiredContext)이 있어야 합니다.' };
  }

  const acceptedExpressions = optionalStrings(src.acceptedExpressions);
  const notRequired = optionalStrings(src.notRequired);
  const contradictions = optionalStrings(src.contradictions);
  if (!acceptedExpressions || !notRequired || !contradictions) {
    return { reason: '허용 표현·비필수·모순 목록의 형식이 어긋납니다.' };
  }

  const anchorsRaw = src.anchors;
  if (!anchorsRaw || typeof anchorsRaw !== 'object' || Array.isArray(anchorsRaw)) {
    return { reason: '축별 앵커(anchors)가 없습니다.' };
  }
  const anchorSrc = anchorsRaw as Record<string, unknown>;
  const axes = band === 'A' ? ['object', 'specificity'] : ['object', 'specificity', 'context'];
  const anchors: Record<string, Record<string, string>> = {};
  for (const axis of axes) {
    const parsed = readAnchorAxis(anchorSrc[axis]);
    if (!parsed) return { reason: `${axis} 축의 1~5수준 앵커가 모두 채워지지 않았습니다.` };
    anchors[axis] = parsed;
  }
  if (band === 'A' && anchorSrc.context !== undefined && anchorSrc.context !== null) {
    return { reason: 'A밴드에는 맥락 축 앵커를 두지 않습니다.' };
  }

  return {
    cues: {
      coreObjects,
      requiredAttributes,
      requiredContext,
      acceptedExpressions,
      notRequired,
      contradictions,
      anchors,
    },
  };
}

/**
 * 단서 팩 파일 전체를 검증한다. 등록되지 않은 questionId는 무시하고,
 * 필수 항목이 빈 문항은 invalid에 사유만 남긴다(단서 본문은 남기지 않는다).
 */
export function parseCuePack(raw: unknown): LoadedCuePack {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyCuePack('단서 팩의 최상위가 객체가 아닙니다.');
  }
  const src = raw as Record<string, unknown>;
  const questionsRaw = src.questions;
  if (!questionsRaw || typeof questionsRaw !== 'object' || Array.isArray(questionsRaw)) {
    return emptyCuePack('단서 팩에 questions 객체가 없습니다.');
  }

  const cueVersion = typeof src.cueVersion === 'string' && src.cueVersion.trim() ? src.cueVersion.trim() : null;
  const questions: Record<string, QuestionCues> = {};
  const invalid: Record<string, string> = {};

  for (const [questionId, value] of Object.entries(questionsRaw as Record<string, unknown>)) {
    const entry = findBaseEntry(questionId);
    if (!entry) {
      invalid[questionId] = '레지스트리에 없는 questionId입니다.';
      continue;
    }
    const result = validateCues(value, entry.band);
    if ('reason' in result) {
      invalid[questionId] = result.reason;
      continue;
    }
    questions[questionId] = result.cues;
  }

  return { loaded: true, cueVersion, questions, invalid, error: null };
}

/* ────────────────────────── 레지스트리 ────────────────────────── */

/**
 * 실제 적재한 단서 팩의 상태를 항목에 반영한다.
 *
 * 팩이 스스로 밝힌 cueVersion이 있으면 그 값을 기록한다. 채점 기록의 cueVersion이
 * 코드 상수로 고정되어 있으면, 팩을 바꿔도 어떤 단서로 채점했는지 뒤에 알 수 없다.
 * 팩이 없거나 이 문항의 단서가 실격되었으면 미적재 상태 그대로 두고 버전을 지어내지 않는다.
 */
export function applyCueState(entry: RegistryEntry, pack: LoadedCuePack): RegistryEntry {
  const loaded = Boolean(pack.questions[entry.questionId]);
  return {
    ...entry,
    cuesLoaded: loaded,
    cueVersion: loaded && pack.cueVersion ? pack.cueVersion : entry.cueVersion,
  };
}

export function createRegistry(deps: RegistryDeps): RegistryApi {
  const withCueState = (entry: RegistryEntry): RegistryEntry =>
    applyCueState(entry, deps.cuePack());

  const getEntry = (questionId: string): RegistryEntry => {
    const entry = findBaseEntry(questionId);
    if (!entry) {
      throw deps.makeError(`등록되지 않은 문항입니다: ${questionId}`, 'unknown_question');
    }
    return withCueState(entry);
  };

  const requireEntry = (questionId: string, sessionType: SessionType): RegistryEntry => {
    const entry = getEntry(questionId);
    if (!isSessionTypeAllowed(entry, sessionType)) {
      throw deps.makeError(
        `이 세션(${sessionType})에서 쓸 수 없는 문항입니다: ${questionId}`,
        'not_allowed',
      );
    }
    return entry;
  };

  const getCues = (questionId: string): QuestionCues => {
    const entry = getEntry(questionId);
    const pack = deps.cuePack();
    const cues = pack.questions[entry.questionId];
    if (!cues) {
      const reason = pack.invalid[entry.questionId] ?? (pack.error ?? '단서 팩에 해당 문항이 없습니다.');
      throw deps.makeError(`문항 단서를 쓸 수 없습니다(${questionId}): ${reason}`, 'cues_missing');
    }
    return cues;
  };

  const loadImage = async (questionId: string) => {
    const entry = getEntry(questionId);
    const image = await deps.loadImageBytes(entry);
    if (!image) {
      throw deps.makeError(`문항 이미지를 열 수 없습니다: ${questionId}`, 'asset_missing');
    }
    return image;
  };

  const toPublicView = (entry: RegistryEntry): PublicQuestionView => {
    if (entry.kind === 'assessment') {
      return {
        questionId: entry.questionId,
        kind: entry.kind,
        lesson: entry.lesson,
        imageUrl: assessmentImageUrl(entry.questionId),
        durationSeconds: entry.durationSeconds,
        instruction: ASSESSMENT_INSTRUCTION,
      };
    }
    return {
      questionId: entry.questionId,
      kind: entry.kind,
      lesson: entry.lesson,
      imageUrl: practiceImagePath(entry) ?? '',
      durationSeconds: null,
      instruction: practiceInstruction(entry.questionId),
    };
  };

  const readiness = () => {
    const pack = deps.cuePack();
    const imageStatus = deps.assessmentImageStatus();
    const assessmentCuesMissing = ASSESSMENT_ORDER.filter((id) => !pack.questions[id]);
    const blockers = collectBlockers({
      researchAssetDir: deps.config.researchAssetDir,
      consentVersion: deps.config.consentVersion,
      irbApproval: deps.config.irbApproval,
      modelAccessVerified: deps.config.modelAccessVerified,
      cuePackLoaded: pack.loaded,
      cuePackVersion: pack.cueVersion,
      assessmentCuesMissing: [...assessmentCuesMissing],
      assessmentImagesMissing: imageStatus.missing,
      assessmentImageHashMismatch: imageStatus.mismatch,
    });
    return { researchReady: blockers.length === 0, blockers };
  };

  return {
    getEntry,
    requireEntry,
    getCues,
    loadImage,
    toPublicView,
    assessmentOrder: () => [...ASSESSMENT_ORDER],
    readiness,
  };
}

/**
 * 세션 성격에 맞는 단서를 돌려준다.
 *
 * 연구 세션(research_practice·research_assessment)에서는 단서가 없으면
 * RegistryError('cues_missing')로 채점을 거부한다. 일반 체험(experience)에서는
 * null을 돌려주어, 호출자가 공통 루브릭만으로 채점할지 스스로 판단하게 한다.
 * 빈 단서를 있는 것처럼 채워 넘기지 않는다.
 */
export function cuesForSession(
  api: RegistryApi,
  questionId: string,
  sessionType: SessionType,
): QuestionCues | null {
  const entry = api.requireEntry(questionId, sessionType);
  if (sessionType === 'experience') {
    return entry.cuesLoaded ? api.getCues(entry.questionId) : null;
  }
  return api.getCues(entry.questionId);
}

/** 전체 항목의 현재 cuesLoaded·cueVersion까지 반영한 목록. 교사·연구자 화면과 manifest가 쓴다. */
export function listEntries(deps: Pick<RegistryDeps, 'cuePack'>): RegistryEntry[] {
  const pack = deps.cuePack();
  return baseEntries().map((e) => applyCueState(e, pack));
}
