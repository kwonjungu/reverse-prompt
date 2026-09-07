/**
 * 교사가 차시를 여는 API.
 *
 * 교사 권한과 소속 학급은 @/server/auth가 서버에서 확인한다.
 * 학생의 점수나 6문항 완료는 개방 조건이 아니다(설계서 §4).
 *
 * 세션 성격(sessionType)은 클라이언트에서 받지 않는다. 서버의 학급 기록이 정한다.
 * 예전에는 body.sessionType을 그대로 넘겨 연구 학급을 'experience'로 열 수 있었다(감사 A-5).
 */

import { NextResponse } from 'next/server';
import { openLessonAction } from '@/server/lessons/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: '요청 형식이 올바르지 않습니다.' },
      { status: 400 }
    );
  }
  const raw = (body ?? {}) as Record<string, unknown>;

  const result = await openLessonAction({
    classResearchId: typeof raw.classResearchId === 'string' ? raw.classResearchId : '',
    lesson: Number(raw.lesson),
    reason: typeof raw.reason === 'string' ? raw.reason : null,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 403 });
}
