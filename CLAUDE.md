# PromptGrader (reverse-prompt) — 개발 메모

초등학생용 AI 프롬프트 엔지니어링 학습 웹앱. 그림을 보고 한국어로 설명을 적으면 Gemini가 축별로 채점하고 피드백을 준다.
석사 학위논문(역프롬프트, v7 계획서)의 연구 도구를 겸한다.

**이 문서는 실제 코드와 맞춘 기술 메모다. 연구 승인·전문가 확정·실데이터 검증을 마쳤다는 뜻이 아니다.**
현재 저장소는 `researchReady=false` 상태이며 그대로는 본연구 검사·채점을 시작할 수 없다(아래 "연구 시작을 막는 값" 참고).

## 실행

```bash
npm install
npm run dev           # http://localhost:9002 (Turbopack)
npm run build         # 프로덕션 빌드
npm run typecheck     # tsc --noEmit
npm test              # node --import tsx --test "tests/**/*.test.ts" (순수 함수·모의 모델)
npm run manifest      # 연구용 manifest 생성 (scripts/research-manifest.mjs)
npm run hints:table   # 문항별 힌트 검수표 docs/practice-hints-review.md 다시 만들기
npm run genkit:dev    # Genkit 플로우 격리 실행 (선택)
```

`npm run lint`는 **동작하지 않는다.** eslint 설정도 패키지도 없어 `next lint`가 대화형 설치 프롬프트로 빠진다.
쓰려면 `eslint`·`eslint-config-next`를 설치하고 설정 파일을 추가해야 한다. `next.config.ts`가
`eslint.ignoreDuringBuilds: true`라 빌드에는 영향이 없다.

서버 전용 모듈을 쓰는 연구용 스크립트는 preload가 필요하다. `src/server/**`가 `server-only`를
쓰는데 Node 기본 조건에서 그 패키지가 예외를 던지기 때문이다(`--conditions=react-server`는 React 18을 깨뜨린다).

```bash
node --import tsx --import ./scripts/_node-server-modules.mjs scripts/score-assessments.mjs --seed <시드>
node --import tsx --import ./scripts/_node-server-modules.mjs scripts/check-completeness.mjs --input <파일>
```

`npm test`는 실제 모델을 호출하지 않는다. 모델 호출은 주입 가능한 함수로 두고 테스트에서 가짜 구현을 넣는다.
Firebase Emulator 권한 시험(`tests/rules/`)은 에뮬레이터가 없으면 skip 된다. **skip은 통과가 아니다.**

## 배포

- **호스팅**: Vercel (자동 배포 — `main` 푸시하면 빌드)
- **GitHub**: https://github.com/kwonjungu/reverse-prompt
- **Firebase 프로젝트**: CLAUDE.md는 `promptgrader`를, `.firebaserc`는 `promptgrader-jun`을 가리킨다. **서로 다르다 — 배포 전에 확인할 것.**
- **Firestore 리전**: asia-northeast3 (서울). 리전만으로 모든 처리가 국내라고 문서화하지 않는다.
  처리 리전·로그·백업·재위탁·학습 사용 여부는 **실제 계약과 콘솔 설정으로 확인할 항목**이다.
- **Firestore 규칙**: `firestore.rules`가 저장소에 있다(기본 거부). **콘솔에 실제로 배포했는지는 별도 확인이 필요하다.**
  이 파일이 있다는 것만으로 운영 콘솔이 같은 상태라고 단정하지 않는다.

## 환경 변수

`.env.example`이 템플릿이다. `.env*`는 gitignore.

| 키 | 용도 | 비고 |
|---|---|---|
| `GOOGLE_GENAI_API_KEY` | Genkit Gemini 호출 (서버) | 누락 시 `genkit.ts`에서 throw |
| `NEXT_PUBLIC_FIREBASE_*` 6개 | Firebase 클라이언트 SDK | |
| `NEIS_API_KEY` | 학교 검색 호출 한도 ↑ | 선택 |
| `EVALUATION_MODEL_ID` | 채점 모델 | 비우면 기본 `googleai/gemini-3.8-flash` |
| `EVALUATION_TEMPERATURE` | 채점 온도 | 기본 0.2 |
| `EVALUATION_MODEL_VERIFIED` | 운영자가 모델 접근·출력 스키마를 확인함 | `true`가 아니면 연구 시작 차단 |
| `RESEARCH_ASSET_DIR` | 비공개 연구 자산 경로 | 검사 이미지 + `cue-pack.json` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | 서버 Admin SDK 자격 | 없으면 서버 인증이 우회 없이 실패 |
| `STUDENT_SESSION_SECRET` | 학생·관리자 세션 토큰 서명 키 | **선택.** 비우면 `FIREBASE_SERVICE_ACCOUNT_JSON`의 비공개 키에서 만든다. 서비스 계정 키를 바꾸면 세션이 끊긴다 |
| `PARTICIPANT_CODE_PEPPER` | 참가자 코드 pepper | |
| `CONSENT_VERSION` | 유효한 동의서 버전 | 비면 연구 동의 불가 |
| `IRB_APPROVAL` | IRB 승인 번호 | 비면 연구 시작 차단 |
| `LECTURE_CODE` | 연수 모드 입장 번호 | 비우면 `1111`. 인증이 아니다 |
| `ADMIN_PASSWORD` | 통합 관리 화면(`/admin`) 첫 비밀번호 | **10자 이상**이어야 쓰인다. 화면에서 바꾸면 그 뒤로는 저장된 해시만 통한다 |

## 아키텍처

- **Next.js 15.3.8** App Router + Turbopack + React 18.3
- **Genkit 1.27** + `@genkit-ai/google-genai`
- **Firebase**: 클라이언트 SDK(읽기 위주) + **서버 `firebase-admin`**(권한 검증을 거친 쓰기)
- **shadcn/ui** + Tailwind CSS

### 디렉토리

```
src/
  app/
    page.tsx                    # 입장(수업 번호 + 반 비밀번호 + 번호). 서버가 허용한 모드만 보여 준다
    guide/page.tsx              # 설명 모드
    practice/page.tsx           # 연습 모드 (처치)
    lecture/page.tsx            # 연수 체험판 (세션 없이 고정 20문항, 저장 안 함)
    assessment/page.tsx         # 사전·사후 검사 수집 (AI 호출 없음)
    game/, time-attack/         # 일반 체험 전용. 연구 세션에서는 진입 거부
    teacher/page.tsx            # 교사 대시보드 (로그인 + 배정 학급만). 학생 현황(LMS) 탭
    admin/page.tsx              # 통합 관리 (관리자 비밀번호): 반·차시·수업 시작/종료·교사 계정
    admin/research-panel.tsx    # 통합 관리의 '연구 자료' 탭(요약·CSV·제외 표시·층화 추출)
    admin/audit/page.tsx        # 감수 (연구자 역할 + 명시적 승인 필요). 옛 /admin
    api/
      auth/{session,refresh,staff}      # 세션 토큰 발급·갱신·교직원 로그인
      lessons/{,open,close,mode}        # 차시 개방·폐쇄·모드 판정
      assessment/{state,start,submit,failure}
      research/asset/[questionId]       # 검사 이미지 인증 스트리밍
  middleware.ts                 # route 층 모드 차단
  ai/
    genkit.ts                   # 모델 ID는 src/server/config.ts 경유
    flows/evaluate-prompt.ts    # 연습 화면용 얇은 서버 액션 (실채점은 server/grading)
    flows/audit-agent.ts        # 기본 합성 자료. 실데이터는 승인 기록 필요
  lib/
    rubric.ts                   # 공통 5수준 문언의 단일 버전 리소스
    evaluation-prompt.ts        # 공통 문언 + 문항별 단서로 지시문 조립
    scoring.ts                  # 밴드·배점·환산·결합. 엄격 검증
    feedback.ts                 # 피드백 형식·인용 검증 (점수와 분리)
    questions.ts                # 연습 36문항의 공개 정보만
    practice-hints.ts           # 문항별 힌트 초안(공개 문구). 검수(reviewed)를 마친 것만 화면에 나간다
    research/                   # 공통 도메인 타입, 세션별 허용 모드
  server/                       # 서버 전용. 클라이언트 번들에 실리지 않는다
    admin/                      # 통합 관리: core(해시·토큰 순수) · auth(관리자 세션) · actions · research-actions
    lms/                        # 교사 학생 현황 집계(순수)
    lecture/                    # 연수 체험판 배선. 연구 저장소를 열지 않는다
    config.ts                   # 모델 ID·자산 경로·동의 버전 등 단일 지점
    auth/                       # 역할·학급 범위·동의·세션 토큰·비식별
    privacy/                    # 전송 전 개인정보 점검
    registry/                   # 문항 레지스트리, 비공개 단서 팩, 제작 프롬프트
    grading/                    # 운영 채점 1회(2+1 호출)
    lessons/                    # 차시 개방 판정·저장
    assessment/                 # 검사 세션·제출·사후 일괄 채점
    export/                     # CSV 내보내기, 중복·완전성 점검, practice-summary(v12 요약·추출, 순수)
research-assets/                # 형식과 절차만. 실제 단서·이미지는 커밋하지 않는다
firestore.rules                 # 기본 거부
```

## 채점 (설계서 §2·§3)

### 공통 루브릭은 하나의 리소스에서만 나온다
`src/lib/rubric.ts`가 논문 공통 루브릭 v7의 문언을 그대로 담고, AI 지시문·교사 화면·내보내기 문서를
`renderForModel/renderForTeacher/renderForExport`로 **같은 원본에서 생성**한다. 사본을 손으로 동기화하지 않는다.

### 밴드와 배점 (<표 Ⅲ-5>)
- **A** Lv.1~12 — 대상 50 / 구체성 50, 맥락 축 미적용(`contextLevel`은 **반드시 null**)
- **B** Lv.13~24 — 대상 35 / 구체성 35 / 배경·행동 30
- **C** Lv.25~36 — 대상 35 / 구체성 35 / 맥락·분위기 30
- 축 점수 = `(수준 − 1) / 4 × 축 배점`. **중간 계산은 반올림하지 않는다.**

### 형식 오류를 유효 값으로 바꾸지 않는다
`clampLevel`은 **제거되었다.** 개별 호출의 적용 축은 정수 1~5여야 하며 6·0·2.5·문자열·NaN·Infinity·
B/C밴드의 null은 모두 형식 오류(`schema_error`)다. 결측은 0점이 아니라 `score: null`이다.

```ts
type OperationalResult =
  | { status: 'scored';  levels; score; axisScores; feedbackStatus }
  | { status: 'missing'; levels: null; score: null; axisScores: null;
      reason: 'model_error' | 'schema_error' | 'required_call_failed' }
```

### 운영 채점 1회 (<표 Ⅲ-7>)
1. 같은 고정 입력으로 **독립 2회**. **실패한 호출만 1회 재시도.**
2. 두 유효 호출의 모든 적용 축 차이가 1 이하 → 축별 평균(반수준 유지).
3. 하나라도 1 초과 → **세 번째 유효 호출** 후 축별 중앙값. 세 번째도 실패하면 운영 결측.
4. 일부 성공 값만으로 정상 결과를 반환하지 않는다.
5. 점수가 확정되면 **피드백 실패 때문에 재채점하거나 점수를 바꾸지 않는다.**

호출별 `callId`·`retryIndex`·검증된 levels·`failureReason`·시각을 모두 남긴다.
호출 기록에 학생 개인정보·비밀키·원시 인증토큰을 남기지 않는다.

### 문항별 단서
채점에는 실제 이미지와 그 문항의 필수 단서·경계·앵커를 함께 쓴다. 단서는 **비공개 자산**이며
`RESEARCH_ASSET_DIR/cue-pack.json`에서 읽는다. 단서가 없으면 연구 세션 채점을 거부한다(`cues_missing`).
일반 체험은 사전 확정 단서가 없으면 공통 문언만으로 채점하고 **그 점수는 연구 자료로 쓰지 않는다.**
이미지 제작 프롬프트(`sourcePrompt`)는 정답 문장이 아니므로 채점 지시문에 넣지 않으며,
`src/server/registry/practice-source-prompts.ts`(서버 전용)로 옮겼다.

### 학생 입력은 데이터이지 지시가 아니다
지시문이 학생 응답을 `<<<학생응답 시작>>> … <<<학생응답 끝>>>`으로 감싸고, 그 안의 명령·점수 요구를
실행하지 않는다. 그런 문장만 제출되면 유효한 과제 단서가 없으므로 적용 축을 수준 1로 판정한다.

### 피드백은 4줄, 점수와 분리
Hattie와 Timperley(2007)의 목표·현재 수행·다음 행동 구분을 참고한 배열이다.

1. 목표 — 이 문항에서 무엇을 하려는지
2. 현재 수행 — 학생이 실제로 쓴 표현에 근거한 장점 또는 현재 상태
3. 다음 행동 — 필요한 수정 단서 하나. 없으면 중립적 확인
4. 활용할 수 있는 표현 제안. 고칠 것이 없으면 자기 점검

**네 줄 형식과 제안 수는 아동의 처리 부담을 고려한 설계 선택이며 효과가 검증된 최적값이 아니다.**
모든 응답에 누락 지적을 강제하지 않는다. 인용은 문장에 섞지 않고 구조화된 `quote` 필드로 받아
**코드가 원문 포함 여부를 확인**한다(한 글자도 허용). 인용이 없는 중립 안내와 인용 검증 실패는 다른 상태다.
검증에 실패하면 **피드백만 1회 재생성**하고, 다시 실패하면 고정 안내 `표현을 선생님과 함께 확인해 보세요`를
쓰고 `feedbackStatus='fallback'`으로 남긴다. **점수는 그대로다.**
형식 검사를 통과한 것이 그림 부합이나 내용 정확성을 뜻하지 않는다.

## 차시와 모드 (설계서 §4)

- 차시는 **교사가 서버에서 연다**(`LessonSession`: classResearchId, currentLesson, allowedLessons,
  openedAt, closedAt, openedBy, reason). **점수나 6문항 완료는 개방 조건이 아니다.**
  1차시를 2문항만 한 학생도 교사가 2차시를 열면 입장한다. 완료 수는 정보로만 보여 준다.
- 옛 `REQUIRED_PER_CHASI = 6` 잠금과 localStorage 기반 진행 잠금은 **제거되었다.**
  `localStorage`는 캐시일 뿐 접근 권한·동의·완료의 권위 있는 원천이 아니다.
- 옛 홈 화면의 `extended` 토글도 **제거되었다.** 모드 차단은 화면 숨김이 아니라
  `src/lib/research/session-modes.ts`를 근거로 **middleware·화면 가드·server action·API 네 층**에서 이루어진다.
  edge middleware는 힌트 쿠키만 읽으므로 나머지 세 층이 `@/server/auth`로 다시 판정한다.
- 연구 세션에서는 게임·타임어택·감수·임의 이미지 생성의 직접 경로와 관련 서버 액션을 모두 거부한다.
  감수 화면은 `/admin/audit`로 옮겼고 middleware가 그 경로를 잡는다. `/admin` 자체는 관리자 비밀번호로 막는다.
- 관리 화면에서 만든 반(`pacing:'teacher'`)은 일반 수업이어도 연 차시만 열린다(위 "통합 관리 화면" 참고).
- **연구 세션에서는 고치지 않은 이유를 묻지 않는다(논문 v12).** 입력칸을 숨기고 서버도 `kept`를 받지 않는다.
  수정 과정은 제출할 때마다 남는 시도 기록으로만 본다. '고쳐서 다시 쓰기'의 `revised` 연결만 남고 글은 저장하지 않는다.
  일반 체험은 예전처럼 까닭을 남길 수 있다.

## 통합 관리 화면 (`/admin`) — 반을 여는 쪽

역할을 셋으로 나눈다. **관리자**가 반을 만들어 열고 닫고, **학생**은 그 반에만 들어가고,
**교사**는 교사 화면(LMS)에서 배정된 반을 추적 관찰한다.

| 누가 | 어디서 | 무엇을 |
|---|---|---|
| 관리자 | `/admin` (관리자 비밀번호) | 반 만들기·반 비밀번호·수업 시작/종료·차시 열고 닫기·교사 계정 발급과 반 배정 |
| 교사 | `/teacher` (관리자가 만든 Firebase 계정) | 배정된 반의 학생 현황(번호별 차시 진행·점수·최근 답안), 차시 열고 닫기 |
| 학생 | `/` (수업 번호 + 반 비밀번호 + 번호) | 그 반에서 교사가 연 차시만 |

### 비밀번호는 원문을 저장하지 않는다
- **관리자 비밀번호**: 처음에는 `ADMIN_PASSWORD`(10자 이상)로 들어온다. 설정 탭에서 바꾸면
  `admin_config/console.passwordHash`에 **scrypt 해시**만 남고, 그 뒤로는 env 값이 통하지 않는다.
  저장된 값이 깨져 있으면 env로 내려가지 않고 막는다. 잊으면 Firebase 콘솔에서 그 문서를 지우고 env로 들어온다.
- **반 입장 비밀번호**: `research_classes/{id}.entryPassword`에 scrypt 해시로만 둔다(4자 이상, 선택).
  학생 입장(`issueStudentSession`)이 해시로 대조한다. 없는 반·닫힌 반·틀린 비밀번호는 **같은 문구**로 막는다.
- **교사 비밀번호**: Firebase Authentication이 보관한다. 관리자는 새로 정할 수만 있고(기존 로그인 즉시 끊김) 볼 수는 없다.
- 해시는 `src/server/admin/core.ts`의 `hashPassword/verifyPassword`(scrypt N=2^14, 무작위 salt) 하나에서 만든다.

### 관리자 세션
- HttpOnly·SameSite=Strict 쿠키 `rp_admin`, 8시간. 서명 키 = 서버 서명 비밀키 + 용도 문자열 + **자격 지문**.
  서버 서명 비밀키는 `STUDENT_SESSION_SECRET`, 없으면 서비스 계정 비공개 키에서 만든 값이다(`deriveServerSessionSecret`).
  비밀번호를 바꾸면 지문이 바뀌어 **다른 기기의 관리자 세션이 모두 끊긴다.**
- `FIREBASE_SERVICE_ACCOUNT_JSON`과 관리자 비밀번호 가운데 하나라도 없으면 우회 없이 실패한다.
- 로그인하면 **Firebase 설정 점검**을 한다(`src/server/admin/firebase-setup.ts`).
  서비스 계정과 `NEXT_PUBLIC_FIREBASE_PROJECT_ID`가 다른 프로젝트면 경고한다. 교사 로그인(이메일/비밀번호)은
  없는 계정으로 로그인을 시도해 오류 코드로 판정하며, 꺼져 있으면 **지금 켜기** 단추가
  서비스 계정 권한으로 Identity Toolkit 설정(`signIn.email`)만 바꾼다. 실패하면 콘솔 링크를 안내한다.
  Authentication을 한 번도 시작하지 않은 프로젝트(`CONFIGURATION_NOT_FOUND` → `not_initialized`)는 교사 계정을
  만들 수 없으므로 빨간 상자로 콘솔의 '시작하기'를 안내한다. 코드로 시작하지 않는다(API 시작은 Identity Platform 전환이라
  요금 체계가 달라질 수 있다). 확인하지 못한 경우(키 제한 등)는 문제로 단정하지 않고 아무것도 띄우지 않는다.
- 조작 실패 문구는 `describeFirebaseError`(core.ts)가 만든다. 모르는 Firebase 오류도 **오류 코드를 화면에 함께** 보여 주고
  코드와 Firebase 문구를 서버 로그에 남긴다(입력값·비밀번호는 싣지 않는다). 예전에는 일반 문구로 뭉개져 원인을 알 수 없었다.
- 모든 조작 action은 첫 줄에서 `requireAdmin()`을 부른다(`tests/admin.test.ts`가 정적으로 확인).
- 교사·연구자 계정(`users` 역할)과 별개다. 수업 운영·교사 계정 탭은 학생 답안·점수를 읽지 않는다.
  **예외는 '연구 자료' 탭**(아래 v12 절)이다. 연구 책임자가 관리 화면을 함께 운영하는 현재 구성에 맞춰
  연구ID 단위의 연습 기록을 읽으며, 조회·내보내기·제외·추출을 모두 `admin_events`에 남긴다.
- 조작은 `admin_events`에 남는다. 비밀번호 원문·해시·학생 답안은 담지 않는다.

### 반과 차시
- 반을 만들면 **여섯 자리 수업 번호**(첫 자리 1~9)를 서버가 무작위로 정하고 `active:false`로 닫아 둔다.
  `classCode`=수업 번호, `requireStudentNumber`(일반 수업만), `managedBy:'admin_console'`을 함께 쓴다.
- 반의 성격은 만들 때 한 번 정하고 바꾸지 않는다. **연구 수업·연구 검사 반은 `registry.readiness()`가 통과할 때만** 만든다.
- 관리 화면에서 만든 반은 차시 기록에 `pacing:'teacher'`가 붙는다. 이 표시가 있으면 **일반 수업이어도 연 차시만** 열린다
  (`policy.ts`의 `teacherPaced`). 통제를 더할 수만 있고 연구 세션을 자율 진행으로 풀지는 못한다.
  이 표시가 없는 옛 체험 학급은 그대로 자율 진행이다.
- **수업 시작** = 입장 열기 + 그 차시 열기(닫혀 있던 기록도 다시 연다). **수업 끝내기** = 입장 닫기 + 차시 기록 전체 닫기
  (+ 선택하면 그 반의 학생 세션 폐기). 제출·점수는 지우지 않는다.
- 학생 입장 시 학급 키(`classCode`)는 **반 기록의 값만** 쓴다. 학생이 보낸 값으로 다른 반 기록 트리에 쓰지 못한다.
- 번호(출석 번호)는 일반 수업에서만 받아 `student_sessions`에 둔다. **토큰에는 넣지 않고**, 연구 수업에서는 받지 않는다.

### 교사 학생 현황 (LMS)
- `loadClassProgress`(교사, 배정된 반만)가 반 기록·차시 기록·학생 세션·제출을 다시 읽어 `src/server/lms/progress.ts`로 묶는다.
  다시 들어와 세션이 바뀌어도 같은 번호면 한 줄이다. 30초마다 새로 읽는다.
- 일반 수업은 점수·최근 답안까지 보인다. 결측 점수는 0점이 아니며 평균에 넣지 않는다.
- **연구 수업은 교사 블라인드 채점을 흐리지 않도록 AI 점수·답안·시각을 보여 주지 않는다.** 참가자별 진행 수만 보인다.

## 논문 v12 반영 — 시도 기록·문항별 힌트·연구 추출

연구 흐름: 학생이 연습 36문항에 쓰고 피드백을 보고 다시 쓴다 → 연구자가 A·B·C에서 대표 문항 셋을 고른다 →
부적절한 행을 제외하고 앱 AI 5수준별로 문항마다 4개씩(60개) 뽑는다 → AI 평가 에이전트와 전문가 3명이 따로 채점한다.

### 시도별 저장 (이미 있던 것 + 보완)
- 연구 세션 연습은 제출마다 `research/v7.0/practice_submissions`에 새 문서로 남고 덮어쓰지 않는다(submit-core).
  researchId·classResearchId·questionId·questionLevel(=level)·lesson(=chasi)·band·attemptNo, 개인정보 점검을 거친 text,
  scoring.feedback(text·status), scoring.result(축별 수준·총점), rubricVersion·cueVersion·modelId·promptHash·imageHash,
  startedAt·submittedAt·durationMs, responseStatus·missingReason·persistStatus.
- 연습 문항은 레지스트리에 이미지 해시가 없어 예전에는 `imageHash`가 null이었다. 이제 채점 때 실제로 읽은 해시를 남긴다
  (채점 전에 끝난 결측이면 여전히 null — 지어내지 않는다).
- **`SCHEMA_VERSION`(v7.0)은 올리지 않았다.** 이 값이 저장 경로 `research/{SCHEMA_VERSION}`에도 쓰여, 올리면 열린 차시·검사 자료가
  새 경로로 갈라진다. 기존 문서에 필드를 더하지 않았고, 새 기록(제외·추출)에는 `schemaVersion: 'v12-extraction-1'`을 따로 붙인다.

### 문항별 힌트
- `src/lib/practice-hints.ts`에 36문항 초안이 있다. 실제 그림을 보고 썼고 정답 값(색 이름·개수·대상 이름)은 적지 않는다
  (`tests/hints.test.ts`가 색·개수 낱말과 숫자를 막는다). C밴드는 분위기를 근거와 함께 쓰라고 안내한다.
- **`reviewed: true`인 힌트만 학생 화면에 나간다.** 검수 전에는 차시 공통 안내(`GUIDE`)가 그대로 나간다.
  검수표: `docs/practice-hints-review.md`(`npm run hints:table`). 검수 메모는 학생 번들에 싣지 않으려고 스크립트에만 둔다.
- 연습 화면만 문항 힌트를 쓴다. 게임·시간 제한·연수 화면은 `rubric`(차시 공통 안내)을 그대로 쓴다.

### 요약·연구 추출 (`/admin` → 연구 자료)
- 계산은 `src/server/export/practice-summary.ts`(순수), 배선은 `src/server/admin/research-actions.ts`.
- 연구 연습 제출만 읽고, **지금 기준으로 동의가 유효한 학생만** 셈한다(철회자는 제출 뒤라도 빠진다).
- 앱 AI 5수준 = `round_half_up(1 + 4 × 총점/100)`(축 수준의 가중 평균). 반올림 전 값도 함께 낸다. **이 규칙은 코드가 정한 것이다.
  논문에 다른 정의가 있으면 `appLevelOf` 하나만 바꾸면 된다.** 결측은 분포·평균에 넣지 않고 따로 센다.
- 학생 × 문항 요약: 시도 수, 첫·최종 프롬프트와 점수·수준, 피드백 목록(시도 순, ` | `), 첫·최종 제출 시각, 결측 여부.
  문항 요약: 36문항 모두, 학생 수, 평균 시도 수(반올림 안 함), 최종 5수준 분포, 결측 수.
- 제외 표시(무관한 내용 / 개인정보 포함)는 `research/v7.0/extraction_exclusions`에 남고, 해제해도 지우지 않고 `active:false`와 이력을 남긴다.
  최종 프롬프트가 개인정보 점검에 걸리면 '개인정보 의심'으로 표시만 한다(자동 제외 아님).
- 추출: 문항(최대 3) × 5수준으로 층을 나눠 층마다 n개(기본 4, 1~9)를 뽑는다. 층마다 `${seed}|${문항}|${수준}` 난수로 섞어
  문항을 고른 순서와 무관하게 같은 결과가 나온다. 모자란 층은 채우지 않고 shortfall로 남긴다.
  사례 ID `{문항번호}-{수준}{순번}`(예: 01-31). 시드·후보·제외 목록·결과를 `research/v7.0/extraction_samples`에 저장한다.
  **사례 ID에 앱 AI 수준이 들어 있다.** 전문가에게 수준을 가리려면 case_id·app_level 열을 빼고 다른 번호를 붙인다.
- CSV는 브라우저로만 내려간다(BOM은 브라우저에서 다시 붙인다). `rp_*.csv`·`/exports/`는 `.gitignore`에 있다.

## 연수 모드 (`/lecture`) — 연구 경로가 아니다

교사 연수에서 앱을 바로 보여 주기 위한 시연용 경로다. 설계서에 없는 운영 편의 기능이며
연구 절차의 일부가 아니다. 무엇인지와 무엇이 아닌지를 분명히 해 둔다.

- 수업 번호·교사 로그인·차시 개방·동의 절차를 **거치지 않는다.** `LECTURE_CODE`(기본 `1111`)를
  한 번 입력하면 HttpOnly 쿠키(`rp_lecture`)를 심고 그 쿠키가 있을 때만 채점을 받는다.
  이 번호는 연수장에서 공유하는 값이므로 **비밀번호로 보지 않는다.** 막으려는 것은 URL이
  밖으로 퍼졌을 때의 무작위 모델 호출이지 인증이 아니다.
- **아무것도 저장하지 않는다.** Firestore를 열지 않고 연구 컬렉션을 건드리지 않는다.
  여기 점수는 연구 자료가 아니며 교사 화면·내보내기에 나타나지 않는다. 화면에도 그렇게 적는다.
- 문항은 연습 36개에서 뽑은 **고정 20개**(`src/lib/lecture-questions.ts`)뿐이다. 목록 밖 ID는
  서버가 거절한다. 검사 문항은 레지스트리가 `research_assessment`에만 허용하므로 애초에 열리지 않는다.
- 채점은 일반 체험과 같은 `sessionType: 'experience'` 규칙이다. 문항별 비공개 단서가 없으므로
  **공통 루브릭 문언만으로** 채점된다.
- 이 쿠키로는 연구 화면(`/practice`·`/assessment`·`/admin`)에 들어갈 수 없다. `middleware.ts`의
  matcher와 `session-modes.ts`는 손대지 않았고, 그쪽은 그대로 서버 세션을 요구한다.
  `/lecture`는 matcher 밖이라 통과하는 것이며, 우회로를 뚫어 준 것이 아니다.

## 검사 (설계서 §5)

- 검사 문항은 **T1 → T2_v7 → T3**, 밴드 A/B/C, 제한시간 **420 / 480 / 600초**.
  안내 5분 + 7/8/10분 + 마무리 3분 = 33분.
- 단색 배경의 **이전 T2는 레지스트리에 없다.**
- 검사 화면은 **AI를 호출하지 않는다.** 점수·피드백·힌트·모범답이 없고 제출 후 재도전이 없다.
- 문항 시작·마감은 **서버 시간 기준**이며 새로고침으로 초기화되지 않는다.
- 제출은 `submissionId` 기준 **idempotent**. 최초 유효 제출은 불변이고 이후는 `rejected_duplicate` 기록.
- 시간 종료 미제출은 `timeout_unsubmitted`. 장애·철회·미동의는 **서로 다른 상태**이며 빈 응답을 최저 점수로 만들지 않는다.
- 채점은 수집이 끝난 뒤 **사전·사후를 섞어** 별도 작업(`scripts/score-assessments.mjs`)으로 한다.
  채점자 payload에 **시점·학생·학급·자동 점수가 없다.**
- **최초 운영 점수(`repeatIndex: 1`)가 주 자료로 잠긴다.** 반복 2·3은 신뢰도 분석용으로 따로 저장하며
  3회 평균이 주 자료를 덮어쓰지 않는다. 시점 혼합 순서는 시드로 재현한다.
- 검사 이미지는 `public/`에 두지 않는다. `/api/research/asset/[questionId]`가 인증을 확인하고
  `private, no-store`로 스트리밍한다. **학생이 화면의 이미지를 복사하는 것까지 막았다고 주장하지 않는다.**

## 인증·동의·권한 (설계서 §6)

- 학교 담당자가 실명 대응표를 저장소 밖에서 관리하고 **무작위 수업ID**를 발급한다.
  **수업ID 자체를 비밀번호로 보지 않는다.**
- 교사는 인증된 계정으로 **배정된 학급만** 본다. 학생은 서버가 발급·검증한 세션 토큰으로 허용된 활동만 한다.
  옛 sessionStorage(학교코드·학년반·출석번호) 신원은 연구 세션의 권위 있는 신원이 아니다.
- Admin SDK가 보안 규칙을 우회하므로 **서버에서도 역할과 대상 범위를 검증**한다.
  `requireClassAccess`는 행위(read/write/delete)까지 함께 판정한다. 행위를 넘기지 않으면
  가장 강한 `write`로 본다 — 읽기 전용 화면은 `{ action: 'read' }`를 명시해야 한다.
- 자격증명이 없으면 **우회 없이 실패**한다. 설정 오류를 일반 체험으로 강등하지 않는다.
  로컬에서 자격증명 없이 띄우면 차시 조회가 503이 되는데, 의도한 fail-closed다.
- 보호자 동의 + 학생 승낙이 모두 활성일 때만 연구 수집이 가능하다. 미동의자는 수집 단계에서 차단하고
  외부 전송 없는 대체 활동으로 연결한다. 비연구 수업 기록은 연구 저장소와 분리한다.
- 철회 뒤에는 새 전송·추가 채점을 차단한다. **자료 파기는 기록만 남기고 자동 전체 삭제를 하지 않는다.**
- 외부 전송 전에 개인정보를 점검하고 의심되면 멈춰 교사 확인을 받는다.
  **필터를 통과했다고 개인정보가 완전히 제거되었다고 표시하지 않는다.**
  학생 입력칸 아래에는 짧은 행동 안내(`PII_STUDENT_NOTICE`: 개인정보는 절대 쓰지 않아요)만 두고,
  점검의 한계 고지(`PII_NOTICE`)는 교사·감수 화면에 둔다.
- 연구자가 받는 자료에 학교 실명 대응표·출석번호·학교명이 없다. AI payload에 신원 ID가 없다.

## Firestore 스키마

기존 `classes/` 트리(비연구 수업 기록)는 **그대로 두고 건드리지 않는다.** 연구 자료는
`research/{schemaVersion}/` 아래에 모아 두고 강제 이관을 하지 않는다.

경로는 `src/server/firebase-admin.ts` 한 곳에서만 정한다. 어떤 모듈도 컬렉션 이름을 직접 적지 않는다.

```
users                       # 계정과 역할 (관리 화면이 만든 교사: email·displayName·createdBy 포함)
research_classes            # 무작위 수업ID (실명 대응표는 저장소 밖)
                            #   + label·entryPassword(해시)·classCode·requireStudentNumber·managedBy
admin_config/console        # 관리자 비밀번호 scrypt 해시
admin_events                # 관리 화면 조작 기록
consents / consent_events   # 동의·승낙과 그 변경 이력
student_sessions            # 학생 세션 토큰 폐기 목록
audit_approvals             # 실데이터 감수 승인 기록
classes/…                   # 비연구 수업 기록 (기존 구조 유지)

research/v7.0/
  assessment_sessions  assessment_windows  assessment_submissions
  assessment_rejections  practice_submissions  lesson_sessions
  scoring_runs  scoring_batches  teacher_blind_scores
  extraction_exclusions  extraction_samples      # v12 연구 추출(제외 표시·추출 결과)
```

클라이언트가 보낸 문자열을 문서 ID나 경로에 쓰기 전에는 `assertSafeDocId`를 지난다.
`firestore.rules`와 `firestore.indexes.json`도 같은 이름을 쓴다.

저장 문서의 필수 필드는 `src/lib/research/types.ts`의 `SubmissionRecord`·`ScoringRun`이 정의한다.
CSV 내보내기는 **null을 유지**하고 수준의 소수를 유지하며 기준 버전을 포함한다. 수식 주입을 막고 UTF-8 BOM을 붙인다.

## 연구 시작을 막는 값 (미확정 운영값)

`registry.readiness()`가 아래를 확인한다. 하나라도 걸리면 `researchReady=false`이고 연구 등록·검사·채점이 막힌다.
**코드가 만들어 낼 수 없는 값을 자동으로 채우지 않는다.**

- 검사 문항 3개가 모두 `status: 'candidate'`, `approvedAt: null` — 전문가 검토·예비 채점 전
- 비공개 단서 팩(`RESEARCH_ASSET_DIR/cue-pack.json`) 미적재
- `CONSENT_VERSION` / `IRB_APPROVAL` / `EVALUATION_MODEL_VERIFIED` 미설정
- 검사 이미지 SHA-256 불일치

`candidate`를 코드가 `frozen`으로 올리는 경로는 만들지 않았다.

## 학교 검색은 NEIS Open API

- `https://open.neis.go.kr/hub/schoolInfo` (`SCHUL_KND_SC_NM=초등학교` 필터)
- 키 없어도 동작하지만 한 교실(~30명) 동시 입장 시 throttle 가능 → `NEIS_API_KEY` 권장
- 학교 코드는 `SD_SCHUL_CODE` 사용

## 연습 모드의 정적 이미지

연습 모드는 사전 제작·검수한 정적 이미지 36장(`public/questions/L01.jpg ~ L36.jpg`)을 쓴다.
실행 중 생성을 하지 않으므로 프롬프트에 없는 요소가 끼어들지 않는다.
1차시 안내는 **이름과 눈에 보이는 기본 색·모양을 함께** 쓰게 한다(A밴드가 대상·구체성 두 축을 함께 채점하므로).
전문 질감·재질은 1차시에서 요구하지 않는다. 2차시가 크기·개수로 좁히는 역할을 맡는다.

게임·시간 제한 모드의 문항(`game-01`~`game-10`, `ta-01`~`ta-08`)도 `public/questions/`의 정적 이미지를 쓰며
레지스트리에 `allowedSessionTypes: ['experience']`로만 등록되어 있다. 문항별 단서가 없으므로
공통 문언만으로 채점되고 **그 점수는 연구 자료가 아니다.**

## 알려진 한계

- Firebase Emulator 권한 시험과 브라우저 통합 시험은 **작성만 하고 실행하지 않았다.**
  `npm test`에서 skip으로 나오며 **skip은 통과가 아니다.**
- 실제 모델 연동 시험을 하지 않았다. 모델 호출은 전부 가짜 구현으로 시험했다.
- 검사 단서 노출 점검은 비공개 단서 팩이 있을 때만 실제 문장으로 훑는다. 팩이 없으면 건너뛴다.
- edge middleware는 힌트 쿠키만 읽는다(힌트가 없으면 열지 않는다). 실제 판정은 server action·API가 다시 한다.
- 교사 블라인드·연구자 화면이 아직 연습 제출만 읽는다. 검사 6응답은 내보내기 경로로 받아야 한다.
- 관리자 로그인은 실패마다 지연을 두고 10자 이상을 요구할 뿐, 서버 전체에서 시도 횟수를 세어 잠그지는 않는다.
  반 입장 비밀번호(4자 이상) 대조에도 시도 횟수 제한이 없다. 교실 입장 문턱이지 강한 자격이 아니며,
  수업이 끝나면 **수업 끝내기**로 입장을 닫아 두는 것이 실제 방어다.
- 통합 관리 흐름(관리자 로그인 → 반 만들기 → 수업 시작 → 학생 입장 → 교사 현황 → 수업 종료 → 관리자 비밀번호 변경)은
  **로컬 Firebase 에뮬레이터(Firestore·Auth)로 브라우저에서 한 번 돌려 확인했다.** 실제 운영 프로젝트·Vercel에서는 돌리지 않았다.
  학생 제출은 모델을 부르지 않고 문서를 직접 넣어 흉내 냈다.
- 관리 화면에서 만들지 않은 옛 체험 학급은 `pacing`이 없어 차시를 열고 닫아도 학생 화면에 모든 차시가 보인다(화면에 표시).
- 검사(사전·사후) 세션 열기·닫기는 아직 교사 화면에만 있다. 관리 화면에는 없다.
- **연구 반을 만들 수 없는 상태다.** `registry.readiness()`가 v12에서 쓰지 않는 사전·사후 검사 문항(T1~T3)의 확정·이미지·단서까지
  요구한다. 이 조건을 v12에 맞게 줄일지는 연구 설계 결정이라 코드를 바꾸지 않았다.
- 참가 번호(`research_classes/{id}/participants/{researchId}.codeHash`)와 동의 기록(`consents/{researchId}`)을 만드는 화면이 없다.
- 연구 세션 채점은 비공개 단서 팩을 `RESEARCH_ASSET_DIR` 파일에서 읽는다. Vercel에는 저장소 밖 파일을 둘 자리가 없어 운영 방식을 정해야 한다.
- v12 연구 추출 흐름(요약·제외·추출·CSV·연구 세션 학생 화면)은 로컬 에뮬레이터에서 가짜 연구 자료로 한 번 확인했다. 실제 연구 자료로는 돌리지 않았다.
- **지금 켜기**(교사 로그인 방식 자동 설정)는 실제 Google API에 대고 시험하지 않았다. 에뮬레이터는 설정 없이 모든
  로그인을 받아 주므로 이 호출을 건너뛴다. 실패하면 화면이 콘솔 링크를 안내한다.
- 게임·시간 제한 모드의 결과는 **어디에도 저장되지 않는다.** 화면에도 그렇게 표시한다.
- `npm run lint`가 동작하지 않는다(위 참고).
- **`.firebaserc`(`promptgrader-jun`)와 이 문서의 프로젝트명(`promptgrader`)이 다르다. 배포 전에 어느 쪽이 맞는지 확인할 것.**
- NEIS API는 가끔 한국 외 리전에서 응답 느림.
- `package-lock.json` 커밋됨 — npm 사용 가정.

## 자주 손볼 만한 곳

| 원하는 변경 | 건드릴 파일 |
|---|---|
| 공통 5수준 문언 | `src/lib/rubric.ts` (여기 하나뿐) |
| 지시문 조립·입력 취급 규칙 | `src/lib/evaluation-prompt.ts` |
| 밴드·배점·환산·형식 검증 | `src/lib/scoring.ts` |
| 운영 채점 결합 규칙 | `src/server/grading/operational.ts` |
| 피드백 형식·인용 검증 | `src/lib/feedback.ts` |
| 문항 등록·검사 메타데이터 | `src/server/registry/entries.ts` |
| 문항별 단서 | `RESEARCH_ASSET_DIR/cue-pack.json` (저장소 밖) |
| 연습 문항 추가/수정 | `src/lib/questions.ts` + `public/questions/L01~L36.jpg` |
| 차시 개방 판정 | `src/server/lessons/policy.ts` |
| 세션별 허용 모드 | `src/lib/research/session-modes.ts` |
| 연수 모드 문항 20개·입장 번호 | `src/lib/lecture-questions.ts` · `LECTURE_CODE` |
| 검사 시간 계획 | `src/server/assessment/timing.ts` |
| 권한·역할 판정 | `src/server/auth/access.ts` |
| 보안 규칙 | `firestore.rules` (경로 이름은 `src/server/firebase-admin.ts`와 맞출 것) |
| 컬렉션 경로 | `src/server/firebase-admin.ts`의 `COLLECTIONS`·`RESEARCH_COLLECTIONS` |
| 개인정보 점검 규칙 | `src/server/privacy/index.ts` (오탐·미탐 사례는 `tests/privacy.test.ts`에 고정) |
| 교사 차시 개방·루브릭·학생 현황 화면 | `src/app/teacher/page.tsx` |
| 통합 관리 화면 | `src/app/admin/page.tsx` · `src/server/admin/actions.ts` |
| 비밀번호 규칙·해시·관리자 토큰 | `src/server/admin/core.ts` |
| 학생 현황 집계(보이는 범위) | `src/server/lms/progress.ts` |
| 문항별 힌트·검수 상태 | `src/lib/practice-hints.ts` (고친 뒤 `npm run hints:table`) |
| 앱 AI 5수준·요약·층화 추출 규칙 | `src/server/export/practice-summary.ts` |
| 모델 교체 | `src/server/config.ts`의 `EVALUATION_MODEL_ID` |

## 복구 기록

이 프로젝트는 Firebase Studio 다운로드 중간에 잘린 zip 12개를 Python `zipfile`로 local-file-header 단위
복구해서 만들었다. 이후 손본 핵심 변경: API 키 하드코딩 → 환경 변수, 학급 코드 → 학교+학년+반+번호(NEIS 연동),
연습 모드 차수별 자료 수집, 0~100 직접 채점 → 축별 5수준 판정(v6), 그리고 이번 v7 반영.

## 자주 쓰는 콘솔 URL

- Firestore 데이터: https://console.firebase.google.com/project/promptgrader/firestore/data
- Firestore 규칙: https://console.firebase.google.com/project/promptgrader/firestore/rules
- Firebase 웹 앱 config: https://console.firebase.google.com/project/promptgrader/settings/general
- Vercel 대시보드: https://vercel.com/dashboard (kwonjungu 계정)
