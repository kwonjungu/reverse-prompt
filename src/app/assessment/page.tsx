/**
 * 검사 경로. 기존 교사 화면의 '시험 결과' 탭과 다른 것이다.
 *
 * 교사 화면의 '시험'은 게임·시간제한 모드의 세션 결과를 모아 보는 곳이며
 * 고정 사전·사후 검사가 아니다. 두 가지를 섞지 않도록 연구 검사는 이 경로에서만 한다.
 *
 * 이 서버 컴포넌트는 상태를 직접 읽지 않는다. 실제 판정은 API와 server action이
 * 하므로 화면을 우회해도 같은 결과가 나온다.
 */

import { AssessmentClient } from './assessment-client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '그림을 보고 설명 쓰기',
};

export default function AssessmentPage() {
  return <AssessmentClient />;
}
