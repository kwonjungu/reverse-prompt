/**
 * PrivacyApi 구현 — 전송 전 개인정보 점검.
 *
 * 원칙(설계서 §3, §6)
 *  - 입력 텍스트의 개인정보를 전송 전에 점검하고 의심 내용은 외부 전송을 멈춰
 *    교사 확인을 받는다.
 *  - 필터를 통과했다고 개인정보가 완전히 제거되었다고 표시하지 않는다.
 *  - 탐지 결과 로그에 원문 조각을 남기지 않는다. 유형만 남긴다.
 *  - 호출 원문과 오류 기록에 비밀키·원시 인증토큰을 남기지 않는다.
 *
 * 이 파일은 'server-only'를 import 하지 않는다. 정규식 판정만 하는 순수 모듈이라
 * 순수 함수 테스트가 그대로 불러 쓴다. 사용은 서버 경로에서만 한다.
 */

import type { PiiCheckResult, PrivacyApi } from './contract';

export const PII_CHECK_VERSION = 'pii-v7.0';

/**
 * 화면·문서에 함께 표시하는 한계 고지.
 * '개인정보가 모두 제거되었다'는 뜻으로 읽히지 않게 쓴다.
 */
export const PII_NOTICE =
  '이 점검은 흔한 형태만 찾아내는 보조 장치입니다. 통과했더라도 개인정보가 모두 지워졌다는 뜻은 아니므로, 보내기 전에 스스로 한 번 더 살펴봅니다.';

export const PII_HOLD_NOTICE =
  '개인정보로 보이는 내용이 있어 보내지 않고 멈추었습니다. 선생님과 함께 확인한 뒤 다시 보냅니다. 이 점검은 보조 장치이므로 통과 여부와 무관하게 개인정보를 적지 않는 것이 원칙입니다.';

/** 흔한 한국 성씨 일부. 이름 탐지의 오탐을 줄이기 위한 보조 목록이다. */
const SURNAMES =
  '김|이|박|최|정|강|조|윤|장|임|한|오|서|신|권|황|안|송|류|유|전|홍|고|문|양|손|배|백|허|남|심|노|하|곽|성|차|주|우|구|민|진|지|엄|채|원|천|방|공|현';

interface Rule {
  type: string;
  test: RegExp;
}

/**
 * 탐지 규칙. 정규식은 텍스트가 '의심스러운가'만 판정하며
 * 일치한 문자열은 어디에도 보관하지 않는다.
 */
const RULES: Rule[] = [
  // 주민등록번호 형태
  { type: 'national_id', test: /(?:^|\D)\d{6}\s?[-–]\s?[1-4]\d{6}(?:\D|$)/ },
  // 휴대전화·일반전화
  { type: 'phone', test: /(?:^|\D)01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?:\D|$)/ },
  { type: 'phone', test: /(?:^|\D)0\d{1,2}[-.\s]\d{3,4}[-.\s]\d{4}(?:\D|$)/ },
  { type: 'phone', test: /(?:전화번호|휴대폰|핸드폰|폰번호|연락처)\s*(?:는|은|:|：)?\s*[\d\-.\s]{7,}/ },
  // 생년월일
  {
    type: 'birthdate',
    test: /(?:19|20)\d{2}\s*[년.\-/]\s*(?:0?[1-9]|1[0-2])\s*[월.\-/]\s*(?:0?[1-9]|[12]\d|3[01])\s*일?/,
  },
  { type: 'birthdate', test: /(?:생년월일|생일)\s*(?:은|는|:|：)?\s*[\d\s년월일.\-/]{5,}/ },
  // 학교명
  { type: 'school', test: /[가-힣]{2,10}(?:초등학교|중학교|고등학교|유치원|초교)/ },
  { type: 'school', test: /(?:학교\s*(?:이름|명))\s*(?:은|는|:|：)?\s*[가-힣]{2,}/ },
  // 주소
  { type: 'address', test: /[가-힣]{2,6}(?:특별시|광역시|특별자치시|특별자치도)/ },
  { type: 'address', test: /[가-힣]{2,10}(?:시|군|구)\s*[가-힣0-9]{1,12}(?:동|읍|면|리)(?:\s|$|[0-9])/ },
  { type: 'address', test: /[가-힣A-Za-z0-9]{1,15}(?:로|길)\s*\d+(?:-\d+)?\b/ },
  { type: 'address', test: /\d+\s*동\s*\d+\s*호/ },
  { type: 'address', test: /(?:주소|사는\s*곳|우리\s*집)\s*(?:은|는|:|：)\s*\S+/ },
  // 계정·연락 수단
  { type: 'account', test: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { type: 'account', test: /(?:아이디|계정|비밀번호|비번|카톡|카카오톡|인스타|디스코드)\s*(?:은|는|:|：)?\s*\S{2,}/ },
  // 학교 내 식별 번호
  { type: 'student_number', test: /(?:출석번호|학번)\s*(?:은|는|:|：)?\s*\d{1,4}/ },
  // 이름
  { type: 'name', test: /(?:이름|성함)\s*(?:은|는|:|：)\s*[가-힣]{2,4}/ },
  {
    type: 'name',
    test: new RegExp(
      `(?:^|[\\s,.("'])(?:${SURNAMES})[가-힣]{1,2}\\s*(?:입니다|이에요|예요|이라고|라고 해|이라고 해|님|선생님|어린이)`
    ),
  },
  {
    type: 'name',
    test: new RegExp(`(?:저는|나는|제\\s*이름은|내\\s*이름은)\\s*(?:${SURNAMES})[가-힣]{1,2}(?:\\s|입니|이에|예요|이야|야|$)`),
  },
];

/** 탐지된 유형 목록. 원문 조각을 돌려주지 않는다. */
export function detectPiiTypes(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const found = new Set<string>();
  for (const rule of RULES) {
    if (rule.test.test(text)) found.add(rule.type);
  }
  return [...found].sort();
}

function checkBeforeSend(text: string): PiiCheckResult {
  const matchedTypes = detectPiiTypes(text ?? '');
  const hold = matchedTypes.length > 0;
  return {
    decision: hold ? 'hold_for_teacher' : 'pass',
    matchedTypes,
    checkVersion: PII_CHECK_VERSION,
    notice: hold ? PII_HOLD_NOTICE : PII_NOTICE,
  };
}

/** 로그에 남길 요약. 원문·원문 조각을 넣지 않는다. */
export function toPiiLogEntry(result: PiiCheckResult): {
  decision: string;
  matchedTypes: string[];
  checkVersion: string;
} {
  return {
    decision: result.decision,
    matchedTypes: [...result.matchedTypes],
    checkVersion: result.checkVersion,
  };
}

// ── 비밀키·인증토큰 점검 ────────────────────────────────────

export class SecretLeakError extends Error {
  constructor(readonly types: string[]) {
    // 메시지에 일치한 값을 넣지 않는다. 유형만 적는다.
    super(`전송·저장할 수 없는 자격정보가 포함되어 있습니다(${types.join(', ')}).`);
    this.name = 'SecretLeakError';
  }
}

const SECRET_RULES: Rule[] = [
  { type: 'google_api_key', test: /AIza[0-9A-Za-z_-]{30,}/ },
  { type: 'google_oauth_token', test: /ya29\.[0-9A-Za-z_-]{20,}/ },
  { type: 'openai_style_key', test: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { type: 'aws_access_key', test: /\bAKIA[0-9A-Z]{16}\b/ },
  { type: 'private_key_block', test: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { type: 'jwt', test: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { type: 'bearer_token', test: /\bBearer\s+[A-Za-z0-9._-]{20,}/i },
  {
    type: 'credential_assignment',
    test: /(?:API[_-]?KEY|SECRET|PASSWORD|CREDENTIAL|SERVICE_ACCOUNT|ACCESS[_-]?TOKEN)\s*[=:]\s*["']?[A-Za-z0-9._/+-]{12,}/i,
  },
];

const SECRET_KEY_NAMES = [
  'private_key',
  'privatekey',
  'client_secret',
  'clientsecret',
  'apikey',
  'api_key',
  'serviceaccount',
  'service_account',
  'sessioncookie',
  'idtoken',
  'id_token',
  'refreshtoken',
  'refresh_token',
  'authorization',
];

function collectSecretTypes(value: unknown, found: Set<string>, depth: number): void {
  if (depth > 8 || value == null) return;
  if (typeof value === 'string') {
    for (const rule of SECRET_RULES) {
      if (rule.test.test(value)) found.add(rule.type);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSecretTypes(item, found, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_NAMES.includes(k.toLowerCase())) found.add('credential_field');
      collectSecretTypes(v, found, depth + 1);
    }
  }
}

function assertNoSecrets(payload: unknown): void {
  const found = new Set<string>();
  collectSecretTypes(payload, found, 0);
  if (found.size > 0) throw new SecretLeakError([...found].sort());
}

export const privacy: PrivacyApi = {
  checkBeforeSend,
  assertNoSecrets,
};

export type { PiiCheckResult, PiiDecision } from './contract';
