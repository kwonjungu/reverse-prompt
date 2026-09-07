# 비공개 연구 자산 (research-assets)

검사 이미지와 문항별 채점 단서·경계·앵커는 **이 저장소에 커밋하지 않는다.**
공개 소스·클라이언트 번들·소스맵·`public/` 경로·익명 요청에서 나오면 안 되는 자료다.
이 디렉터리에는 형식을 설명하는 문서(`README.md`)와 빈 껍데기 예시
(`cue-pack.example.json`)만 커밋한다. 실제 단서 문장은 어느 쪽에도 쓰지 않는다.

## 1. 위치

서버는 환경 변수 `RESEARCH_ASSET_DIR`이 가리키는 디렉터리에서만 자산을 읽는다
(`src/server/config.ts`). 설정하지 않으면 연구용 흐름이 열리지 않고
`registry.readiness()`가 `researchReady: false`를 돌려준다.

```
$RESEARCH_ASSET_DIR/
  cue-pack.json          # 문항별 단서·경계·앵커 (커밋 금지)
  images/
    T1.png               # 검사 이미지 (커밋 금지)
    T2_v7.png
    T3.png
```

`RESEARCH_ASSET_DIR`을 이 저장소 안의 `research-assets/`로 잡아도 되지만, 그 경우
`.gitignore`가 `research-assets/cue-pack.json`과 `research-assets/images/`를 제외하고
있는지 반드시 확인한다. 운영에서는 저장소 바깥의 경로를 쓰는 편이 안전하다.

검사 이미지의 SHA-256은 `src/server/registry/entries.ts`에 명세 값으로 박혀 있다
(출처: `검사문항_명세_v7.json`). `registry.loadImage()`는 파일을 읽어 해시를 계산하고
값이 다르면 이미지를 돌려주지 않는다. 연습 문항 36개의 이미지는 이미 공개된
`public/questions/L01.jpg ~ L36.jpg`를 그대로 쓰며, 고정 해시를 명세로 두지 않으므로
`imageSha256`은 빈 문자열이고 읽을 때 계산한 값을 함께 돌려준다.

## 2. cue-pack.json 형식

`cue-pack.example.json`과 같은 구조다. 최상위에 `cueVersion`, `rubricVersion`,
작성자·작성일·검토 상태를 두고 `questions` 아래에 questionId별 단서를 둔다.
questionId는 검사 `T1`, `T2_v7`, `T3`과 연습 `L01`~`L36`이다.

| 필드 | 뜻 | 검증 |
|---|---|---|
| `coreObjects` | 핵심 대상 목록 | 비어 있으면 실격 |
| `requiredAttributes` | 필수 속성 목록 | 비어 있으면 실격 |
| `requiredContext` | 필수 맥락 단서 목록 | A밴드는 반드시 빈 배열, B·C밴드는 비어 있으면 실격 |
| `acceptedExpressions` | 허용 표현·동의어 | 비어 있어도 됨 |
| `notRequired` | 필수로 요구하지 않는 항목 | 비어 있어도 됨 |
| `contradictions` | 모순 예 | 비어 있어도 됨 |
| `anchors.object` | 대상 축 1~5수준 앵커 | 다섯 수준이 모두 채워져야 함 |
| `anchors.specificity` | 구체성 축 1~5수준 앵커 | 다섯 수준이 모두 채워져야 함 |
| `anchors.context` | 맥락 축 1~5수준 앵커 | B·C밴드만 두고 A밴드에는 두지 않음 |

밴드는 레지스트리가 정한다. 연습 문항은 L01~L12가 A, L13~L24가 B, L25~L36이 C다.
검사 문항은 T1이 A, T2_v7이 B, T3이 C다.

한 항목이라도 검증을 통과하지 못하면 그 문항은 `cuesLoaded: false`가 되고
`registry.getCues()`가 `RegistryError('cues_missing')`을 던진다. **비어 있는 단서를
채점에 통과시키지 않는다.** 연구 세션에서는 단서가 없는 문항의 채점을 거부하고,
일반 체험(experience) 세션에서만 호출자가 공통 루브릭만으로 채점할지 판단한다.

## 3. 작성 절차

1. **실제 이미지를 열어 보고 쓴다.** 학습용 36문항의 단서는 실제 JPG를 열어 보고
   작성해야 하며, 제목만으로 재질·시간대·감정 단서를 만들지 않는다. 이미지에
   구현되지 않은 요구는 채점 기준에서 제외한다.
2. **이미지 제작 프롬프트를 정답으로 옮겨 적지 않는다.** 제작 프롬프트는
   `src/server/registry/practice-source-prompts.ts`에 서버 전용으로 있으며 정답
   문장이 아니다. 단서는 이미지에서 실제로 확인되는 것만 적는다.
3. **1차시(L01~L06) 필수 속성은 지도한 기본 색·형태로 한정한다.** 4분 도입에서
   가르치는 범위이므로 전문적인 질감·재질·치수를 필수 속성으로 넣지 않는다.
   질감·자세는 4차시(L19~L24), 시간대·분위기는 5차시(L25~L30)에서 다룬다.
4. **축을 겹치지 않게 나눈다.** 대상에 귀속되는 색·형태·크기·질감·자세는 구체성,
   장소·시간·동작·대상 간 공간 관계·분위기는 맥락으로 적는다. 같은 단서를 두 축에
   중복해서 적지 않는다.
5. **A밴드에는 맥락을 요구하지 않는다.** `requiredContext`를 빈 배열로 두고
   `anchors.context`를 만들지 않는다.
6. **앵커는 축별 수준의 경계 예시다.** 문장 전체의 정답이 아니라 그 축 한 수준의
   예시이며, 다른 축은 따로 판정한다. 기계적 문자열 매칭용 정답 목록이 아니다.
7. **candidate 상태를 스스로 승격하지 않는다.** 전문가 검토(단서의 관찰 가능성,
   수준 경계, 허용 표현, 모순 예를 따로 평정)와 예비 채점을 마치고 확정일·검토자·
   변경 이유·이미지 SHA-256·루브릭 버전을 기록한 뒤에야 `status`를 frozen으로 바꾼다.
   코드는 candidate를 자동으로 frozen으로 올리지 않는다.
8. **작성·수정 이력을 남긴다.** `cueVersion`을 올리고, 어떤 문항의 무엇을 왜 고쳤는지
   기록한다. 저장 문서에는 `cueVersion`이 함께 남으므로 버전을 바꾸면 이후 채점과
   이전 채점을 구분할 수 있다.

## 4. 점검

```
npm run manifest
```

`scripts/research-manifest.mjs`가 문항·자산·해시 상태를 담은 연구용 manifest를
만든다. 단서 본문은 넣지 않고 단서 객체의 SHA-256만 넣는다. 자산이 없으면
실패하지 않고 누락 항목을 `missing` 목록에 적어 둔다.

`registry.readiness()`가 막는 사유는 다음과 같다.

- `RESEARCH_ASSET_DIR` / `CONSENT_VERSION` / `IRB_APPROVAL` /
  `EVALUATION_MODEL_VERIFIED` 미설정
- 단서 팩을 열지 못했거나 검사 문항 단서가 비어 있음
- 검사 이미지 파일 없음 또는 SHA-256이 명세와 다름
- 검사 문항이 candidate 상태이고 `approvedAt`이 비어 있음

## 5. 유출 방지의 한계

이 디렉터리와 인증 스트리밍 경로(`/api/research/asset/[questionId]`)는 공개 경로
노출과 익명 요청을 막는다. 다만 허용된 검사 중 학생 화면에 표시된 이미지를
화면 캡처·재촬영·저장으로 복제하는 것까지 기술적으로 막지는 못한다. 검사 운영
절차(감독, 기기 관리)로 함께 다루어야 하며, 코드가 그것까지 방지했다고 보지 않는다.
