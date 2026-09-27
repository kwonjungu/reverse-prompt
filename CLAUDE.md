# PromptGrader (reverse-prompt) — 개발 메모

초등학생용 AI 프롬프트 엔지니어링 학습 웹앱. 그림을 보고 한국어로 설명을 적으면 Gemini가 공통 루브릭 v12-2의 세 영역(대상·특징·관계)을 4수준으로 판정하고 네 문장 피드백을 준다.
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
| `EVALUATION_MODEL_ID` | 채점 모델 | 비우면 기본 `googleai/gemini-2.5-flash`(`src/server/config.ts`). 실제로 답한 모델은 채점 기록의 `servedModel` |
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
    flows/evaluate-prompt.ts    # 게임·타임어택 전용 채점 액션(옛 v7, 일반 체험 세션만)
    flows/audit-agent.ts        # 기본 합성 자료. 실데이터는 승인 기록 필요
  lib/
    rubric.ts                   # 공통 루브릭 v12-2(3영역 4수준·운영 규칙)의 단일 리소스
    evaluation-prompt.ts        # 공통 문언 + 문항별 필수 정보 + 판정 영역으로 지시문 조립, 피드백 전용 지시문
    scoring.ts                  # 밴드·영역·수준 검증·종합 수준·다음 행동 영역. 엄격 검증
    feedback.ts                 # 네 문장 피드백 검증(영역·인용·금지 표현) — 점수와 분리
    quote.ts                    # 학생 원문 인용 확인(evidence·quote 공용)
    stages.ts                   # 6단계 이름·문항 배치·제시 순서·초점 영역
    questions.ts                # 연습 36문항의 공개 정보만(제시 순서로 정렬)
    practice-hints.ts           # 문항별 힌트(목표 + 확인 질문, 규칙으로 생성). 검수(REVIEWED_QUESTIONS)를 마친 것만 화면에 나간다
    practice-progress.ts        # 연습 순서 진행(제시 순서로 안 낸 가장 앞 문항, 뒤 문항·단계 숨김). 순수
    legacy-v7/                  # 옛 공통 루브릭 v7(5수준·100점) — 게임·타임어택 전용
    research/                   # 공통 도메인 타입, 세션별 허용 모드
  server/                       # 서버 전용. 클라이언트 번들에 실리지 않는다
    admin/                      # 통합 관리: core(해시·토큰 순수) · auth(관리자 세션) · actions · research-actions
    lms/                        # 교사 학생 현황 집계(순수)
    lecture/                    # 연수 체험판 배선. 연구 저장소를 열지 않는다
    config.ts                   # 모델 ID·자산 경로·동의 버전 등 단일 지점
    auth/                       # 역할·학급 범위·동의·세션 토큰·비식별
    privacy/                    # 전송 전 개인정보 점검
    registry/                   # 문항 레지스트리, 비공개 단서 팩, 제작 프롬프트
    grading/                    # 운영 채점 1회(v12-2, 모델 1회) · legacy-v7(게임·타임어택)
    lessons/                    # 차시 개방 판정·저장
    assessment/                 # 검사 세션·제출·사후 일괄 채점
    export/                     # CSV 내보내기, 중복·완전성 점검, practice-summary(v12 요약·추출, 순수)
research-assets/                # 형식과 절차만. 실제 단서·이미지는 커밋하지 않는다
firestore.rules                 # 기본 거부
```

## 채점 — 공통 루브릭 v12-2 (3영역 4수준)

연습(연구·일반)·검사·연수는 **공통 루브릭 v12-2**로 채점한다. 논문이 검증하는 AI 평가 에이전트와 학생이 실제로 쓰는
앱 채점이 같아야 하기 때문이다. **게임·타임어택만 옛 v7(축별 5수준·100점)을 그대로 쓴다**(`src/lib/legacy-v7/`,
`src/server/grading/legacy-v7.ts`, `src/ai/flows/evaluate-prompt.ts` — 일반 체험 세션의 game-XX·ta-XX 문항만 받는다).

### 공통 루브릭은 하나의 리소스에서만 나온다
`src/lib/rubric.ts`(`RUBRIC_VERSION='v12-2'`)가 세 영역의 4수준 기준과 운영 규칙을 **연구자가 준 문장 그대로** 담고,
AI 지시문·교사 화면·내보내기 문서를 `renderForModel/renderForTeacher/renderForExport`로 **같은 원본에서 생성**한다.

### 영역과 수준 (모든 밴드 공통)
- `object` 대상의 명확성 / `feature` 특징의 구체성 / `relation` 관계의 명확성. 각 **정수 1~4 또는 `'not_applicable'`**.
- 관계 범위: A밴드(L01–12)는 대상 사이 공간 관계, B·C밴드는 장소와 행동이 필수(C의 시간대·분위기는 선택).
- **100점 환산·밴드별 배점·반수준 결합은 쓰지 않는다.** 점수를 합산하지 않는다.
- 밴드(`bandOf`)는 문항 번호로 정한다: A=L01–12, B=L13–24, C=L25–36(연구 표집의 A·B·C와 같다). 단계와 무관하다.
- **앱 종합 수준** = 해당 영역 수준 평균(not_applicable 제외)을 반올림(0.5 올림)한 1~4(`overallLevelOf`).
  연구 표집의 층을 나누는 값이며 학생 화면에는 보이지 않는다. 저장하지 않고 필요할 때 계산한다.

### 해당 없음(not_applicable)은 누가 정하나
- 비공개 단서 팩이 있으면 **코드가 정한다**(`applicabilityOf`): 대상은 늘 판정, 필수 속성이 비면 특징 해당 없음,
  필수 맥락(`requiredContext`)이 비면 관계 해당 없음. 모델 출력이 이와 다르면 형식 오류다. 단서 팩 구조는 바꾸지 않았다.
- 단서 팩이 없는 일반 체험은 모델이 정한다(대상은 늘 판정). `ScoringRun.applicabilitySource`에 `'cue_pack' | 'model'`로 남는다.

### 형식 오류를 유효 값으로 바꾸지 않는다
영역마다 `{level, evidence, missing, evidence_missing}`를 받고 `validateAreaCall`이 검사한다. 0·5·2.5·`'3'`·NaN·null은
형식 오류다. **evidence는 학생 원문에 그대로 있어야 한다**(공백만 다른 것은 허용) — 없으면 형식 오류.
해당 없음 영역은 evidence가 null이고 missing이 비어야 한다. 결측은 최저 수준이 아니라 `areas: null`이다.

```ts
type OperationalResult =
  | { status: 'scored';  areas: { object|feature|relation: { level; evidence; missing; evidenceMissing } }; feedbackStatus }
  | { status: 'missing'; areas: null; reason: 'model_error' | 'schema_error' | 'required_call_failed' }
```

### 운영 채점 1회 — 모델 1회 호출 (`src/server/grading/operational.ts`)
1. 같은 고정 입력으로 모델을 **1회** 부른다. **호출 실패·형식 오류일 때만 1회 다시 부른다.**
2. 유리한 출력을 고르려고 다시 부르지 않고, 여러 호출을 결합(평균·중앙값)하지 않는다(옛 2+1 절차는 없앴다).
3. 다시 불러도 실패하면 운영 결측. 일부 값으로 정상 결과를 만들지 않는다.
4. 판정이 확정되면 **피드백 실패 때문에 재채점하거나 판정을 바꾸지 않는다.**
5. 반복 채점(검사의 `repeatIndex` 2·3)은 그대로이며 영역별 수준을 저장한다.

호출마다 `callId`·`retryIndex`·`purpose('score'|'feedback')`·검증된 levels·`failureReason`·**`servedModel`**(모델 API가
응답에 밝힌 실제 모델, Gemini `modelVersion`)·시각을 남긴다. 실행 단위에는 설정한 `modelId`와 점수를 낸 호출의 `servedModel`이 함께 남는다.
호출 기록에 학생 개인정보·비밀키·원시 인증토큰·학생 글 인용을 남기지 않는다.

### 문항별 단서
채점에는 실제 이미지와 그 문항의 필수 정보(핵심 대상·필수 속성·필수 관계·앵커)를 함께 쓴다. 단서는 **비공개 자산**이며
`RESEARCH_ASSET_DIR/cue-pack.json`에서 읽는다. 단서가 없으면 연구 세션 채점을 거부한다(`cues_missing`).
앵커는 **1~4수준 키만** 지시문에 들어간다(옛 5수준 앵커는 v12-2용으로 다시 써야 한다). 앵커 키 `specificity`·`context`는
각각 특징·관계로 읽어 준다. 일반 체험은 단서가 없으면 공통 문언만으로 채점하고 **그 결과는 연구 자료로 쓰지 않는다.**
이미지 제작 프롬프트(`sourcePrompt`)는 정답 문장이 아니므로 지시문에 넣지 않는다(`src/server/registry/practice-source-prompts.ts`).

### 학생 입력은 데이터이지 지시가 아니다
지시문이 학생 응답을 `<<<학생응답 시작>>> … <<<학생응답 끝>>>`으로 감싸고, 그 안의 명령·점수 요구를
실행하지 않는다. 그런 문장만 제출되면 유효한 과제 정보가 없으므로 판정하는 영역을 수준 1로 판정한다.

### 피드백은 4문장, 점수와 분리 (`src/lib/feedback.ts`)
Hattie와 Timperley(2007)의 목표·현재 수행·다음 행동 구분을 참고한 배열이다. 한 줄에 한 문장.

1. 이번 목표(단계 초점)
2. 잘 쓴 점 — 어느 영역인지 밝히고 학생 글의 표현을 그대로 넣는다(`quote`, `strengthArea`)
3. 다음 행동 한 가지 — 해당 영역 가운데 **가장 낮은 영역**(같으면 단계 초점 영역, 그다음 대상→특징→관계)에서 하나만.
   이 영역은 **코드가 정하고**(`nextActionArea`) 모델이 다르게 고르면 탈락이다. 겨냥한 정보(`nextTarget`)는 그 영역
   `missing` 목록의 문구여야 하고, **단서 팩이 있으면 단서 팩의 필수 정보·허용 표현과도 맞아야 한다**(`cueTargetsOf`, 아니면
   `next_target_unverified`로 탈락). 단서 팩이 없으면 모델이 낸 목록 안인지만 본다. 그림에 없는 정보를 요구하지 않게 하는 **구조 점검**이며
   3문장이 실제로 그것을 묻는지, 4문장의 제안이 그림에 맞는지는 코드가 확인하지 않는다.
4. 쓸 수 있는 표현 제안 또는 스스로 확인할 질문

코드가 확인하는 것: 네 줄·줄마다 한 문장(넘으면 탈락), 인용이 원문에 있고 2문장 안에 있음(인용 끝의 마침표는 떼고 비교),
칭찬·비교·점수 언급 없음(2문장 안의 학생 인용 부분은 이 검사에서 가린다 — 학생이 쓴 '완벽한'은 탈락 사유가 아니다).
2·3문장 앞에는 코드가 영역 이름을 붙인다(`[대상] …`). 탈락하면 **확정된 판정을 알려 주는 피드백 전용 호출로 1회만** 다시 만들고,
그래도 탈락하면 고정 안내 `표현을 선생님과 함께 확인해 보세요`와 `feedbackStatus='fallback'`. 탈락 사유는 `feedback.rejections`에 남는다.
**네 문장 형식과 제안 수는 아동의 처리 부담을 고려한 설계 선택이며 효과가 검증된 최적값이 아니다.**
형식 검사를 통과한 것이 그림 부합이나 내용 정확성을 뜻하지 않는다.

## 차시와 모드 (설계서 §4)

- **6단계(논문 v12).** 정의는 `src/lib/stages.ts` 하나에 있다. 문항 ID·이미지는 그대로이고 단계와 제시 순서만 이 표로 정한다.

  | 단계 | 이름 | 문항 | 초점 영역 |
  |---|---|---|---|
  | 1 | 도구와 작성 방식 이해 | L01–L06 | 세 영역 |
  | 2 | 대상과 수량 | L07–L12 | 대상 |
  | 3 | 특징 | L19–L24 | 특징 |
  | 4 | 관계 | L13–L18 | 관계 |
  | 5 | 피드백 검토와 재작성 | L25–L30 | 세 영역 |
  | 6 | 종합 | L31–L36 | 세 영역 |

  초점은 힌트의 질문 순서와 피드백(1문장 목표, 3문장 영역의 동점 처리)에만 쓴다. **채점은 모든 단계에서 세 영역(해당 없음 포함)을 기록한다.**
  레지스트리의 연습 문항 `lesson`은 이 단계 값이다(L13은 4, L19는 3). 옛 제출 문서의 `lesson`은 저장된 값 그대로다.
- 차시 기록은 서버에 있다(`LessonSession`: classResearchId, currentLesson, allowedLessons,
  openedAt, closedAt, openedBy, reason). **관리 화면의 수업 시작이 1~6차시를 한 번에 연다.**
  교사·관리자가 단계를 하나씩 열고 닫는 화면은 없앴다(교사 API `lessons/open·close`는 남아 있다).
- **순서 진행(학생 화면).** 열린 단계 안에서 **제시 순서로** 아직 내지 않은 가장 앞 문항으로 들어가고(L12 다음은 L19),
  그보다 뒤 문항·단계는 **보이지도 고르지도 못한다.** 한 문항을 내야(저장 성공) 다음 문항이 열린다.
  단계 단추도 열린 문항이 있는 단계만 보인다. 규칙은 `src/lib/practice-progress.ts`(순수)에 있다.
  연습 화면 머리의 표시는 문항 번호(Lv.)가 아니라 제시 순서(예: `19 / 36`)다 — 3·4단계가 바뀌어 번호가 거꾸로 가기 때문이다.
  이것은 화면 표시다. 서버는 열린 차시인지만 판정하며 문항 순서를 강제하지 않는다.
- 진행의 근거는 서버 제출 기록이다. 일반 수업은 다시 들어오면 세션이 바뀌므로
  **같은 반·같은 번호의 세션을 이어** 센다(`auth.linkedSessionOwners`, LMS와 같은 규칙).
  연구 세션은 researchId로 이어진다. 번호 없는 옛 반만 이 기기의 localStorage 캐시로 잇고,
  번호로 이어지는 반에서는 캐시를 읽지도 쓰지도 않는다(한 기기를 여러 학생이 쓰므로).
- 옛 `REQUIRED_PER_CHASI = 6` 잠금과 localStorage 기반 진행 잠금은 **제거되었다.**
  `localStorage`는 캐시일 뿐 접근 권한·동의·완료의 권위 있는 원천이 아니다.
- 옛 홈 화면의 `extended` 토글도 **제거되었다.** 모드 차단은 화면 숨김이 아니라
  `src/lib/research/session-modes.ts`를 근거로 **middleware·화면 가드·server action·API 네 층**에서 이루어진다.
  edge middleware는 힌트 쿠키만 읽으므로 나머지 세 층이 `@/server/auth`로 다시 판정한다.
- 연구 수업(`research_practice`)은 설명·연습만 열린다. 게임·타임어택(채점 액션 `evaluate-prompt`는 일반 체험 세션과 game-XX·ta-XX만 받는다),
  사전·사후 검사(middleware `ROUTE_MODES`에 `/api/assessment/{state,start,submit,failure}` 추가, 검사 수집 서버도 세션 성격을 다시 확인),
  연수 모드는 모두 막힌다. `tests/lessons.test.ts`·`tests/assessment.test.ts`가 확인한다.
- 연구 세션에서는 게임·타임어택·감수·임의 이미지 생성의 직접 경로와 관련 서버 액션을 모두 거부한다.
  감수 화면은 `/admin/audit`로 옮겼고 middleware가 그 경로를 잡는다. `/admin` 자체는 관리자 비밀번호로 막는다.
- 관리 화면에서 만든 반(`pacing:'teacher'`)은 일반 수업이어도 연 차시만 열린다(위 "통합 관리 화면" 참고).
- **연구 세션에서는 고치지 않은 이유를 묻지 않는다(논문 v12).** 입력칸을 숨기고 서버도 `kept`를 받지 않는다.
  수정 과정은 제출할 때마다 남는 시도 기록으로만 본다. '고쳐서 다시 쓰기'의 `revised` 연결만 남고 글은 저장하지 않는다.
  일반 체험은 **'다음 문제'를 누를 때** 고치지 않은 까닭을 묻고, 학생이 적고 넘어가거나 **건너뛸** 수 있다.
  건너뛰면 아무것도 기록하지 않는다(`kept` 없음).

## 통합 관리 화면 (`/admin`) — 반을 여는 쪽

역할을 셋으로 나눈다. **관리자**가 반을 만들어 열고 닫고, **학생**은 그 반에만 들어가고,
**교사**는 교사 화면(LMS)에서 배정된 반을 추적 관찰한다.

| 누가 | 어디서 | 무엇을 |
|---|---|---|
| 관리자 | `/admin` (관리자 비밀번호) | 반 만들기·반 비밀번호·수업 시작/끝내기·교사 계정 발급과 반 배정 |
| 교사 | `/teacher` (관리자가 만든 Firebase 계정) | 배정된 반의 학생 현황(번호별 차시 진행·점수·최근 답안). 단계는 통제하지 않는다 |
| 학생 | `/` (수업 번호 + 반 비밀번호 + 번호) | 그 반의 36문항을 6단계 제시 순서대로(앞 문항을 내야 다음 문항이 열린다) |

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
- 반의 성격은 만들 때 한 번 정하고 바꾸지 않는다. 관리 화면에서 만들 수 있는 것은 **일반 수업과 연구 수업뿐**이다
  (`parseCreatableSessionType`, 서버에서도 거부). **연구 수업은 `registry.readiness()`가 통과할 때만** 만든다.
  논문 v12는 사전·사후 검사를 쓰지 않으므로 연구 검사(`research_assessment`) 반은 만들 수 없다. 그 세션 성격과 검사 경로는 옛 자료를 위해 코드에만 남아 있다.
- 관리 화면에서 만든 반은 차시 기록에 `pacing:'teacher'`가 붙는다. 이 표시가 있으면 **일반 수업이어도 연 차시만** 열린다
  (`policy.ts`의 `teacherPaced`). 통제를 더할 수만 있고 연구 세션을 자율 진행으로 풀지는 못한다.
  이 표시가 없는 옛 체험 학급은 그대로 자율 진행이다.
- 반의 상태는 **시작 전 / 수업 중 / 수업 종료** 셋뿐이다. 입장만 따로 닫는 상태(입장 마감)는 없앴다.
- **수업 시작** = 입장 열기 + 1~6차시 모두 열기(끝난 수업도 다시 연다). **수업 끝내기** = 입장 닫기 + 차시 기록 전체 닫기
  (+ 선택하면 그 반의 학생 세션 폐기). 제출·점수는 지우지 않고, 다시 시작하면 학생은 이어서 푼다.
  예전 방식으로 일부 차시만 열린 채 수업 중인 반은 카드에 **1~6단계 모두 열기** 단추가 뜬다.
- 학생 입장 시 학급 키(`classCode`)는 **반 기록의 값만** 쓴다. 학생이 보낸 값으로 다른 반 기록 트리에 쓰지 못한다.
- 번호(출석 번호)는 일반 수업에서만 받아 `student_sessions`에 둔다. **토큰에는 넣지 않고**, 연구 수업에서는 받지 않는다.

### 교사 학생 현황 (LMS)
- `loadClassProgress`(교사, 배정된 반만)가 반 기록·차시 기록·학생 세션·제출을 다시 읽어 `src/server/lms/progress.ts`로 묶는다.
  다시 들어와 세션이 바뀌어도 같은 번호면 한 줄이다. 30초마다 새로 읽는다.
- 일반 수업은 영역별 수준·종합 수준(1~4)·최근 답안까지 보인다. 결측은 수준 1이 아니며 평균에 넣지 않는다.
  옛 v7 기록은 '옛 채점'으로 따로 보이고 v12-2 평균에 섞지 않는다.
- **연구 수업은 교사 블라인드 채점을 흐리지 않도록 AI 판정·답안·시각을 보여 주지 않는다.** 참가자별 진행 수만 보인다.
  교사 화면의 '연구 자료' 탭도 교사에게는 `toTeacherBlindRecord`(AI 판정·피드백·모든 시각 필드 제거)만 준다. 연구자 역할은 전체를 본다.
- 단계 열은 문항 ID로 현재 단계표에서 정한다(옛 기록의 저장된 `lesson`은 3·4단계가 바뀌기 전 값이라 쓰지 않는다).

## 논문 v12 반영 — 시도 기록·문항별 힌트·연구 추출

연구 흐름: 학생이 연습 36문항에 쓰고 피드백을 보고 다시 쓴다 → 연구자가 A·B·C에서 대표 문항 셋을 고른다 →
부적절한 행을 제외하고 앱 종합 4수준별로 문항마다 5개씩(3 × 4 × 5 = 60개) 뽑는다 → AI 평가 에이전트와 전문가 3명이 따로 채점한다.

### 시도별 저장 (이미 있던 것 + 보완)
- 연구 세션 연습은 제출마다 `research/v7.0/practice_submissions`에 새 문서로 남고 덮어쓰지 않는다(submit-core).
  researchId·classResearchId·questionId·questionLevel(=level)·lesson(=chasi)·band·attemptNo, 개인정보 점검을 거친 text,
  scoring.feedback(text·status·strengthArea·nextArea·nextTarget·rejections), scoring.result.areas(영역별 level·evidence·missing·evidenceMissing),
  rubricVersion('v12-2')·cueVersion·scoring.modelId(설정값)·scoring.servedModel(실제 모델)·promptHash·imageHash,
  startedAt·submittedAt·durationMs, responseStatus·missingReason·persistStatus.
- 연습 문항은 레지스트리에 이미지 해시가 없어 예전에는 `imageHash`가 null이었다. 이제 채점 때 실제로 읽은 해시를 남긴다
  (채점 전에 끝난 결측이면 여전히 null — 지어내지 않는다).
- **`SCHEMA_VERSION`을 `v12.2`로 올렸다**(문서의 `schemaVersion`, 예: `v12.2-practice-submission`). 저장 경로의 버전 조각은
  `RESEARCH_STORE_VERSION`(`v7.0`)으로 분리해 고정했다 — 올리면 열린 차시·검사 자료가 새 경로로 갈라지기 때문이다.
  옛 `v7.0-…` 문서는 강제 이관하지 않고 그대로 읽는다(옛 5수준 결과는 연구 요약·추출에서 빠지고 표시된다).

### 문항별 힌트 — 목표 + 확인 기준 (설계 원리 1)
- `src/lib/practice-hints.ts`가 36문항 힌트를 **규칙으로 만든다**(손으로 쓰지 않는다). 힌트 = 목표 한 문장
  (`이 그림을 못 본 친구가 똑같이 떠올릴 수 있게 써요.`) + 영역마다 확인 질문 한 문장(루브릭 4수준 기준을 학생 말로).
  관계 질문은 A밴드는 공간 관계, B·C밴드는 장소·행동. C밴드는 시간대·분위기에 관한 선택 안내를 덧붙인다.
- **단계 초점 영역의 질문이 맨 앞**이다. 정답 값(대상 이름·색 이름·개수)과 특정 부위는 말하지 않는다(`tests/hints.test.ts`).
- 비공개 단서 팩에서 해당 없음인 영역의 질문은 뺀다 — 서버가 차시 상태(`notApplicableAreas`)로 **영역 이름만** 알려 주고
  화면이 `withoutAreas`로 거른다. 단서 팩 내용은 클라이언트로 가지 않는다.
- **`REVIEWED_QUESTIONS`에 넣은 문항의 힌트만 학생 화면에 나간다.** 검수 전에는 단계 공통 안내(`GUIDE`)가 나간다.
  검수표: `docs/practice-hints-review.md`(`npm run hints:table`). 예전 문항별 초안 문구는 지우지 않고 검수표의 참고 열로 남겼다
  (그림의 부위를 짚는 문구라 학생 번들에 싣지 않고 `scripts/print-practice-hints.mjs`에만 둔다).
- 연습 화면만 문항 힌트를 쓴다. 게임·시간 제한·연수 화면은 `rubric`(단계 공통 안내)을 그대로 쓴다.

### 요약·연구 추출 (`/admin` → 연구 자료)
- 계산은 `src/server/export/practice-summary.ts`(순수), 배선은 `src/server/admin/research-actions.ts`.
- 연구 연습 제출만 읽고, **지금 기준으로 동의가 유효한 학생만** 셈한다(철회자는 제출 뒤라도 빠진다).
- **앱 종합 수준** = 해당 영역 수준 평균(not_applicable 제외)을 반올림(0.5 올림)한 1~4(`overallLevelOf`, `APP_LEVEL_RULE` — `src/lib/scoring.ts`).
  반올림 전 값(`app_level_raw`)도 함께 낸다. **이 규칙은 코드가 정한 것이다. 논문에 다른 정의가 있으면 `overallLevelOf` 하나만 바꾸면 된다.**
  저장된 수준이 1~4·not_applicable 밖이면 보정하지 않고 결측으로 읽는다. 결측은 분포·평균에 넣지 않고 따로 센다.
- **옛 v7(5수준·100점) 기록은 요약·추출에서 뺀다.** 시도 CSV에는 `legacy_rubric=true`와 옛 값(`v7_*` 열)으로 남고,
  빠진 수(`legacyAttemptCount`)를 관리 화면에 보인다. 판정은 `isLegacyPracticeRecord`(`src/server/lessons/store-core.ts`) 하나를 쓴다.
- 학생 × 문항 요약: 시도 수, 첫·최종 프롬프트, 첫·최종 영역별 수준과 종합 수준, 최종 영역별 근거·빠진 정보, 피드백 목록(시도 순, ` | `),
  첫·최종 제출 시각, 결측 여부. 문항 요약: 36문항 모두, 단계(`chasiOfLevel`), 학생 수, 평균 시도 수(반올림 안 함),
  최종 종합 1~4수준 분포, 영역별 최종 수준 평균(반올림 안 함)과 해당 없음 수, 결측 수.
- CSV에서 해당 없음은 `not_applicable`, 결측은 `NA`로 구분한다. 빠진 정보 목록은 JSON 배열로 쓴다.
- 제외 표시(무관한 내용 / 개인정보 포함)는 `research/v7.0/extraction_exclusions`에 남고, 해제해도 지우지 않고 `active:false`와 이력을 남긴다
  (`schemaVersion: 'v12-extraction-1'`, 형이 바뀌지 않아 그대로). 최종 프롬프트가 개인정보 점검에 걸리면 '개인정보 의심'으로 표시만 한다(자동 제외 아님).
- 추출: 문항(최대 3) × 앱 종합 4수준으로 층을 나눠 층마다 n개(**기본 5**, 1~9)를 뽑는다. 층마다 `${seed}|${문항}|${수준}` 난수로 섞어
  문항을 고른 순서와 무관하게 같은 결과가 나온다. 모자란 층은 채우지 않고 shortfall로 남긴다.
  사례 ID `{문항번호}-{수준}{순번}`(예: 01-31). 시드·후보·제외 목록·결과를 `research/v7.0/extraction_samples`에 저장한다
  (`schemaVersion: 'v12-2-extraction-1'`). 옛 5수준 추출 결과는 다시 받아도 옛 열 그대로 나온다(4수준으로 바꾸지 않는다).
  **추출 CSV에는 앱의 판정(case_id·app_level·app_level_raw·영역별 수준·근거·빠진 정보)이 들어 있다.**
  전문가에게 앱 판정을 가리려면 이 열들을 빼고 다른 번호를 붙인다(관리 화면에도 안내한다).
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
- 채점은 일반 체험과 같은 `sessionType: 'experience'` 규칙(공통 루브릭 v12-2)이다. 문항별 비공개 단서가 없으므로
  **공통 루브릭 문언만으로** 채점된다. 화면은 연습 화면과 같이 영역별 단계(●●●○)와 네 문장 피드백만 보이고 점수는 없다.
- 이 쿠키로는 연구 화면(`/practice`·`/assessment`·`/admin`)에 들어갈 수 없다. 그쪽은 그대로 서버 세션을 요구한다.
- **연구 세션 학생은 `/lecture`를 쓸 수 없다.** 같은 L 그림으로 연구 밖에서 AI 채점을 받으면 연구 자료가 오염되기 때문이다.
  `middleware.ts` matcher에 `/lecture`를 넣어 연구 세션 힌트가 있으면 `/?blocked=lecture`로 돌려보내고, 연수 action도 연구 힌트 쿠키가 있으면
  입장·채점을 거부한다(`isLectureBlockedFor`). 힌트 쿠키만 보므로 쿠키를 지우면 지나갈 수 있다 — 실제 방어는 `LECTURE_CODE`를 1111에서 바꾸는 것이다.
- 연수 문항 20개는 새 단계 순서로 제시한다.

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
- 채점은 공통 루브릭 v12-2(영역별 1~4 또는 해당 없음)다. **최초 운영 채점(`repeatIndex: 1`)이 주 자료로 잠긴다.**
  반복 2·3은 신뢰도 분석용으로 영역별 수준을 따로 저장하며 주 자료를 덮어쓰지 않는다. 시점 혼합 순서는 시드로 재현한다.
- 논문 v12는 사전·사후 검사를 쓰지 않는다. 검사 반(`research_assessment`)은 준비 조건(`readiness`) 때문에 지금 만들 수 없다.
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
- 실제 모델 연동 시험을 하지 않았다. 모델 호출은 전부 가짜 구현으로 시험했다. 특히 v12-2의 엄격한 형식 검사
  (evidence 원문 일치, 네 문장·한 줄 한 문장, 인용이 2문장 안에, 다음 행동 영역 일치)를 실제 모델이 얼마나 자주 통과하는지는
  아직 모른다. 운영에서 결측(schema_error)·피드백 fallback 비율과 `feedback.rejections`를 먼저 확인할 것.
- `servedModel`은 Gemini 응답의 `modelVersion`을 읽는다. 플러그인이 그 값을 넘기지 않으면 null로 남는다(지어내지 않는다).
- A밴드 관계 영역: 대상이 하나뿐인 그림은 관계가 해당 없음이어야 하는데, 단서 팩이 없으면 모델이 정한다.
  단서 팩을 쓸 때는 필수 맥락(`requiredContext`)을 비워 두면 코드가 해당 없음으로 정한다. 검수표에 문항별 판단 거리를 적어 두었다.
- 검사 단서 노출 점검은 비공개 단서 팩이 있을 때만 실제 문장으로 훑는다. 팩이 없으면 건너뛴다.
- edge middleware는 힌트 쿠키만 읽는다(힌트가 없으면 열지 않는다). 실제 판정은 server action·API가 다시 한다.
- 교사 블라인드·연구자 화면이 아직 연습 제출만 읽는다. 검사 6응답은 내보내기 경로로 받아야 한다.
- 관리자 로그인은 실패마다 지연을 두고 10자 이상을 요구할 뿐, 서버 전체에서 시도 횟수를 세어 잠그지는 않는다.
  반 입장 비밀번호(4자 이상) 대조에도 시도 횟수 제한이 없다. 교실 입장 문턱이지 강한 자격이 아니며,
  수업이 끝나면 **수업 끝내기**로 입장을 닫아 두는 것이 실제 방어다.
- 통합 관리 흐름(관리자 로그인 → 반 만들기 → 수업 시작 → 학생 입장 → 교사 현황 → 수업 종료 → 관리자 비밀번호 변경)은
  **로컬 Firebase 에뮬레이터(Firestore·Auth)로 브라우저에서 한 번 돌려 확인했다.** 실제 운영 프로젝트·Vercel에서는 돌리지 않았다.
  학생 제출은 모델을 부르지 않고 문서를 직접 넣어 흉내 냈다.
- 관리 화면에서 만들지 않은 옛 체험 학급은 `pacing`이 없어 모든 차시가 보인다. 번호 없이 들어온 학생은 다시 들어오면
  서버가 진행을 잇지 못해 이 기기 캐시로만 잇는다(다른 기기에서는 1번부터).
- 순서 진행은 화면이 정한다. 서버는 문항 순서를 강제하지 않으므로 요청을 직접 만들면 뒤 문항도 낼 수 있다.
- 번호로 세션을 이을 때 번호는 학생이 적은 값이다. 같은 반에서 다른 학생의 번호를 적으면 그 학생의 진행(낸 문항 번호)이 보인다.
  답안·점수는 보이지 않는다.
- 검사(사전·사후) 세션 열기·닫기는 아직 교사 화면에만 있다. 관리 화면에는 없다.
- **연구 반을 만들 수 없는 상태다.** `registry.readiness()`가 v12에서 쓰지 않는 사전·사후 검사 문항(T1~T3)의 확정·이미지·단서까지
  요구한다. 이 조건을 v12에 맞게 줄일지는 연구 설계 결정이라 코드를 바꾸지 않았다.
- 참가 번호(`research_classes/{id}/participants/{researchId}.codeHash`)와 동의 기록(`consents/{researchId}`)을 만드는 화면이 없다.
- 연구 세션 채점은 비공개 단서 팩을 `RESEARCH_ASSET_DIR` 파일에서 읽는다. Vercel에는 저장소 밖 파일을 둘 자리가 없어 운영 방식을 정해야 한다.
- v12 연구 추출 흐름(요약·제외·추출·CSV·연구 세션 학생 화면)은 로컬 에뮬레이터에서 가짜 연구 자료로 한 번 확인했다. 실제 연구 자료로는 돌리지 않았다.
- **지금 켜기**(교사 로그인 방식 자동 설정)는 실제 Google API에 대고 시험하지 않았다. 에뮬레이터는 설정 없이 모든
  로그인을 받아 주므로 이 호출을 건너뛴다. 실패하면 화면이 콘솔 링크를 안내한다.
- 게임·시간 제한 모드의 결과는 **어디에도 저장되지 않는다.** 화면에도 그렇게 표시한다. 두 모드는 옛 v7(100점) 채점을 그대로 쓴다.
- `src/ai/flows/suggest-prompt-improvements.ts`는 화면에서 쓰지 않는 옛 서버 액션이다(연구 세션에서는 막힘). 지시문이 옛 방식(점수·칭찬)이라 쓰지 말 것.
- 교사 화면의 사전·사후 검사 열기·닫기 단추는 남아 있지만, 그 대상인 연구 검사 반을 더는 만들 수 없다.
- 영역 점(●●●○)이 찍힌 채점 결과 화면은 실제 모델로 채점된 적이 없어 브라우저에서 확인하지 못했다(로컬은 모델 키가 없어 결측 화면만 확인).
- `npm run lint`가 동작하지 않는다(위 참고).
- **`.firebaserc`(`promptgrader-jun`)와 이 문서의 프로젝트명(`promptgrader`)이 다르다. 배포 전에 어느 쪽이 맞는지 확인할 것.**
- NEIS API는 가끔 한국 외 리전에서 응답 느림.
- `package-lock.json` 커밋됨 — npm 사용 가정.

## 자주 손볼 만한 곳

| 원하는 변경 | 건드릴 파일 |
|---|---|
| 공통 루브릭 v12-2 문언·운영 규칙 | `src/lib/rubric.ts` (여기 하나뿐) |
| 6단계 이름·문항 배치·초점 영역 | `src/lib/stages.ts` |
| 지시문 조립·입력 취급 규칙 | `src/lib/evaluation-prompt.ts` |
| 밴드·영역·형식 검증·종합 수준·다음 행동 영역 | `src/lib/scoring.ts` |
| 운영 채점 절차(모델 1회·재시도·피드백 재생성) | `src/server/grading/operational.ts` |
| 게임·타임어택의 옛 v7 채점 | `src/lib/legacy-v7/`, `src/server/grading/legacy-v7.ts` |
| 피드백 네 문장·영역·인용·금지 표현 검증 | `src/lib/feedback.ts` |
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
| 연습 순서 진행(어디로 들어가고 무엇이 보이는가) | `src/lib/practice-progress.ts` |
| 요약·층화 추출 규칙(앱 종합 4수준 산정은 `scoring.ts`의 `overallLevelOf`) | `src/server/export/practice-summary.ts` |
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
