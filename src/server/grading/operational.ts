/**
 * 운영 채점 1회의 절차 — 공통 루브릭 v12-2(3영역 4수준).
 *
 *   1. 같은 고정 입력으로 모델을 1회 부른다. 호출 실패·형식 오류일 때만 1회 다시 부른다.
 *      유리한 출력을 고르려고 다시 부르지 않고, 여러 호출을 결합(평균·중앙값)하지 않는다.
 *   2. 다시 불러도 실패하면 운영 결측이다. 결측은 최저 수준이 아니다.
 *   3. 점수가 확정되면 피드백 검증이 실패해도 재채점하거나 판정을 바꾸지 않는다.
 *      피드백만 확정된 판정을 알려 주고 1회 다시 만든다(purpose='feedback' 호출로 기록).
 *   4. 모든 호출에 모델 API가 밝힌 실제 모델(servedModel)을 남긴다.
 *
 * 모델·레지스트리·개인정보 점검은 모두 주입받는다. 'server-only'를 두지 않아 가짜 모델로 시험한다.
 * 옛 v7 절차(독립 2회 + 조건부 3회, 100점 환산)는 ./legacy-v7.ts에 있고 게임·타임어택만 쓴다.
 */

import {
  isAreaSchemaError,
  levelsOf,
  nextActionArea,
  validateAreaCall,
  type AreaApplicability,
  type AreaId,
  type AreaJudgments,
  type Band,
} from '@/lib/scoring';
import {
  applicabilityOf,
  buildEvaluationPrompt,
  buildFeedbackPrompt,
  promptHash,
} from '@/lib/evaluation-prompt';
import { RUBRIC_VERSION } from '@/lib/rubric';
import {
  FEEDBACK_FALLBACK_TEXT,
  extractFeedbackDraft,
  feedbackNotRequested,
  produceFeedback,
  targetKey,
  type FeedbackDraft,
} from '@/lib/feedback';
import { stageFocusArea } from '@/lib/stages';
import { defaultNotApplicableAreas } from '@/lib/question-areas';
import type {
  CallRecord,
  FeedbackPresentation,
  MissingReasonModel,
  OperationalResult,
  ScoringRun,
} from '@/lib/research/types';
import type { GradingApi, GradingRequest } from './contract';
import type { QuestionCues, RegistryApi } from '@/server/registry/contract';
import type { PrivacyApi } from '@/server/privacy/contract';

/** 모델 호출 1회에 넘기는 고정 입력. 신원 ID·인증정보는 넣지 않는다. */
export interface ModelCallInput {
  modelId: string;
  modelConfig: Record<string, unknown>;
  prompt: string;
  image: { dataUri: string; contentType: string } | null;
  /** 'score'는 채점 스키마, 'feedback'은 피드백만의 스키마로 받는다. */
  purpose: 'score' | 'feedback';
}

/** 모델 호출 결과. 검증하지 않은 원 출력과, 모델 API가 밝힌 실제 모델. */
export interface ModelCallOutput {
  output: unknown;
  servedModel: string | null;
}

export type CallModel = (input: ModelCallInput) => Promise<ModelCallOutput>;

export interface GradingDeps {
  callModel: CallModel;
  registry: Pick<RegistryApi, 'requireEntry' | 'getCues' | 'loadImage'>;
  privacy: Pick<PrivacyApi, 'checkBeforeSend' | 'assertNoSecrets'>;
  modelId: string;
  modelConfig: Record<string, unknown>;
  codeCommit: string;
  /** 시각 주입. 테스트에서 고정한다. */
  now?: () => Date;
}

type FailureKind = 'model_error' | 'schema_error';

interface Attempt {
  areas: AreaJudgments | null;
  raw: unknown;
  servedModel: string | null;
  record: CallRecord;
  failureKind: FailureKind | null;
}

/** 기록에 학생 원문·비밀값이 섞이지 않도록 유형과 짧은 사유만 남긴다. */
function safeFailureReason(kind: FailureKind, detail: string): string {
  return `${kind}: ${detail.replace(/\s+/g, ' ').slice(0, 160)}`;
}

/**
 * 모델 설정을 그대로 쓰기 전에 값이 실제로 쓸 수 있는 수인지 확인한다.
 * EVALUATION_TEMPERATURE에 숫자가 아닌 값이 들어오면 기본값으로 되돌리고 알린다.
 */
export function resolveModelConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const config = { ...raw };
  const t = config.temperature;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > 2) {
    console.warn('[grading] EVALUATION_TEMPERATURE 값을 쓸 수 없어 기본값 0.2로 채점합니다.');
    config.temperature = 0.2;
  }
  return config;
}

/**
 * 단서 팩의 영역별 필수 정보(허용 표현 포함). 3문장 nextTarget 확인에 쓴다. 단서 팩이 없으면 null.
 * 서버 안에서만 쓰며 학생 화면으로 보내지 않는다.
 */
export function cueTargetsOf(cues: QuestionCues | null): Record<AreaId, string[]> | null {
  if (!cues) return null;
  const accepted = cues.acceptedExpressions ?? [];
  return {
    object: [...(cues.coreObjects ?? []), ...accepted],
    feature: [...(cues.requiredAttributes ?? []), ...accepted],
    relation: [...(cues.requiredContext ?? []), ...accepted],
  };
}

/** 판정은 그대로 두고, 빠진 정보 목록만 단서 팩으로 확인되는 항목으로 줄인 사본. 단서 팩이 없으면 원본. */
function withVerifiedMissing(areas: AreaJudgments, cueTargets: Record<AreaId, string[]> | null): AreaJudgments {
  if (!cueTargets) return areas;
  const keep = (area: AreaId) => {
    const allowed = new Set(cueTargets[area].map(targetKey));
    return areas[area].missing.filter((m) => allowed.has(targetKey(m)));
  };
  return {
    object: { ...areas.object, missing: keep('object') },
    feature: { ...areas.feature, missing: keep('feature') },
    relation: { ...areas.relation, missing: keep('relation') },
  };
}

export function createGrading(deps: GradingDeps): GradingApi {
  const now = deps.now ?? (() => new Date());

  async function attemptOnce(
    callId: string,
    retryIndex: number,
    input: ModelCallInput,
    validate: { studentText: string; applicability: AreaApplicability }
  ): Promise<Attempt> {
    const startedAt = now();
    let out: ModelCallOutput;
    try {
      out = await deps.callModel(input);
    } catch (e) {
      const finishedAt = now();
      const name = e instanceof Error ? e.name : 'error';
      return {
        areas: null,
        raw: null,
        servedModel: null,
        failureKind: 'model_error',
        record: {
          callId,
          retryIndex,
          purpose: 'score',
          levels: null,
          failureReason: safeFailureReason('model_error', name),
          servedModel: null,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
        },
      };
    }
    const finishedAt = now();
    const base = {
      callId,
      retryIndex,
      purpose: 'score' as const,
      servedModel: out.servedModel ?? null,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
    const validated = validateAreaCall(out.output, validate);
    if (isAreaSchemaError(validated)) {
      // 범위 밖·소수·문자열·임의 null·원문에 없는 근거를 보정하지 않는다.
      return {
        areas: null,
        raw: out.output,
        servedModel: base.servedModel,
        failureKind: 'schema_error',
        record: { ...base, levels: null, failureReason: safeFailureReason('schema_error', validated.detail) },
      };
    }
    return {
      areas: validated,
      raw: out.output,
      servedModel: base.servedModel,
      failureKind: null,
      record: { ...base, levels: levelsOf(validated), failureReason: null },
    };
  }

  return {
    async runOperationalScoring(req: GradingRequest): Promise<ScoringRun> {
      // 밴드·이미지·단서·단계는 클라이언트가 아니라 서버 레지스트리가 확정한다.
      const entry = deps.registry.requireEntry(req.questionId, req.sessionType);
      // 연구 세션은 단서 없이 채점하지 않는다(getCues가 cues_missing으로 거부).
      // 일반 체험은 사전 확정 단서가 없으면 공통 문언만으로 채점하고 연구 자료로 쓰지 않는다.
      const commonOnly = req.sessionType === 'experience' && !entry.cuesLoaded;
      const band: Band = entry.band;
      const focusArea = entry.kind === 'practice' ? stageFocusArea(entry.lesson) : null;

      let imageHash = '';
      let cues: QuestionCues | null = null;
      let cuesMissing = false;
      if (!commonOnly) {
        try {
          cues = deps.registry.getCues(req.questionId);
        } catch (e) {
          const code = (e as { code?: unknown } | null)?.code;
          if (code !== 'cues_missing') throw e;
          cuesMissing = true;
        }
      }
      const applicability = applicabilityOf(cues, req.questionId);

      const prompt = buildEvaluationPrompt({
        band,
        studentPrompt: req.studentText,
        cues,
        noCuePolicy: commonOnly ? 'common_only' : 'refuse',
        focusArea,
        questionId: req.questionId,
      });
      // 단서가 없어 보내지 않을 지시문의 해시는 남기지 않는다(보낸 것처럼 보이지 않게).
      const hash = cuesMissing ? '' : await promptHash(prompt);

      const finish = (
        result: OperationalResult,
        calls: CallRecord[],
        feedback: FeedbackPresentation | null,
        servedModel: string | null
      ): ScoringRun => {
        let safeCalls = calls;
        try {
          deps.privacy.assertNoSecrets(calls);
        } catch {
          safeCalls = calls.map((c) => ({ ...c, failureReason: c.failureReason ? 'redacted' : null }));
        }
        // 피드백 문구도 점검한다. 걸리면 판정은 그대로 두고 문구만 고정 안내로 바꾼다.
        let safeFeedback = feedback;
        if (feedback) {
          try {
            deps.privacy.assertNoSecrets({ text: feedback.text, quote: feedback.quote });
          } catch {
            safeFeedback = {
              ...feedback,
              status: 'fallback',
              text: FEEDBACK_FALLBACK_TEXT,
              quote: null,
              strengthArea: null,
              nextArea: null,
              nextTarget: null,
            };
          }
        }
        const safeResult: OperationalResult =
          safeFeedback !== feedback && result.status === 'scored'
            ? { ...result, feedbackStatus: 'fallback' }
            : result;
        return {
          operationId: req.operationId,
          repeatIndex: req.repeatIndex,
          band,
          result: safeResult,
          calls: safeCalls,
          extraCall: false,
          feedback: safeFeedback,
          modelId: deps.modelId,
          servedModel,
          modelConfig: deps.modelConfig,
          // 이 절차가 실제로 쓴 공통 문언의 버전이다.
          rubricVersion: RUBRIC_VERSION,
          cueVersion: entry.cueVersion,
          applicabilitySource: cues
            ? 'cue_pack'
            : defaultNotApplicableAreas(req.questionId).length
              ? 'code_default'
              : 'model',
          focusArea,
          imageHash,
          promptHash: hash,
          codeCommit: deps.codeCommit,
          scoredAt: now().toISOString(),
        };
      };

      const missing = (reason: MissingReasonModel, calls: CallRecord[]) =>
        finish({ status: 'missing', areas: null, reason }, calls, null, null);

      /** 모델을 부르기 전에 끝난 사유를 남기는 기록 한 줄. 학생 원문은 넣지 않는다. */
      const preflightRecord = (suffix: string, reason: string): CallRecord => {
        const t = now().toISOString();
        return {
          callId: `${req.operationId}:${suffix}`,
          retryIndex: 0,
          purpose: 'score',
          levels: null,
          failureReason: reason,
          servedModel: null,
          startedAt: t,
          finishedAt: t,
          durationMs: 0,
        };
      };

      if (cuesMissing) {
        return missing('required_call_failed', [
          preflightRecord('cues', 'cues_missing: 문항 단서가 적재되지 않았습니다.'),
        ]);
      }

      // 외부 전송 전 개인정보 점검. hold_for_teacher이면 전송하지 않는다.
      const pii = deps.privacy.checkBeforeSend(req.studentText);
      if (pii.decision === 'hold_for_teacher') {
        return missing('required_call_failed', [
          preflightRecord('hold', `privacy_hold_for_teacher: ${pii.matchedTypes.join(',')}`),
        ]);
      }

      const asset = await deps.registry.loadImage(req.questionId);
      imageHash = asset.sha256;
      const image = {
        dataUri: `data:${asset.contentType};base64,${asset.bytes.toString('base64')}`,
        contentType: asset.contentType,
      };
      const input: ModelCallInput = {
        modelId: deps.modelId,
        modelConfig: deps.modelConfig,
        prompt,
        image,
        purpose: 'score',
      };
      const validate = { studentText: req.studentText, applicability };

      // 1. 모델 1회. 실패·형식 오류일 때만 1회 다시 부른다.
      const callId = `${req.operationId}:c1`;
      const first = await attemptOnce(callId, 0, input, validate);
      const attempts = [first];
      if (!first.areas) attempts.push(await attemptOnce(callId, 1, input, validate));
      const calls = attempts.map((a) => a.record);
      const success = attempts.find((a) => a.areas) ?? null;
      if (!success || !success.areas) {
        const last = attempts[attempts.length - 1];
        return missing(last.failureKind === 'schema_error' ? 'schema_error' : 'model_error', calls);
      }

      const areas = success.areas;
      const scored: OperationalResult = { status: 'scored', areas, feedbackStatus: 'not_requested' };

      // 2. 판정은 여기서 확정된다. 아래 피드백 절차는 판정을 바꾸지 않는다.
      if (!req.wantFeedback) {
        return finish(scored, calls, feedbackNotRequested(), success.servedModel);
      }

      const levels = levelsOf(areas);
      const requiredNextArea = nextActionArea(levels, focusArea);
      // 단서 팩이 있으면 3문장이 겨냥할 정보를 단서 팩의 필수 정보로 한 번 더 확인한다(그림에 없는 정보 요구 차단).
      const cueTargets = cueTargetsOf(cues);
      const feedback = await produceFeedback({
        context: {
          studentText: req.studentText,
          levels,
          missing: {
            object: areas.object.missing,
            feature: areas.feature.missing,
            relation: areas.relation.missing,
          },
          requiredNextArea,
          cueTargets,
        },
        generate: async (attempt): Promise<FeedbackDraft | null> => {
          if (attempt === 0) return extractFeedbackDraft(success.raw);
          // 피드백만 다시 만든다. 확정된 판정을 알려 주고 판정은 다시 받지 않는다.
          const startedAt = now();
          const record: CallRecord = {
            callId: `${req.operationId}:f1`,
            retryIndex: 0,
            purpose: 'feedback',
            levels: null,
            failureReason: null,
            servedModel: null,
            startedAt: startedAt.toISOString(),
            finishedAt: startedAt.toISOString(),
            durationMs: 0,
          };
          calls.push(record);
          try {
            const out = await deps.callModel({
              ...input,
              purpose: 'feedback',
              prompt: buildFeedbackPrompt({
                studentPrompt: req.studentText,
                // 다시 만들 때는 단서 팩으로 확인되는 빠진 정보만 알려 준다. 판정(수준)은 그대로다.
                areas: withVerifiedMissing(areas, cueTargets),
                focusArea,
                requiredNextArea,
              }),
            });
            record.servedModel = out.servedModel ?? null;
            const draft = extractFeedbackDraft(out.output);
            if (!draft) record.failureReason = 'schema_error: 피드백 형식 오류';
            return draft;
          } catch (e) {
            record.failureReason = safeFailureReason('model_error', e instanceof Error ? e.name : 'error');
            throw e;
          } finally {
            const finishedAt = now();
            record.finishedAt = finishedAt.toISOString();
            record.durationMs = finishedAt.getTime() - startedAt.getTime();
          }
        },
      });

      return finish({ ...scored, feedbackStatus: feedback.status }, calls, feedback, success.servedModel);
    },
  };
}
