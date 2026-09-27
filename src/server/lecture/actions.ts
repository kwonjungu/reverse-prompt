'use server';

/**
 * 연수(강의) 모드의 server action.
 *
 * 이 경로가 무엇인가
 *   - 교사 연수에서 강사와 참가자가 앱을 바로 써 보기 위한 시연용 경로다.
 *     수업 번호·교사 로그인·차시 개방·동의 절차를 거치지 않는다.
 *   - 채점은 일반 체험(sessionType: 'experience')과 같은 규칙을 쓴다(공통 루브릭 v12-2,
 *     3영역 4수준). 비공개 단서 팩이 적재되어 있지 않으면 공통 루브릭 문언만으로 채점되고,
 *     적재되어 있으면(파일 또는 관리 화면에서 올린 사본) 일반 체험과 같이 그 단서로 채점된다.
 *   - 화면에는 연습 화면과 같이 영역별 수준(대상 ●●●○)과 네 문장 피드백만 돌려준다.
 *     100점 점수는 만들지도 돌려주지도 않는다. 근거·빠진 정보 목록은 화면에 필요 없어 내보내지 않는다.
 *
 * 이 경로가 아닌 것 (여기서 지켜야 할 경계)
 *   - **연구 자료가 아니다.** 제출·채점 결과·피드백을 어디에도 저장하지 않는다.
 *     Firestore에 쓰지 않고, 연구 저장소의 어떤 컬렉션도 건드리지 않는다. 채점기가 채점 전에
 *     단서 팩 사본(admin_config/cue_pack)을 읽을 수 있는 것이 Firestore에 닿는 유일한 경우다(읽기만).
 *   - 학생 세션·차시 개방·동의 판정을 대신하는 우회로가 아니다. 연구 경로가 쓰는
 *     @/server/auth와 @/server/lessons의 판정을 바꾸지 않으며, 여기서 얻은 쿠키로는
 *     연구 화면(검사·연습·감수)에 들어갈 수 없다. 그쪽은 그대로 서버 세션을 요구한다.
 *   - 문항은 연수용 고정 20개로 한정한다. 검사 문항(T1·T2_v7·T3)은 레지스트리가
 *     research_assessment 세션에만 허용하므로 여기서는 애초에 열리지 않는다.
 *
 * 접근 제한
 *   LECTURE_CODE(기본 '1111')를 한 번 입력하면 HttpOnly 쿠키를 심고, 채점 요청은
 *   그 쿠키가 있을 때만 받는다. 연수장에서 공유하는 값이므로 비밀번호로 보지 않는다.
 *   막으려는 것은 URL이 밖으로 퍼졌을 때 지나가는 사람이 모델 호출을 소비하는 일이다.
 *
 *   연구 세션 힌트 쿠키가 있는 요청은 입장·채점을 모두 거절한다. 연구 참가 학생이
 *   연수 번호를 알아도 연구 밖에서 AI 채점 연습을 받지 않게 하기 위해서다(middleware와 같은 판정,
 *   mode-policy.ts의 isLectureBlockedFor). 힌트만 읽으며 이 판정을 위해 Firestore를 열지 않는다.
 */

import 'server-only';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';

import { grading } from '@/server/grading';
import { privacy } from '@/server/privacy';
import { LECTURE_CODE } from '@/server/config';
import { MODE_BLOCKED_MESSAGE, isLectureBlockedFor } from '@/server/lessons/mode-policy';
import { SESSION_HINT_COOKIE, parseSessionHint } from '@/server/lessons/session-cookie';
import {
  isAllowedLectureQuestion,
  isLectureCodeValid,
  lectureResultOf,
  LECTURE_SCORING_MISSING_MESSAGE,
  LECTURE_CODE_WRONG_MESSAGE,
  LECTURE_LOCKED_MESSAGE,
  LECTURE_UNKNOWN_QUESTION_MESSAGE,
  type LectureFeedback,
  type LectureScoring,
} from './core';

/** 연수 모드 입장 표시. 연구 세션 토큰과 이름을 겹치지 않게 둔다. */
const LECTURE_COOKIE = 'rp_lecture';
const LECTURE_COOKIE_VALUE = 'ok';
/** 연수 한 회차를 넘기는 길이면 충분하다. */
const LECTURE_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

const PII_HOLD_MESSAGE =
  '개인정보로 보이는 내용이 있어 보내지 않았어요. 이름·전화번호 같은 것을 빼고 다시 써 주세요.';

export interface LectureEntryResult {
  ok: boolean;
  message: string | null;
}

/** 이 요청에 연구 세션 힌트가 있는가. 있으면 연수 체험판을 열지 않는다. */
async function researchSessionPresent(): Promise<boolean> {
  const store = await cookies();
  const hint = parseSessionHint(store.get(SESSION_HINT_COOKIE)?.value);
  return isLectureBlockedFor(hint?.sessionType);
}

/** 지금 요청이 연수 모드에 들어와 있는가. 화면 표시와 채점 판정이 함께 쓴다. */
export async function isLectureUnlockedAction(): Promise<boolean> {
  if (await researchSessionPresent()) return false;
  const store = await cookies();
  return store.get(LECTURE_COOKIE)?.value === LECTURE_COOKIE_VALUE;
}

/** 연수 번호를 확인하고 입장 표시를 심는다. */
export async function enterLectureAction(code: string): Promise<LectureEntryResult> {
  if (await researchSessionPresent()) return { ok: false, message: MODE_BLOCKED_MESSAGE };
  if (!isLectureCodeValid(code, LECTURE_CODE)) {
    return { ok: false, message: LECTURE_CODE_WRONG_MESSAGE };
  }
  const store = await cookies();
  store.set(LECTURE_COOKIE, LECTURE_COOKIE_VALUE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: LECTURE_COOKIE_MAX_AGE_SECONDS,
  });
  return { ok: true, message: null };
}

export async function leaveLectureAction(): Promise<void> {
  const store = await cookies();
  store.delete(LECTURE_COOKIE);
}

export interface LectureEvaluateInput {
  /** 연수용 고정 20문항 가운데 하나의 ID(L01~L36 규칙). */
  questionId: string;
  /** 참가자가 쓴 한국어 설명. 평가 대상 데이터이며 채점 지시가 아니다. */
  text: string;
}

export type LectureEvaluateResult =
  | { status: 'blocked'; message: string }
  | {
      status: 'done';
      questionId: string;
      band: string;
      /**
       * 채점 결과. 연습 화면(SubmitPracticeResult)과 같은 모양이다. 100점 점수는 없다.
       * levels는 영역별 1~4 또는 'not_applicable'(화면에서 숨김). 결측은 수준을 지어내지 않고 missing이다.
       */
      scoring: LectureScoring;
      /** 네 문장(한 줄에 한 문장). 검증에 실패하면 고정 안내(status 'fallback')다. */
      feedback: LectureFeedback;
    };

/**
 * 연수 모드 채점. 저장하지 않는다.
 *
 * 화면에서 무엇을 보여 주었는지와 무관하게 여기서 다시 판정한다.
 *   1) 연수 번호를 통과한 요청인가
 *   2) 연수 목록에 있는 문항인가
 *   3) 외부로 보내기 전 개인정보 점검을 통과하는가
 */
export async function evaluateLectureAction(
  input: LectureEvaluateInput
): Promise<LectureEvaluateResult> {
  const blocked = (message: string): LectureEvaluateResult => ({ status: 'blocked', message });

  if (await researchSessionPresent()) return blocked(MODE_BLOCKED_MESSAGE);
  if (!(await isLectureUnlockedAction())) return blocked(LECTURE_LOCKED_MESSAGE);

  const questionId = typeof input?.questionId === 'string' ? input.questionId.trim() : '';
  if (!isAllowedLectureQuestion(questionId)) return blocked(LECTURE_UNKNOWN_QUESTION_MESSAGE);

  const text = typeof input?.text === 'string' ? input.text.trim() : '';
  if (!text) return blocked('아직 아무것도 쓰지 않았어요.');

  if (privacy.checkBeforeSend(text).decision === 'hold_for_teacher') {
    return blocked(PII_HOLD_MESSAGE);
  }

  let run;
  try {
    run = await grading.runOperationalScoring({
      questionId,
      studentText: text,
      operationId: randomUUID(),
      repeatIndex: 1,
      // 연수는 일반 체험과 같은 규칙으로 채점한다. 연구 자료로 쓰지 않는다.
      sessionType: 'experience',
      wantFeedback: true,
    });
  } catch (err) {
    // 설정 오류를 점수 0으로 바꾸지 않는다. 채점하지 못했다고 그대로 알린다.
    return blocked(err instanceof Error ? err.message : LECTURE_SCORING_MISSING_MESSAGE);
  }

  // 결측이면 수준·피드백을 지어내지 않는다(lectureResultOf). 100점 점수는 만들지 않는다.
  return { status: 'done', questionId, band: run.band, ...lectureResultOf(run) };
}
