/**
 * 운영 채점 1회의 절차 — 독립 2회 호출, 조건부 3회, 축별 결합.
 *
 * 논문 대응: <표 Ⅲ-7> 운영 채점 1회의 결합 규칙 / 설계서 §3
 *
 * 이 파일은 모델·레지스트리·개인정보 점검을 모두 주입받는 오케스트레이션이다.
 * 서버 전용 기본 구현을 붙이는 곳은 src/server/grading/index.ts이며,
 * 여기에는 'server-only'를 두지 않아 가짜 모델로 전 경로를 시험할 수 있다.
 *
 * 결측은 0점이 아니다. 일부 성공 값만으로 정상 결과를 만들지 않는다.
 * 점수가 확정된 뒤에는 피드백 생성·검증이 실패해도 재채점하거나 점수를 바꾸지 않는다.
 */

import {
  combine,
  toScores,
  validateSingleCall,
  isAxisSchemaError,
  withinOneLevel,
  type AxisLevels,
  type Band,
} from '@/lib/scoring';
import { buildEvaluationPrompt, promptHash } from '@/lib/evaluation-prompt';
import {
  FEEDBACK_FALLBACK_TEXT,
  produceFeedback,
  feedbackNotRequested,
  type FeedbackDraft,
} from '@/lib/feedback';
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
}

/** 모델 호출 함수. 검증하지 않은 원 출력을 그대로 돌려준다. */
export type CallModel = (input: ModelCallInput) => Promise<unknown>;

export interface GradingDeps {
  callModel: CallModel;
  registry: Pick<RegistryApi, 'requireEntry' | 'getCues' | 'loadImage'>;
  privacy: Pick<PrivacyApi, 'checkBeforeSend' | 'assertNoSecrets'>;
  modelId: string;
  modelConfig: Record<string, unknown>;
  codeCommit: string;
  /** 시각·식별자 주입. 테스트에서 고정한다. */
  now?: () => Date;
}

type FailureKind = 'model_error' | 'schema_error';

interface Attempt {
  levels: AxisLevels | null;
  draft: FeedbackDraft | null;
  record: CallRecord;
  failureKind: FailureKind | null;
}

/** 모델 원 출력에서 피드백 초안만 뽑는다. 없으면 null. */
function extractDraft(raw: unknown): FeedbackDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const line1 = str(r.feedbackLine1);
  const line2 = str(r.feedbackLine2);
  const line3 = str(r.feedbackLine3);
  const line4 = str(r.feedbackLine4);
  if (!line1 && !line2 && !line3 && !line4) return null;
  const quote = typeof r.quote === 'string' ? r.quote : null;
  return { line1, line2, line3, line4, quote };
}

/** 기록에 학생 원문·비밀값이 섞이지 않도록 유형과 짧은 사유만 남긴다. */
function safeFailureReason(kind: FailureKind, detail: string): string {
  return `${kind}: ${detail.replace(/\s+/g, ' ').slice(0, 120)}`;
}

/**
 * 모델 설정을 그대로 쓰기 전에 값이 실제로 쓸 수 있는 수인지 확인한다.
 *
 * EVALUATION_TEMPERATURE에 숫자가 아닌 값이 들어오면 Number()가 NaN이 되고, 그대로
 * 호출에 실려 가면 모든 채점이 실패하거나 설정 없이 호출된 것과 구별되지 않는다.
 * 여기서 기본값으로 되돌리고 어떤 값을 썼는지 기록에 남긴다(config.ts는 손대지 않는다).
 */
export function resolveModelConfig(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const config = { ...raw };
  const t = config.temperature;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > 2) {
    console.warn('[grading] EVALUATION_TEMPERATURE 값을 쓸 수 없어 기본값 0.2로 채점합니다.');
    config.temperature = 0.2;
  }
  return config;
}

export function createGrading(deps: GradingDeps): GradingApi {
  const now = deps.now ?? (() => new Date());

  async function attemptOnce(
    callId: string,
    retryIndex: number,
    band: Band,
    input: ModelCallInput,
  ): Promise<Attempt> {
    const startedAt = now();
    let raw: unknown;
    try {
      raw = await deps.callModel(input);
    } catch (e) {
      const finishedAt = now();
      const name = e instanceof Error ? e.name : 'error';
      return {
        levels: null,
        draft: null,
        failureKind: 'model_error',
        record: {
          callId,
          retryIndex,
          levels: null,
          failureReason: safeFailureReason('model_error', name),
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
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
    const validated = validateSingleCall(raw, band);
    if (isAxisSchemaError(validated)) {
      // 범위 밖·소수·문자열·NaN·임의 null을 최저 수행으로 보정하지 않는다.
      return {
        levels: null,
        draft: null,
        failureKind: 'schema_error',
        record: {
          ...base,
          levels: null,
          failureReason: safeFailureReason('schema_error', validated.detail),
        },
      };
    }
    return {
      levels: validated,
      draft: extractDraft(raw),
      failureKind: null,
      record: { ...base, levels: validated, failureReason: null },
    };
  }

  /** 한 호출을 수행하고, 실패한 경우에만 1회 재시도한다. */
  async function runCall(
    index: number,
    operationId: string,
    band: Band,
    input: ModelCallInput,
  ): Promise<{ attempts: Attempt[]; success: Attempt | null }> {
    const callId = `${operationId}:c${index}`;
    const first = await attemptOnce(callId, 0, band, input);
    if (first.levels) return { attempts: [first], success: first };
    const retry = await attemptOnce(callId, 1, band, input);
    return { attempts: [first, retry], success: retry.levels ? retry : null };
  }

  return {
    async runOperationalScoring(req: GradingRequest): Promise<ScoringRun> {
      // 밴드·이미지·단서는 클라이언트가 아니라 서버 레지스트리가 확정한다.
      const entry = deps.registry.requireEntry(req.questionId, req.sessionType);
      // 연구 세션은 단서 없이 채점하지 않는다(getCues가 cues_missing으로 거부).
      // 일반 체험은 사전 확정 단서가 없으면 공통 문언만으로 채점하고 연구 자료로 쓰지 않는다.
      const commonOnly = req.sessionType === 'experience' && !entry.cuesLoaded;
      const band = entry.band;

      // 채점에 실제로 보낸 이미지의 해시. 이미지를 열기 전에 끝나면 빈 문자열로 남긴다.
      let imageHash = '';

      let cues: QuestionCues | null = null;
      let cuesMissing = false;
      if (!commonOnly) {
        try {
          cues = deps.registry.getCues(req.questionId);
        } catch (e) {
          // 단서 없이 채점하지 않는다는 원칙은 그대로다. 다만 호출자가 화면에서 다루도록
          // 서버 예외로 밖으로 내보내지 않고 이 채점 1회를 결측으로 마감한다.
          const code = (e as { code?: unknown } | null)?.code;
          if (code !== 'cues_missing') throw e;
          cuesMissing = true;
        }
      }

      const prompt = buildEvaluationPrompt({
        band,
        studentPrompt: req.studentText,
        cues,
        noCuePolicy: commonOnly ? 'common_only' : 'refuse',
      });
      // 단서가 없어 보내지 않을 지시문의 해시는 남기지 않는다(보낸 것처럼 보이지 않게).
      const hash = cuesMissing ? '' : await promptHash(prompt);

      const finish = (
        result: OperationalResult,
        calls: CallRecord[],
        extraCall: boolean,
        feedback: FeedbackPresentation | null,
      ): ScoringRun => {
        // 저장·로그에 비밀값이 섞이지 않았는지 확인한다. 걸리면 사유를 지우고 진행한다.
        let safeCalls = calls;
        try {
          deps.privacy.assertNoSecrets(calls);
        } catch {
          safeCalls = calls.map((c) => ({
            ...c,
            failureReason: c.failureReason ? 'redacted' : null,
          }));
        }
        // 피드백 문구도 함께 점검한다. 모델이 지시문에 있던 값을 되받아 적을 수 있으므로
        // 호출 기록만 보는 것으로는 부족하다. 걸리면 점수는 그대로 두고 문구만 대체한다.
        let safeFeedback = feedback;
        if (feedback) {
          try {
            deps.privacy.assertNoSecrets({ text: feedback.text, quote: feedback.quote });
          } catch {
            safeFeedback = {
              status: 'fallback',
              text: FEEDBACK_FALLBACK_TEXT,
              quote: null,
              regenerated: feedback.regenerated,
            };
          }
        }
        // 문구를 대체했으면 결과의 feedbackStatus도 함께 fallback으로 맞춘다. 점수는 그대로다.
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
          extraCall,
          feedback: safeFeedback,
          modelId: deps.modelId,
          modelConfig: deps.modelConfig,
          // 레지스트리 항목의 값이 그대로 기록이다. 여기서 다른 값으로 대체하지 않는다.
          rubricVersion: entry.rubricVersion,
          cueVersion: entry.cueVersion,
          imageHash,
          promptHash: hash,
          codeCommit: deps.codeCommit,
          scoredAt: now().toISOString(),
        };
      };

      const missing = (reason: MissingReasonModel, calls: CallRecord[], extraCall = false) =>
        finish(
          { status: 'missing', levels: null, score: null, axisScores: null, reason },
          calls,
          extraCall,
          null,
        );

      /** 모델을 부르기 전에 끝난 사유를 남기는 기록 한 줄. 학생 원문은 넣지 않는다. */
      const preflightRecord = (suffix: string, reason: string): CallRecord => {
        const t = now().toISOString();
        return {
          callId: `${req.operationId}:${suffix}`,
          retryIndex: 0,
          levels: null,
          failureReason: reason,
          startedAt: t,
          finishedAt: t,
          durationMs: 0,
        };
      };

      // 사전 확정 단서가 없는 연구 세션. 채점하지 않되 서버 예외 대신 결측으로 마감한다.
      if (cuesMissing) {
        return missing('required_call_failed', [
          preflightRecord('cues', 'cues_missing: 문항 단서가 적재되지 않았습니다.'),
        ]);
      }

      // 외부 전송 전 개인정보 점검. hold_for_teacher이면 전송하지 않는다.
      const pii = deps.privacy.checkBeforeSend(req.studentText);
      if (pii.decision === 'hold_for_teacher') {
        // 탐지된 유형만 남기고 원문 조각은 남기지 않는다.
        return missing('required_call_failed', [
          preflightRecord('hold', `privacy_hold_for_teacher: ${pii.matchedTypes.join(',')}`),
        ]);
      }

      const asset = await deps.registry.loadImage(req.questionId);
      // 실제로 보낸 이미지의 해시를 기록한다. 연습 문항은 명세 해시가 없으므로 계산값이다.
      imageHash = asset.sha256;
      const input: ModelCallInput = {
        modelId: deps.modelId,
        modelConfig: deps.modelConfig,
        prompt,
        image: {
          dataUri: `data:${asset.contentType};base64,${asset.bytes.toString('base64')}`,
          contentType: asset.contentType,
        },
      };

      const calls: CallRecord[] = [];

      // 1. 같은 고정 입력으로 독립 2회. 실패한 호출만 1회 재시도.
      const [r1, r2] = await Promise.all([
        runCall(1, req.operationId, band, input),
        runCall(2, req.operationId, band, input),
      ]);
      calls.push(...r1.attempts.map((a) => a.record), ...r2.attempts.map((a) => a.record));

      if (!r1.success || !r2.success) {
        const failed = (r1.success ? r2 : r1).attempts;
        const lastKind = failed[failed.length - 1].failureKind;
        return missing(lastKind === 'schema_error' ? 'schema_error' : 'model_error', calls);
      }

      const valid: Attempt[] = [r1.success, r2.success];
      let extraCall = false;

      // 2·3. 한 축이라도 1수준을 넘게 벌어지면 세 번째 유효 호출을 얻어 축별 중앙값.
      if (!withinOneLevel(r1.success.levels as AxisLevels, r2.success.levels as AxisLevels)) {
        const r3 = await runCall(3, req.operationId, band, input);
        calls.push(...r3.attempts.map((a) => a.record));
        if (!r3.success) {
          // 세 번째도 실패하면 운영 결측. 두 값의 평균으로 대체하지 않는다.
          return missing('required_call_failed', calls, true);
        }
        valid.push(r3.success);
        extraCall = true;
      }

      const levels = combine(
        valid.map((v) => v.levels as AxisLevels),
        extraCall,
      );
      const s = toScores(levels, band);
      const scored: OperationalResult = {
        status: 'scored',
        levels,
        score: s.total,
        axisScores: { object: s.object, specificity: s.specificity, context: s.context },
        feedbackStatus: 'not_requested',
      };

      // 5. 점수는 여기서 확정된다. 아래 피드백 절차는 점수를 바꾸지 않는다.
      if (!req.wantFeedback) {
        return finish(scored, calls, extraCall, feedbackNotRequested());
      }

      const firstDraft = valid.find((v) => v.draft)?.draft ?? null;
      const feedback = await produceFeedback({
        studentText: req.studentText,
        generate: async (attempt) => {
          if (attempt === 0 && firstDraft) return firstDraft;
          // 피드백만 다시 생성한다. 이 호출의 수준 판정은 점수에 반영하지 않는다.
          const raw = await deps.callModel(input);
          const draft = extractDraft(raw);
          if (!draft) throw new Error('피드백 형식 오류');
          return draft;
        },
      });

      return finish(
        { ...scored, feedbackStatus: feedback.status },
        calls,
        extraCall,
        feedback,
      );
    },
  };
}
