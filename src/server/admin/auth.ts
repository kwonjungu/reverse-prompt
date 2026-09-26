import 'server-only';

/**
 * 통합 관리 화면(/admin)의 관리자 세션 — 배선.
 *
 * 판정 규칙(해시·토큰·자격 선택)은 core.ts에 있고, 여기서는 쿠키와 Firestore를 붙인다.
 *
 * 무엇을 지키는가
 *   - 관리자 비밀번호는 처음에는 ADMIN_PASSWORD(12자 이상)로 들어온다. 화면에서 바꾸면
 *     Firestore admin_config/console에 scrypt 해시만 남고, 그 뒤로는 저장된 해시만 통한다.
 *   - 세션은 HttpOnly·SameSite=Strict 쿠키(rp_admin)로만 다룬다. 서명 키에 자격 지문이
 *     섞여 있어 비밀번호를 바꾸면 다른 기기의 관리자 세션이 모두 끊긴다.
 *   - 서버 자격증명·서명 비밀키·관리자 비밀번호 가운데 하나라도 없으면 우회 없이 실패한다.
 *
 * 무엇이 아닌가
 *   - 교사·연구자 계정(Firebase 로그인, users 문서의 역할)과 별개다. 이 세션으로 교사
 *     화면의 학생 자료를 읽지 않는다. access.ts가 정한 대로 관리 계정은 반·계정 관리만 한다.
 *   - 로그인 시도 횟수를 서버 전체에서 세어 잠그지는 않는다. 실패마다 지연을 두고
 *     12자 이상을 요구하는 것으로 무작위 대입을 늦출 뿐이다(CLAUDE.md 알려진 한계).
 */

import { cookies } from 'next/headers';
import { FieldValue } from 'firebase-admin/firestore';
import { AuthError } from '@/server/auth/contract';
import { ADMIN_PASSWORD, SERVER_SESSION_SECRET } from '@/server/config';
import { COLLECTIONS, getAdminFirestore, isAdminConfigured } from '@/server/firebase-admin';
import {
  ADMIN_SESSION_TTL_MS,
  credentialFingerprint,
  deriveAdminKey,
  hashPassword,
  mintAdminToken,
  passwordProblem,
  resolveAdminCredential,
  verifyAdminPassword,
  verifyAdminToken,
  type AdminCredential,
} from './core';

/** 관리자 세션 쿠키. 학생(rp_session)·교사(rp_staff) 쿠키와 이름을 겹치지 않는다. */
export const ADMIN_COOKIE = 'rp_admin';

/** 차시·반 기록의 openedBy 등에 남는 조작 주체. 사람 이름이 아니다. */
export const ADMIN_ACTOR = 'admin-console';

const CONFIG_DOC = 'console';
const FAILED_SIGN_IN_DELAY_MS = 700;

const CREDENTIAL_MESSAGES = {
  unset: 'ADMIN_PASSWORD가 설정되지 않아 관리 화면을 열 수 없습니다.',
  env_too_short: 'ADMIN_PASSWORD가 12자보다 짧아 쓰지 않습니다. 더 긴 값으로 바꿔 주세요.',
  stored_malformed:
    '저장된 관리자 비밀번호 형식이 올바르지 않습니다. Firestore의 admin_config/console 문서를 확인해 주세요.',
} as const;

export type AdminCredentialState = 'stored' | 'env' | keyof typeof CREDENTIAL_MESSAGES;

export interface AdminSetupStatus {
  /** 서버 Firebase Admin 자격(FIREBASE_SERVICE_ACCOUNT_JSON)이 있는가 */
  firebase: boolean;
  /** 세션 서명 비밀키(STUDENT_SESSION_SECRET)가 있는가 */
  sessionSecret: boolean;
  /** 관리자 비밀번호의 출처. Firebase가 없으면 확인할 수 없다. */
  credential: AdminCredentialState | 'unknown';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function configDoc() {
  return getAdminFirestore().collection(COLLECTIONS.adminConfig).doc(CONFIG_DOC);
}

async function readStoredHash(): Promise<unknown> {
  const snap = await configDoc().get();
  return snap.exists ? snap.data()?.passwordHash : undefined;
}

/** 화면이 로그인 전에 보여 줄 설정 상태. 값 자체는 내려보내지 않는다. */
export async function readSetupStatus(): Promise<AdminSetupStatus> {
  const firebase = isAdminConfigured();
  let credential: AdminSetupStatus['credential'] = 'unknown';
  if (firebase) {
    try {
      const res = resolveAdminCredential({
        storedHash: await readStoredHash(),
        envPassword: ADMIN_PASSWORD,
      });
      credential = res.ok ? res.credential.source : res.reason;
    } catch {
      credential = 'unknown';
    }
  }
  return { firebase, sessionSecret: SERVER_SESSION_SECRET.length > 0, credential };
}

/** 지금 유효한 관리자 자격. 하나라도 빠지면 AuthError('not_configured'). */
async function currentCredential(): Promise<AdminCredential> {
  if (!isAdminConfigured()) {
    throw new AuthError(
      '서버 자격증명(FIREBASE_SERVICE_ACCOUNT_JSON)이 없어 관리 화면을 열 수 없습니다.',
      'not_configured'
    );
  }
  if (!SERVER_SESSION_SECRET) {
    throw new AuthError(
      '세션 서명 키(STUDENT_SESSION_SECRET)가 없어 관리 화면을 열 수 없습니다.',
      'not_configured'
    );
  }
  const res = resolveAdminCredential({
    storedHash: await readStoredHash(),
    envPassword: ADMIN_PASSWORD,
  });
  if (!res.ok) throw new AuthError(CREDENTIAL_MESSAGES[res.reason], 'not_configured');
  return res.credential;
}

function keyFor(credential: AdminCredential): Buffer {
  const key = deriveAdminKey(SERVER_SESSION_SECRET, credentialFingerprint(credential));
  if (!key) throw new AuthError('관리자 세션 키를 만들 수 없습니다.', 'not_configured');
  return key;
}

async function issueCookie(credential: AdminCredential): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_COOKIE, mintAdminToken(keyFor(credential), Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
  });
}

/** 관리자 로그인. 틀리면 일정 시간 기다린 뒤 실패한다. */
export async function signInAdmin(password: unknown): Promise<void> {
  const credential = await currentCredential();
  if (!(await verifyAdminPassword(password, credential))) {
    await sleep(FAILED_SIGN_IN_DELAY_MS);
    throw new AuthError('비밀번호가 맞지 않습니다.', 'unauthenticated');
  }
  await issueCookie(credential);
  await recordAdminEvent('sign_in', null, null);
}

export async function signOutAdmin(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
}

/**
 * 관리 server action의 첫 줄에서 부른다. 쿠키가 없거나, 서명이 틀리거나, 만료되었거나,
 * 그사이 비밀번호가 바뀌었으면 AuthError('unauthenticated')로 끊는다.
 */
export async function requireAdmin(): Promise<{ actor: typeof ADMIN_ACTOR }> {
  const credential = await currentCredential();
  const store = await cookies();
  const verified = verifyAdminToken(store.get(ADMIN_COOKIE)?.value, keyFor(credential), Date.now());
  if (!verified.ok) throw new AuthError('관리자 로그인이 필요합니다.', 'unauthenticated');
  return { actor: ADMIN_ACTOR };
}

/**
 * 관리자 비밀번호를 바꾼다. 새 비밀번호는 scrypt 해시로만 저장한다.
 * 바꾸는 즉시 다른 기기의 관리자 세션은 끊기고, 지금 브라우저에는 새 세션을 준다.
 */
export async function changeAdminPassword(current: unknown, next: unknown): Promise<void> {
  await requireAdmin();
  const credential = await currentCredential();
  if (!(await verifyAdminPassword(current, credential))) {
    await sleep(FAILED_SIGN_IN_DELAY_MS);
    throw new AuthError('지금 비밀번호가 맞지 않습니다.', 'unauthenticated');
  }
  const problem = passwordProblem(next, 'admin');
  if (problem) throw new AuthError(problem, 'forbidden');

  await configDoc().set(
    {
      passwordHash: await hashPassword(next as string),
      passwordUpdatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  await issueCookie(await currentCredential());
  await recordAdminEvent('change_admin_password', null, null);
}

/**
 * 관리 조작 기록. 비밀번호 원문·해시·학생 답안을 담지 않는다.
 * 기록에 실패해도 조작 자체를 되돌리지는 않는다(이미 반영된 뒤이므로).
 */
export async function recordAdminEvent(
  action: string,
  target: string | null,
  detail: Record<string, unknown> | null
): Promise<void> {
  try {
    await getAdminFirestore()
      .collection(COLLECTIONS.adminEvents)
      .add({
        action,
        target,
        detail: detail ?? null,
        actor: ADMIN_ACTOR,
        at: new Date().toISOString(),
        serverAt: FieldValue.serverTimestamp(),
      });
  } catch {
    console.error('[admin] 조작 기록을 남기지 못했습니다:', action);
  }
}
