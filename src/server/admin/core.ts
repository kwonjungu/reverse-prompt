/**
 * 통합 관리 화면(/admin)의 판정 규칙 — 저장소도 환경 변수도 읽지 않는 순수 모듈.
 *
 * 배선(쿠키·Firestore·Firebase Auth)은 같은 디렉터리의 auth.ts·actions.ts가 맡는다.
 * 여기 있는 규칙만 순수 함수 시험으로 고정한다(tests/admin.test.ts).
 *
 * 비밀번호는 원문을 저장하지 않는다
 *   관리자 비밀번호와 반 입장 비밀번호는 scrypt(무작위 salt)로 해시해 그 문자열만 저장한다.
 *   교사 계정 비밀번호는 Firebase Authentication이 보관하며 이 앱은 원문을 저장하지 않는다.
 *   해시는 되돌릴 수 없으므로 잊은 비밀번호를 '보여 주는' 기능은 없다. 새로 정해야 한다.
 *
 * 이 파일은 'server-only'를 import 하지 않는다. node:crypto만 쓴다.
 */

import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

/* ────────────────────────── 비밀번호 규칙 ────────────────────────── */

export type PasswordKind = 'admin' | 'teacher' | 'class';

/**
 * 종류별 최소 길이.
 *  - admin: 반 개설·교사 계정 발급까지 하는 계정이므로 길게 요구한다.
 *  - teacher: Firebase 최소(6자)보다 조금 길게.
 *  - class: 초등학생이 칠판을 보고 치는 값이다. 수업 번호와 함께 쓰는 입장 문턱이지
 *    개인 계정 비밀번호가 아니다.
 */
export const PASSWORD_MIN_LENGTH: Record<PasswordKind, number> = {
  admin: 12,
  teacher: 8,
  class: 4,
};

export const PASSWORD_MAX_LENGTH = 128;

const PASSWORD_LABEL: Record<PasswordKind, string> = {
  admin: '관리자 비밀번호',
  teacher: '교사 비밀번호',
  class: '반 입장 비밀번호',
};

/** 규칙에 맞으면 null, 아니면 화면에 보여 줄 문구. */
export function passwordProblem(value: unknown, kind: PasswordKind): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return `${PASSWORD_LABEL[kind]}를 입력해 주세요.`;
  }
  if (value !== value.trim()) {
    return `${PASSWORD_LABEL[kind]} 앞뒤에 공백을 넣을 수 없습니다.`;
  }
  if (/[\x00-\x1f\x7f]/.test(value)) {
    return `${PASSWORD_LABEL[kind]}에 쓸 수 없는 문자가 있습니다.`;
  }
  const min = PASSWORD_MIN_LENGTH[kind];
  if (value.length < min) return `${PASSWORD_LABEL[kind]}는 ${min}자 이상이어야 합니다.`;
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `${PASSWORD_LABEL[kind]}는 ${PASSWORD_MAX_LENGTH}자 이하여야 합니다.`;
  }
  return null;
}

/* ────────────────────────── scrypt 해시 ────────────────────────── */

/** 저장 형식: scrypt$N$r$p$salt(base64url)$hash(base64url) */
const SCRYPT_PREFIX = 'scrypt';
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const SCRYPT_KEYLEN = 32;
const SALT_BYTES = 16;
/** 저장된 값이 비정상적으로 큰 인자를 요구해 서버를 멈추게 하지 못하도록 한도를 둔다. */
const SCRYPT_MAX_N = 1 << 17;

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value: string): Buffer {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** 비밀번호를 해시한다. 원문은 돌려받을 수 없다. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, SCRYPT_KEYLEN, {
    ...SCRYPT_PARAMS,
    maxmem: 64 * 1024 * 1024,
  });
  const { N, r, p } = SCRYPT_PARAMS;
  return [SCRYPT_PREFIX, N, r, p, b64url(salt), b64url(key)].join('$');
}

/** 저장된 해시 문자열이 이 모듈의 형식인가. 원문 비밀번호가 잘못 저장된 경우를 거른다. */
export function isPasswordHash(value: unknown): value is string {
  return parseHash(value) !== null;
}

function parseHash(stored: unknown) {
  if (typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== SCRYPT_PREFIX) return null;
  const [N, r, p] = parts.slice(1, 4).map((v) => Number(v));
  if (![N, r, p].every((v) => Number.isInteger(v) && v > 0)) return null;
  if (N > SCRYPT_MAX_N || (N & (N - 1)) !== 0 || r > 32 || p > 4) return null;
  const salt = fromB64url(parts[4]);
  const hash = fromB64url(parts[5]);
  if (salt.length < 8 || hash.length < 16) return null;
  return { N, r, p, salt, hash };
}

/** 입력한 비밀번호가 저장된 해시와 맞는가. 형식이 틀린 해시는 항상 false. */
export async function verifyPassword(password: unknown, stored: unknown): Promise<boolean> {
  if (typeof password !== 'string' || password.length === 0) return false;
  if (password.length > PASSWORD_MAX_LENGTH) return false;
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const key = await scrypt(password, parsed.salt, parsed.hash.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: 256 * 1024 * 1024,
  });
  return key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash);
}

/* ────────────────────────── 관리자 자격 ────────────────────────── */

/**
 * 관리자 비밀번호의 출처.
 *  - stored: 관리 화면에서 바꾼 값. Firestore에 해시만 있다. 있으면 이것만 쓴다.
 *  - env: 처음 배포할 때 넣은 ADMIN_PASSWORD. 저장된 해시가 없을 때만 쓴다.
 * 둘 다 없거나 env가 규칙보다 짧으면 관리 화면을 열지 않는다(우회 없이 실패).
 */
export type AdminCredential =
  | { source: 'stored'; hash: string }
  | { source: 'env'; password: string };

export type AdminCredentialResolution =
  | { ok: true; credential: AdminCredential }
  | { ok: false; reason: 'unset' | 'env_too_short' | 'stored_malformed' };

export function resolveAdminCredential(input: {
  storedHash: unknown;
  envPassword: string | null | undefined;
}): AdminCredentialResolution {
  if (input.storedHash !== undefined && input.storedHash !== null && input.storedHash !== '') {
    // 저장된 값이 있는데 형식이 틀리면 env로 내려가지 않는다. 바꾼 비밀번호가
    // 무력화되어 옛 env 값이 다시 통하는 일을 막는다.
    return isPasswordHash(input.storedHash)
      ? { ok: true, credential: { source: 'stored', hash: input.storedHash } }
      : { ok: false, reason: 'stored_malformed' };
  }
  const env = (input.envPassword ?? '').trim();
  if (!env) return { ok: false, reason: 'unset' };
  if (passwordProblem(env, 'admin')) return { ok: false, reason: 'env_too_short' };
  return { ok: true, credential: { source: 'env', password: env } };
}

/** 입력한 비밀번호가 현재 관리자 자격과 맞는가. */
export async function verifyAdminPassword(
  input: unknown,
  credential: AdminCredential
): Promise<boolean> {
  if (typeof input !== 'string' || input.length === 0) return false;
  if (credential.source === 'stored') return verifyPassword(input, credential.hash);
  // env 값은 길이가 드러나지 않도록 해시끼리 비교한다.
  const a = createHash('sha256').update(input, 'utf8').digest();
  const b = createHash('sha256').update(credential.password, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/**
 * 자격의 지문. 세션 서명 키에 섞어 넣어, 비밀번호를 바꾸면 이전에 발급한
 * 관리자 세션이 모두 무효가 되게 한다. 원문 비밀번호를 드러내지 않는다.
 */
export function credentialFingerprint(credential: AdminCredential): string {
  const material =
    credential.source === 'stored' ? `stored:${credential.hash}` : `env:${credential.password}`;
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

/* ────────────────────────── 관리자 세션 토큰 ────────────────────────── */

export const ADMIN_TOKEN_VERSION = 1;
/** 하루 수업 운영을 넘기지 않는 길이. */
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface AdminTokenClaims {
  v: number;
  role: 'admin_console';
  iat: number;
  exp: number;
  /** 세션 구분용 무작위 값. 신원이 아니다. */
  nonce: string;
}

export type AdminTokenFailure =
  | 'no_key'
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'unsupported_version';

/**
 * 서명 키를 만든다. 서버 비밀키(STUDENT_SESSION_SECRET)와 자격 지문을 함께 쓴다.
 * 학생 토큰과 같은 비밀키를 쓰되 용도 문자열로 갈라, 학생 토큰을 관리자 토큰으로
 * 쓸 수 없게 한다.
 */
export function deriveAdminKey(secret: string, fingerprint: string): Buffer | null {
  if (!secret || !fingerprint) return null;
  return createHmac('sha256', secret).update(`rp-admin-session-v1|${fingerprint}`).digest();
}

function sign(body: string, key: Buffer): string {
  return b64url(createHmac('sha256', key).update(body).digest());
}

export function mintAdminToken(key: Buffer, nowMs: number, ttlMs = ADMIN_SESSION_TTL_MS): string {
  const claims: AdminTokenClaims = {
    v: ADMIN_TOKEN_VERSION,
    role: 'admin_console',
    iat: nowMs,
    exp: nowMs + ttlMs,
    nonce: b64url(randomBytes(12)),
  };
  const body = b64url(Buffer.from(JSON.stringify(claims), 'utf8'));
  return `${body}.${sign(body, key)}`;
}

export function verifyAdminToken(
  token: string | null | undefined,
  key: Buffer | null,
  nowMs: number
): { ok: true; claims: AdminTokenClaims } | { ok: false; reason: AdminTokenFailure } {
  if (!key) return { ok: false, reason: 'no_key' };
  if (!token || typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' };
  const body = token.slice(0, dot);
  const a = Buffer.from(token.slice(dot + 1), 'utf8');
  const b = Buffer.from(sign(body, key), 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }
  let claims: AdminTokenClaims;
  try {
    claims = JSON.parse(fromB64url(body).toString('utf8')) as AdminTokenClaims;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (claims?.v !== ADMIN_TOKEN_VERSION) return { ok: false, reason: 'unsupported_version' };
  if (claims.role !== 'admin_console') return { ok: false, reason: 'malformed' };
  if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (nowMs >= claims.exp) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}

/* ────────────────────────── 반(수업) ────────────────────────── */

/**
 * 학생이 칠 수업 번호. 여섯 자리 숫자이며 첫 자리는 0이 아니다(앞의 0을 빼먹는 일 방지).
 * 무작위이지만 비밀번호가 아니다. 입장 문턱은 반 비밀번호가 맡는다.
 */
export const CLASS_ID_PATTERN = /^[1-9][0-9]{5}$/;

export function generateClassId(pick: (min: number, max: number) => number = randomInt): string {
  let id = String(pick(1, 10));
  for (let i = 0; i < 5; i += 1) id += String(pick(0, 10));
  return id;
}

export function isGeneratedClassId(value: unknown): value is string {
  return typeof value === 'string' && CLASS_ID_PATTERN.test(value);
}

export const CLASS_LABEL_MAX_LENGTH = 40;

/**
 * 화면에 보일 반 이름(예: '3학년 2반 화요일'). 앞뒤 공백을 다듬고 제어 문자를 뺀다.
 * 비어 있으면 null. 학교명·학생 실명을 적지 않도록 화면에서 안내한다.
 */
export function normalizeClassLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, CLASS_LABEL_MAX_LENGTH);
  return cleaned || null;
}

/** 출석 번호. 1~99 정수만 받는다. 숫자 문자열도 받는다. */
export function parseStudentNumber(value: unknown): number | null {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9]{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 99 ? n : null;
}

/* ────────────────────────── 교사 계정 ────────────────────────── */

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 40);
  return cleaned || null;
}

/** 배정할 반 목록을 정리한다. 실제로 있는 반만 남기고 중복을 없앤다. */
export function sanitizeClassAssignments(requested: unknown, existing: readonly string[]): string[] {
  if (!Array.isArray(requested)) return [];
  const known = new Set(existing);
  const out = new Set<string>();
  for (const value of requested) {
    if (typeof value === 'string' && known.has(value)) out.add(value);
  }
  return [...out].sort();
}
