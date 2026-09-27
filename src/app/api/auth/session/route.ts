/**
 * 학생 세션 토큰 발급·폐기.
 *
 * 학생 신원은 sessionStorage가 아니라 이 경로에서 서버가 발급·검증한 토큰이다.
 * 토큰은 HttpOnly·SameSite 쿠키로만 다루며 응답 본문에 넣지 않는다.
 *
 * 수업ID는 비밀번호가 아니다. 수업ID만 보내면 연구ID 없는 세션이 발급되고,
 * 연구 수집은 뒤 단계에서 서버가 다시 막는다.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/server/auth';
import { SESSION_HINT_COOKIE, SESSION_TOKEN_COOKIE } from '@/server/lessons/session-cookie';
import { authErrorResponse } from '../errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const classResearchId = typeof body.classResearchId === 'string' ? body.classResearchId.trim() : '';
    const participantCode =
      typeof body.participantCode === 'string' ? body.participantCode.trim() : null;
    const classCode = typeof body.classCode === 'string' ? body.classCode.trim() : null;
    // 반 입장 비밀번호는 다듬지 않고 그대로 대조한다(해시 대조는 서버가 한다).
    const entryPassword = typeof body.entryPassword === 'string' ? body.entryPassword : null;
    const studentNumber =
      typeof body.studentNumber === 'string' || typeof body.studentNumber === 'number'
        ? body.studentNumber
        : null;

    if (!classResearchId) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    const issued = await auth.issueStudentSession({
      classResearchId,
      participantCode: participantCode || null,
      classCode: classCode || null,
      entryPassword: entryPassword || null,
      studentNumber,
    });

    // 응답 본문에는 토큰을 넣지 않는다. 다음 화면을 고르는 데 필요한 값만 준다.
    const response = NextResponse.json({
      sessionType: issued.claims.sessionType,
      route: issued.route,
      researchCollectionEnabled: issued.claims.researchId !== null,
      expiresAt: new Date(issued.claims.exp).toISOString(),
      // 화면 머리 표시용. 신원이 아니다.
      classLabel: issued.classLabel,
      studentNumber: issued.studentNumber,
    });
    response.cookies.set(SESSION_TOKEN_COOKIE, issued.token, issued.cookieOptions);
    response.cookies.set(SESSION_HINT_COOKIE, issued.hint, {
      ...issued.cookieOptions,
      httpOnly: false,
    });
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    await auth.revokeStudentSession();
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(SESSION_TOKEN_COOKIE);
    response.cookies.delete(SESSION_HINT_COOKIE);
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}
