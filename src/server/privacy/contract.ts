import 'server-only';

/**
 * 전송 전 개인정보 점검 계약. 구현은 src/server/privacy/index.ts.
 *
 * 필터를 통과했다고 개인정보가 완전히 제거되었다고 표시하지 않는다.
 * 의심 내용은 외부 전송을 멈추고 교사 확인을 받는다(설계서 §6).
 */

export type PiiDecision = 'pass' | 'hold_for_teacher';

export interface PiiCheckResult {
  decision: PiiDecision;
  /** 탐지된 유형만 남긴다. 원문 조각은 로그에 남기지 않는다. */
  matchedTypes: string[];
  /** 점검 규칙 버전 */
  checkVersion: string;
  /** 점검은 보조 수단이라는 사실을 화면·문서에 함께 표시하기 위한 문구 */
  notice: string;
}

export interface PrivacyApi {
  /** 학생 입력을 외부 모델에 보내기 전에 점검한다. */
  checkBeforeSend(text: string): PiiCheckResult;
  /** 저장·로그에 남길 때 원시 인증토큰·키가 섞이지 않았는지 확인한다. */
  assertNoSecrets(payload: unknown): void;
}
