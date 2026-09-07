/**
 * 교사·연구자 세션.
 *
 * 클라이언트가 Firebase 로그인으로 받은 ID 토큰을 서버가 검증하고,
 * users 문서의 역할을 서버에서 조회해 세션 쿠키로 바꾼다.
 * 클라이언트가 보낸 role·소속 학급은 쓰지 않는다.
 *
 * 등록되지 않은 계정, 익명 로그인, 개발자 계정은 세션을 받지 못한다.
 */

import { NextResponse } from 'next/server';
import { auth, STAFF_COOKIE } from '@/server/auth';
import { authErrorResponse } from '../errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idToken = typeof body.idToken === 'string' ? body.idToken : '';
    if (!idToken) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    const created = await auth.createStaffSession(idToken);
    const response = NextResponse.json({ role: created.role });
    response.cookies.set(STAFF_COOKIE, created.cookie, created.cookieOptions);
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(STAFF_COOKIE);
  return response;
}

export async function GET() {
  try {
    const principal = await auth.getPrincipal();
    if (!principal) return NextResponse.json({ authenticated: false }, { status: 401 });
    // 신원 식별 정보는 내려보내지 않는다. 역할과 접근 가능한 학급 수만 알린다.
    return NextResponse.json({
      authenticated: true,
      role: principal.role,
      classResearchIdCount: principal.classResearchIds.length,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
