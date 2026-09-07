/**
 * 교사가 차시를 여는 API.
 *
 * 교사 권한과 소속 학급은 @/server/auth가 서버에서 확인한다.
 * 학생의 점수나 6문항 완료는 개방 조건이 아니다(설계서 §4).
 */

import { NextResponse } from 'next/server';
import { openLessonAction } from '@/server/lessons/actions';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const result = await openLessonAction({
    classResearchId: String(body?.classResearchId ?? ''),
    lesson: Number(body?.lesson),
    reason: typeof body?.reason === 'string' ? body.reason : null,
    sessionType: body?.sessionType === 'experience' ? 'experience' : 'research_practice',
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 403 });
}
