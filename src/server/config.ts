import 'server-only';

import { DEFAULT_LECTURE_CODE } from '@/server/lecture/core';

/**
 * 서버 전용 운영 설정의 단일 지점.
 *
 * 모델 ID는 운영자가 실제 사용 가능한 값을 확인해 환경 변수로 지정한다.
 * 코드가 임의로 다른 모델명을 골라 사용 가능하다고 단정하지 않으므로,
 * 기본값은 저장소에 이미 있던 값을 그대로 둔다(존재 확인은 운영자의 몫).
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §3, §6
 */

/** 착수 검수에서 접근·출력 스키마를 확인한 뒤 고정한다. */
export const EVALUATION_MODEL_ID =
  process.env.EVALUATION_MODEL_ID?.trim() || 'googleai/gemini-3.8-flash';

export const EVALUATION_MODEL_CONFIG = {
  temperature: Number(process.env.EVALUATION_TEMPERATURE ?? 0.2),
} as const;

/** 운영자가 모델 접근을 확인했다고 기록했는가. 미확인이면 연구 시작을 막는다. */
export const MODEL_ACCESS_VERIFIED = process.env.EVALUATION_MODEL_VERIFIED === 'true';

/**
 * 비공개 연구 자산(검사 이미지·문항별 단서 팩)의 위치.
 * 공개 저장소에 커밋하지 않으며 이 경로가 없으면 연구용 흐름을 열지 않는다.
 */
export const RESEARCH_ASSET_DIR = process.env.RESEARCH_ASSET_DIR?.trim() || '';

/** 배포된 코드의 커밋. 저장 문서에 남긴다. */
export const CODE_COMMIT =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_COMMIT_SHA ||
  process.env.CODE_COMMIT ||
  'unknown';

/** 현재 유효한 동의서 버전. 미설정이면 연구 동의를 받을 수 없다. */
export const CONSENT_VERSION = process.env.CONSENT_VERSION?.trim() || '';

/** IRB 승인 번호. 코드가 만들어 낼 수 없는 값이므로 누락 상태를 그대로 노출한다. */
export const IRB_APPROVAL = process.env.IRB_APPROVAL?.trim() || '';

/**
 * 연수(강의) 모드 입장 번호. 연수장에서 공유하는 값이며 비밀번호가 아니다.
 * 비워 두어도 기본값으로 동작한다 — 이 값이 막는 것은 URL이 퍼졌을 때의 무작위
 * 접근이지 인증이 아니다. 연구 경로의 권한 판정에는 쓰이지 않는다.
 */
export const LECTURE_CODE = process.env.LECTURE_CODE?.trim() || DEFAULT_LECTURE_CODE;

/** 서버 Firebase Admin 자격. 없으면 서버 권한 검증을 할 수 없다. */
export const FIREBASE_ADMIN_CREDENTIAL = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || '';
