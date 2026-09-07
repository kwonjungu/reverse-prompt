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

/**
 * 점검 규칙 버전. 규칙을 고치면 올린다. 저장된 점검 기록이 어떤 규칙으로 판정한
 * 결과인지 뒤에 알 수 있어야 한다. v7.1에서 그림 묘사 문장의 오탐 규칙을 좁혔다.
 */
export const PII_CHECK_VERSION = 'pii-v7.1';

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
  /**
   * 함께 있어야 탐지로 보는 맥락 표현.
   *
   * 주소 모양은 그림 묘사 문장과 겹치기 쉽다('가로 3칸 세로 2칸', '친구 머리가 길어요').
   * 형태만으로 막으면 정상 응답이 결측이 되고, 점검 중에는 재시도가 없으므로 그 손실이
   * 그대로 남는다. 그래서 형태와 맥락이 함께 있을 때만 멈춘다.
   */
  context?: RegExp;
}

/** 공백 0개 이상. RegExp 생성자에 넣는 조각에서는 역슬래시 이스케이프를 피한다. */
const SP = '[ \t\u00a0]*';

/** 주소로 볼 만한 맥락. 이 표현이 함께 있을 때만 주소 형태를 탐지로 본다. */
const ADDRESS_CONTEXT =
  /(?:주소|사는\s*곳|살아요|살아서|살고|삽니다|산다|이사|우리\s*집|저희\s*집|집은|집\s*주소|번지|아파트|빌라|맨션)/;

/** 성씨로 시작하지만 사람 이름이 아닌 흔한 낱말. 이름 규칙의 오탐을 줄인다. */
const NAME_STOPWORDS = '강아지|고양이|병아리|원숭이|다람쥐|할머니|할아버지|아저씨|아주머니|이모|고모|삼촌';

/** '누구의 이름'인지 밝히는 호칭. 사람 이름 진술과 사물·동물 이름 진술을 가른다. */
const PERSON_KINSHIP = '아이|아들|딸|동생|형|누나|언니|오빠|친구|엄마|아빠|선생님';

/**
 * 탐지 규칙. 정규식은 텍스트가 '의심스러운가'만 판정하며
 * 일치한 문자열은 어디에도 보관하지 않는다.
 *
 * 판정의 기준은 '개인정보의 형태가 있는가'가 아니라 '개인정보를 밝히는 진술인가'이다.
 * 그림 묘사에 흔한 표현(칸·마리·머리·운동·색 이름·친척 호칭)은 통과시키고,
 * 사람 이름·전화·주소·학교명·생년월일·계정은 계속 잡는다.
 * 통과가 개인정보 없음을 뜻하지 않는다는 원칙은 PII_NOTICE로 그대로 유지한다.
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
  // '생일 파티 그림'처럼 날짜가 없는 문장은 잡지 않는다.
  {
    type: 'birthdate',
    test: /(?:생년월일|생일)\s*(?:은|는|:|：)?\s*\d{1,4}\s*[년.\-/]\s*\d{1,2}\s*[월.\-/]\s*\d{1,2}\s*일?/,
  },
  // 학교명
  { type: 'school', test: /[가-힣]{2,10}(?:초등학교|중학교|고등학교|유치원|초교)/ },
  { type: 'school', test: /학교\s*(?:이름|명)\s*(?:은|는|:|：)?\s*[가-힣]{2,}/ },
  // 주소 — 광역 지명은 그 자체로 식별력이 있으므로 맥락 없이 잡는다.
  { type: 'address', test: /[가-힣]{2,6}(?:특별시|광역시|특별자치시|특별자치도)/ },
  // 시·군·구 + 동·읍·면·리. '친구 머리가', '친구 두마리'가 걸리지 않도록 맥락을 함께 본다.
  {
    type: 'address',
    test: /[가-힣]{2,10}(?:시|군|구)\s*[가-힣0-9]{1,12}(?:동|읍|면|리)(?![가-힣])/,
    context: ADDRESS_CONTEXT,
  },
  // 도로명 + 번호. '가로 3칸 세로 2칸'이 걸리지 않도록 이름을 두 글자 이상으로 두고 맥락을 함께 본다.
  {
    type: 'address',
    test: /[가-힣A-Za-z0-9]{2,15}(?:대로|로|길)\s*\d{1,4}(?:\s*[-–]\s*\d{1,4})?(?![가-힣0-9])/,
    context: ADDRESS_CONTEXT,
  },
  // 번지·번길이 붙으면 그 자체로 주소다.
  { type: 'address', test: /[가-힣A-Za-z0-9]{2,15}(?:대로|로|길)\s*\d{1,4}(?:번길|번지)/ },
  { type: 'address', test: /\d+\s*동\s*\d+\s*호/ },
  { type: 'address', test: /(?:주소|사는\s*곳)\s*(?:은|는|:|：)\s*\S+/ },
  // '우리 집은 …'은 색·모양 묘사로도 쓰이므로 뒤에 지명·주소어가 올 때만 본다.
  {
    type: 'address',
    test: /(?:우리|저희)\s*집\s*(?:은|는|:|：)\s*[가-힣A-Za-z0-9]{1,12}(?:시|군|구|동|읍|면|리|아파트|빌라|맨션|번지)(?![가-힣])/,
  },
  // 계정·연락 수단
  { type: 'account', test: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { type: 'account', test: /(?:아이디|계정|비밀번호|비번)\s*(?:은|는|:|：)?\s*\S{2,}/ },
  // 서비스 이름만으로는 잡지 않는다('인스타 사진 같은 그림이에요').
  {
    type: 'account',
    test: /(?:카톡|카카오톡|인스타|디스코드|텔레그램)\s*(?:아이디|계정|이름|주소)?\s*(?:은|는|:|：)\s*\S{2,}/,
  },
  // 학교 내 식별 번호
  { type: 'student_number', test: /(?:출석번호|학번)\s*(?:은|는|:|：)?\s*\d{1,4}/ },
  // 이름 — '강아지 이름은 초코'처럼 사물·동물의 이름은 개인정보가 아니다.
  // (1) '이름은/성함은' 뒤에 성씨로 시작하는 이름이 오면 사람 이름으로 본다.
  { type: 'name', test: new RegExp(`(?:이름|성함)${SP}(?:은|는|:|：)?${SP}(?:${SURNAMES})[가-힣]{1,2}`) },
  // (2) 누구의 이름인지 사람으로 밝힌 경우에는 성씨가 없어도 본다('제 이름은 민수').
  {
    type: 'name',
    test: new RegExp(
      `(?:제|내|저의|나의|우리)${SP}(?:${PERSON_KINSHIP})?${SP}(?:이름|성함)${SP}(?:은|는|:|：)${SP}[가-힣]{2,4}`
    ),
  },
  // (3) 자기소개.
  {
    type: 'name',
    test: new RegExp(`(?:저는|나는)${SP}(?:${SURNAMES})[가-힣]{1,2}(?:입니다|이에요|예요|이야|야|이라고|라고)`),
  },
  // (4) 성 + 이름 두 글자 + 호칭. '이모님'·'최고예요'·'겨울 장면이에요'는 걸리지 않는다.
  {
    type: 'name',
    test: new RegExp(
      `(?:^|[\\s,.("'])(?!${NAME_STOPWORDS})(?:${SURNAMES})[가-힣]{2}${SP}(?:선생님|학생|어린이|씨)(?:[은는이가을를와과께도]|[\\s.,!?]|$)`
    ),
  },
];

/** 탐지된 유형 목록. 원문 조각을 돌려주지 않는다. */
export function detectPiiTypes(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const found = new Set<string>();
  for (const rule of RULES) {
    if (!rule.test.test(text)) continue;
    // 맥락을 요구하는 규칙은 형태와 맥락이 함께 있을 때만 탐지로 본다.
    if (rule.context && !rule.context.test(text)) continue;
    found.add(rule.type);
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
