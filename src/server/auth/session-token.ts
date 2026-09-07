/**
 * 학생 세션 토큰의 발급·검증.
 *
 * 현재의 sessionStorage 신원(학교코드·학년반·출석번호)은 연구 세션의 권위 있는
 * 신원이 아니다. 서버가 서명한 이 토큰만 신원으로 인정한다.
 *
 * 토큰에는 실명·출석번호·학교명을 넣지 않는다. 비식별 연구ID와 무작위 수업ID만 담는다.
 * 서명 비밀키가 없으면 발급·검증 모두 실패한다. 검증을 건너뛰는 우회로를 두지 않는다.
 *
 * 이 파일은 'server-only'를 import 하지 않는다. node:crypto만 쓰는 순수 모듈이라
 * 테스트에서 그대로 불러 쓴다. 비밀키는 인자로 받고 여기서 환경 변수를 읽지 않는다.
 */

import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type { SessionType } from '@/lib/research/types';

export const SESSION_TOKEN_VERSION = 1;

/** 기본 수명. 한 차시(40분)와 이동 시간을 감안한 값이다. */
export const SESSION_TTL_MS = 3 * 60 * 60 * 1000;

export interface StudentSessionClaims {
  v: number;
  /** 세션 식별자. 폐기 목록 대조에 쓴다. 학생 신원이 아니다. */
  sid: string;
  /** 비식별 연구ID. 연구 대상이 아니면 null. */
  researchId: string | null;
  /** 무작위 수업ID */
  classResearchId: string | null;
  /** 비연구 수업 기록용 학급 코드 */
  classCode: string | null;
  sessionType: SessionType;
  role: 'student';
  /** 발급·만료 시각(ms) */
  iat: number;
  exp: number;
}

export type TokenFailure =
  | 'no_secret'
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'unsupported_version';

export type VerifyResult =
  | { ok: true; claims: StudentSessionClaims }
  | { ok: false; reason: TokenFailure };

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value: string): Buffer {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(body: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(body).digest());
}

export function newSessionId(): string {
  return randomUUID();
}

/**
 * 토큰을 발급한다. 비밀키가 없으면 예외 대신 null을 돌려주고 호출부가
 * AuthError('not_configured')로 바꾼다(이 모듈은 계약에 의존하지 않는다).
 */
export function mintSessionToken(
  claims: Omit<StudentSessionClaims, 'v'>,
  secret: string
): string | null {
  if (!secret) return null;
  const payload: StudentSessionClaims = { ...claims, v: SESSION_TOKEN_VERSION };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${sign(body, secret)}`;
}

export function verifySessionToken(
  token: string | null | undefined,
  secret: string,
  nowMs: number
): VerifyResult {
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (!token || typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' };

  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(body, secret);

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let claims: StudentSessionClaims;
  try {
    claims = JSON.parse(fromB64url(body).toString('utf8')) as StudentSessionClaims;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (claims?.v !== SESSION_TOKEN_VERSION) return { ok: false, reason: 'unsupported_version' };
  if (claims.role !== 'student') return { ok: false, reason: 'malformed' };
  if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (nowMs >= claims.exp) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}

/** 쿠키 옵션. HttpOnly·SameSite는 항상, Secure는 프로덕션에서 켠다. */
export function sessionCookieOptions(maxAgeMs: number, isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}
