# 나는 프롬프트 마스터 (Prompt Master)

초등학생을 위한 AI 프롬프트 엔지니어링 학습 웹앱. 그림을 보고 한국어로 설명을 적으면
AI가 축별 5수준으로 판정하고 피드백을 준다. 석사 학위논문(역프롬프트)의 연구 도구를 겸한다.

- **학생 화면:** `/`
- **설명 모드:** `/guide` · **연습 모드:** `/practice` · **검사:** `/assessment`
- **연수 체험판:** `/lecture` (연수 번호만 입력, 고정 20문항, **저장하지 않음**)
- **교사 대시보드:** `/teacher` (로그인 필요, 배정된 학급만)

> **연구 상태.** 검사 문항은 아직 `candidate`이고 전문가 검토·예비 채점 전이다.
> IRB 승인·동의서 버전·모델 접근 확인 같은 값이 비어 있으면 프로그램이 `researchReady=false`로
> 연구 등록과 검사를 막는다. 코드가 승인·확정을 대신 만들어 내지 않는다.

## 연수 체험판 (`/lecture`)

교사 연수에서 앱을 바로 보여 주기 위한 경로다. 수업 번호·로그인·차시 개방이 없고,
`LECTURE_CODE`(기본 `1111`)를 한 번 넣으면 연습 문항에서 뽑은 고정 20문항을 순서대로 쓴다.

**쓴 글과 점수를 저장하지 않는다.** 연구 자료가 아니며 교사 화면·내보내기에 나타나지 않는다.
이 번호는 연수장에서 공유하는 값이므로 비밀번호가 아니다 — 막으려는 것은 URL이 밖으로
퍼졌을 때의 무작위 모델 호출이다. 이 경로로 연구 화면에 들어갈 수는 없다.

## 기술 스택

- Next.js 15 (App Router, Turbopack) + React 18
- Genkit + Google Gemini (모델 ID는 `EVALUATION_MODEL_ID`, 기본 `googleai/gemini-3.8-flash`)
- Firebase — 클라이언트 SDK + 서버 `firebase-admin`(권한 검증 후 쓰기), Firestore 보안 규칙은 기본 거부
- shadcn/ui + Tailwind CSS

## 로컬 실행

```bash
git clone https://github.com/kwonjungu/reverse-prompt.git
cd reverse-prompt
npm install

cp .env.example .env.local
# .env.local 을 열어 채운다
#  - GOOGLE_GENAI_API_KEY: https://aistudio.google.com/app/apikey
#  - NEXT_PUBLIC_FIREBASE_*: Firebase 콘솔 → 프로젝트 설정 → 일반 → 내 앱 → 구성

npm run dev        # http://localhost:9002
```

검증 명령:

```bash
npm run typecheck  # tsc --noEmit
npm test           # 순수 함수·모의 모델 테스트 (실제 모델을 호출하지 않는다)
npm run build      # 프로덕션 빌드 (GOOGLE_GENAI_API_KEY 필요)
```

`npm test`의 Firebase Emulator 권한 시험과 검사 단서 노출 점검은 에뮬레이터·비공개 단서 팩이 없으면
건너뛴다. **건너뛴 것은 통과가 아니다.** 실제 모델을 호출하는 시험은 없다.

`npm run lint`는 동작하지 않는다 — eslint 설정과 패키지가 없어 `next lint`가 대화형 설치 프롬프트로 빠진다.

## 비공개 연구 자산

검사 이미지와 문항별 채점 단서·앵커는 **이 저장소에 두지 않는다.** 저장소 밖 디렉터리를
`RESEARCH_ASSET_DIR`로 지정하고 `cue-pack.json`과 검사 이미지를 그 아래에 둔다.
형식과 작성 절차는 `research-assets/README.md`, 빈 형식 예시는 `research-assets/cue-pack.example.json`에 있다.

검사 이미지는 `public/`으로 서빙하지 않고 `/api/research/asset/[questionId]`가 인증을 확인한 뒤
`private, no-store`로 내려보낸다. 다만 **학생이 검사 중 화면에서 보는 이미지를 복사하는 것까지
기술적으로 막았다고 주장하지 않는다.**

## 환경 변수

`.env.example`이 전체 목록이다. `.env*`는 gitignore.

서버 전용 필수 값: `GOOGLE_GENAI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`,
`STUDENT_SESSION_SECRET`, `PARTICIPANT_CODE_PEPPER`.
연구 시작 조건: `RESEARCH_ASSET_DIR`, `CONSENT_VERSION`, `IRB_APPROVAL`, `EVALUATION_MODEL_VERIFIED=true`.
`NEXT_PUBLIC_*`는 클라이언트 번들에 인라인되므로 진짜 비밀값을 넣지 않는다.

## 호스팅

`main`에 푸시하면 Vercel이 자동 배포한다. 배포 환경에도 위 환경 변수를 등록해야 한다.
Firestore 보안 규칙(`firestore.rules`)은 저장소에 있으나 **콘솔에 실제로 배포했는지는 별도로 확인해야 한다.**

## 더 읽을 것

개발 메모와 설계 근거는 `CLAUDE.md`에 있다. 채점 규칙·차시 개방·검사 절차·권한 모델의 세부와
아직 확정하지 못한 운영값 목록이 거기에 정리되어 있다.
