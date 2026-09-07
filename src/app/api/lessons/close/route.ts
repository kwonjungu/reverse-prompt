/**
 * 교사가 차시 또는 세션을 닫는 API.
 * lesson을 주면 그 차시만 닫고, 없으면 세션 전체를 닫는다.
 */

import { NextResponse } from 'next/server';
import { closeLessonAction } from '@/server/lessons/actions';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const lesson = Number(body?.lesson);
  const result = await closeLessonAction({
    classResearchId: String(body?.classResearchId ?? ''),
    lesson: Number.isFinite(lesson) ? lesson : undefined,
    reason: typeof body?.reason === 'string' ? body.reason : null,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 403 });
}
