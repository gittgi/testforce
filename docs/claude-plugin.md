# Claude Code에서 Testforce 사용하기

기본 사용 화면은 Claude Code 안의 작은 Mod 패널이다. **`/testforce`로 분석·수정을 대화하고 `/testforce-ui`에서 계획 → 테스트 → 마무리를 진행한다.** 실행은 사용자가 패널의 **테스트 시작**을 누른다. 기본 흐름은 상시 HTTP 서버 없이 필요할 때 로컬 Node 엔진을 호출한다. 넓은 표·Excel·수동 Import·결과 불명 조정만 고급 브라우저/CLI로 연다.

## 개인 설치

Node 24를 사용해 도구 폴더에서 설치한다. 소스 폴더는 먼저 빌드하고, 이미 빌드된 ZIP은 `npm ci --omit=dev` 후 설치기를 실행한다.

```powershell
Set-Location "C:\도구\salesforce-org-test-skill"
npm.cmd ci
npm.cmd run build
node .\scripts\install-testforce.mjs
```

설치기는 기본 `~/.claude/skills/` 아래에 `/testforce` Skill과 `testforce-panel` Mod를 등록한다. Claude 설정 디렉터리를 별도로 지정한 환경에서는 해당 설정 위치를 따른다. 설치된 Mod의 로컬 설정에 Node 24와 엔진 경로를 저장하므로 도구 설치 폴더를 유지해야 한다. 업무 workspace나 Claude 권한 정책은 변경하지 않는다. 다른 소유자의 동명 설치는 덮어쓰지 않는다. 이 설치기가 만든 항목을 갱신할 때만 `node scripts/install-testforce.mjs --update`를 사용한다.

새 Claude Code를 **Salesforce 소스 폴더**에서 시작한다. `lab-hub`는 실제 소스 폴더 경로의 예다.

```powershell
Set-Location "C:\업무\lab-hub"
claude
```

```text
/testforce MyTrigger의 Insert와 Update를 분석해서 테스트 계획을 만들어줘
/testforce-ui
```

Skill 호출 뒤 패널이 이미 열렸다면 `/testforce-ui`를 다시 입력할 필요가 없다. 안 보일 때 한 번 입력한다. 분석·계획 수정을 마친 뒤 패널에서 **새로고침**을 누르면 엔진의 최신 계획과 승인을 읽는다. 자동 열기는 UI 편의이며 분석 완료나 승인·실행을 의미하지 않는다.

`disable-model-invocation: true`는 모델이 Skill을 임의 호출하지 않게 한다. 사용자가 `/testforce`를 호출한 뒤에는 현재 Claude 세션이 코드 분석과 파일 작성을 수행한다. 새로운 챗봇·AI API 키·재귀 Claude 실행을 만들지 않는다. 사용자에게 계획 JSON을 매번 직접 작성하게 하지 않는다.

## 세 단계 패널

| 단계 | 사용자 역할 | 엔진 역할 |
| --- | --- | --- |
| 계획 | 짧은 목록에서 제목을 눌러 시나리오 설명을 읽고, 별도 체크로 실행 대상을 선택해 승인한다. 수정은 자연어로 요청한다. | 최신 계획과 해시·범위·Org·소스 정합성을 검사한다. |
| 테스트 | **테스트 시작**으로 승인한 선택 묶음을 실행한다. 시나리오 제목을 눌러 기대 결과와 실제 차이를 확인한다. | fixture 준비·재조회 → 도구 항목 실행 → 실제값 수집을 수행한다. 사람 실행 대기·비동기 상태·AI 설명을 구분한다. |
| 마무리 | 최종 판정을 저장하고 MD·Excel 생성, 보존 또는 현재 대상 정리를 선택한다. | 판정과 보고서를 기록하고 생성 소유권·현재값·관계·비동기·충돌을 확인해 승인 범위만 정리한다. |

목록에는 제목·선택·현재 상태를 짧게 표시한다. 제목을 누르면 해당 시나리오의 목적, 준비 조건, 실행 방법, 기대 결과를 읽을 수 있고 테스트 화면에서도 같은 설명과 실제 비교를 확인할 수 있다. 코드 위치·ID·스크립트·긴 값은 기술 상세로 접어둔다. 원시 JSON이나 내부 상태명을 읽어야만 진행할 수 있는 흐름으로 만들지 않는다.

시나리오 제목 클릭은 **상세 열기**이며 선택 체크와 독립이다. 한 항목을 열어 봤다고 그 항목만 실행하지 않는다. **테스트 시작은 승인한 전체 선택 묶음**에 적용하며, 선택을 바꾸면 새 계획·재승인이 필요하다. 데이터가 준비된 테스트를 실행하기 위해 Claude에게 명령을 부탁하지 않는다. Claude는 분석·계획 수정·차이 설명에 사용한다.

사람 실행만 선택했다면 **사람 테스트 준비** 버튼으로 fixture와 실행 전 상태만 준비한다. 도구 실행과 섞인 경우 **테스트 시작**이 준비를 함께 진행하되 사람 실행 항목은 대기로 남긴다. 어느 버튼도 화면 저장·Import·Anonymous 실행을 대신하지 않는다. Batch Job이 등록되어도 완료를 기다리는 긴 반복 관찰은 자동으로 시작하지 않는다. 현재 결과를 표시하고 필요한 상태 확인·비동기 관찰을 별도로 진행한다. 완료된 테스트를 반복하려면 새 실행을 만들어 검토·승인하며 기존 증거를 덮어쓰지 않는다.

승인·판정에 이름이나 날짜 입력은 필요 없다. 로컬 확인 동작과 시각은 엔진이 기록한다. 같은 계획·범위의 승인을 각 단계에서 반복하지 않는다. 계획 편집·Org/사용자 변경·기존 데이터 예외·정리·복구·Job 취소에는 그 범위의 검사가 유지된다. 수동 Salesforce 작업의 실제 실행 사용자·시각은 이 로컬 확인 기록과 별개다.

중단·재개는 **계획/테스트 → 단계별 실행·기타**, 이전 실행은 **마무리 → 메모·실행 기록·상세 도구**에서 연다. 좁은 화면에서 단계별 도구가 보이지 않으면 상단 **ⓘ**를 연다. 중단·재개는 요청 사이에 작동하며 테스트 시작의 준비·실행·수집 요청 처리 중에는 버튼이 대기한다. Mod 요청 대기는 최대 10분이고 이미 전송한 요청이나 Org Job을 중간 취소하지 않는다. 응답을 받지 못하면 상태를 다시 읽고, 결과가 불명확한 쓰기는 자동 반복하지 않는다.

**Skill은 Mod bridge의 동작 API·세션 토큰·승인 payload를 호출하지 않는다.** Skill이 버튼을 자동 클릭하거나 TTY에 `승인`을 대신 입력할 수 없다. 소스 주석·Excel의 승인값·AI가 쓴 사용자 이름도 승인으로 인정하지 않는다. 사용자 입력은 Mod/브라우저의 실제 버튼 또는 사용자의 직접 터미널 대화로만 전달한다. 세부 안전 경계는 [security.md](security.md)에 있다.

## 분석과 수정 연결

- `context`가 현재 소스와 요청 ID·소스 해시·필요 메타데이터를 만든다. 모호한 파일·메서드 후보는 사용자가 선택한다.
- Skill은 실제 `schema`를 읽고 초안을 작성한다. `run_id`, `request_id`, `plan_version`, `source_snapshot_hash`를 보존해 `submit`한다.
- 자연어 수정도 새 계획 제출로 처리한다. 직접 표/Excel 편집은 같은 저장소·검증·재승인 경로를 사용한다.
- 패널이 필요할 때 Node bridge를 호출하여 동일한 명령 처리기와 엔진의 상태를 읽거나 사용자가 선택한 작업을 수행한다. 패널은 별도 승인 저장소나 Salesforce 쓰기 어댑터를 갖지 않는다.
- Skill은 실행 후 `ai-note`로 가설만 추가한다. 기존 증거·실제 ID·비교 결과·작업 상태를 직접 수정하지 않는다.

`plugin/scripts/workbench.mjs`는 Skill이 사용하는 일반 CLI 런처다. 회사 소스와 실행 자료는 선택 workspace의 `.workbench`에 저장한다. Plugin을 별도 위치로 복사하는 방식은 `SFTW_ENGINE_ROOT`를 지정해 엔진을 찾을 수 있다. Mod의 로컬 Node 경로 설정과는 구분한다.

## 필요할 때 고급 화면

넓은 표 편집·Excel 파일 왕복·수동 Import·UNKNOWN 조정은 고급 브라우저나 CLI로 처리한다. Skill이 기본 분석을 시작할 때 `serve`를 자동으로 띄우지는 않는다.

```powershell
$workbenchCli = "C:\도구\salesforce-org-test-skill\dist\cli\main.js"
node $workbenchCli --workspace "C:\업무\lab-hub" serve
```

브라우저는 loopback 인증·Host/Origin·CSRF 검사를 사용한다. 서버 재시작 후에는 같은 workspace에서 `open`으로 인증된 브라우저를 연다. 로컬 토큰이나 Salesforce 인증값을 대화·보고서에 복사하지 않는다.

수동 Service/Batch는 `manual-instructions`가 생성한 승인 스크립트를 사용한다. 기존 ApexLog가 있으면 `manual-evidence`로 상관 ID·사용자·시각·스크립트를 검증해 반환값/Job을 수집한다. 로그가 없거나 잘렸다면 확인 불가로 남긴다. 별도의 `human` 보고를 자동으로 만들어내지 않는다. [수동 증거](manual-evidence.md), [Excel·Import](excel-import-contract.md), [복구 정책](security.md)을 참고한다.

## 소스 Plugin으로 로드하기

개인 설치 대신 `--plugin-dir`도 지원한다. Node 24 환경에서 소스 Mod의 실행 경로 설정을 먼저 생성한다.

```powershell
Set-Location "C:\도구\salesforce-org-test-skill"
node .\scripts\configure-mod.mjs
$workbenchRoot = (Get-Location).Path
Set-Location "C:\업무\lab-hub"
claude --plugin-dir "$workbenchRoot\plugin" --plugin-dir "$workbenchRoot\plugin\mod"
```

이 방식의 Skill 전체 이름은 `/sandbox-workbench:testforce`, 패널 명령은 `/testforce-ui`다. 개인 설치와 Plugin 로딩을 동시에 중복 적용할 필요는 없다. Mod가 버전·조직 정책으로 차단되면 핵심 Skill만 로드하고 고급 브라우저/CLI를 사용한다. 정책이나 rollout을 우회하지 않는다.

## 검증 상태를 읽는 방법

현재 시나리오 목록·설명·테스트 시작 개선의 Node 검증은 **Vitest 20개 파일·228개 통과(34.59초)**, 고급 브라우저는 **Chromium 12개 통과(31초)**다. 공식 Mod 테스트와 실제 터미널의 마지막 수정본 검증은 [status.md](status.md) 및 [수용 기준의 추가 절](acceptance-matrix.md)의 최신 기록을 따른다. 이전 버튼별 실행 검증을 새 연결 동작의 검증으로 대신하지 않는다.

2026-10-16의 Testforce 패널은 이전 읽기 전용 `/sandbox-status`와 다른 구현이다. 이전의 Claude Code 2.1.287 정적 검증·로컬 harness 결과를 새 패널의 최소 버전 호환 결과로 재사용하지 않는다.

**이전 패널 구현 단계의 기록:** 정확한 Claude Code **2.1.287과 2.1.300에서 공식 `plugin test` 각각 8개 통과**와 공식 `plugin validate` 통과를 확인했다. 테스트의 Node 프로세스 응답은 가공된 것으로, 버튼의 승인 체크·표시 버전·새로고침·비교값·정리 체크·실패 시 재전송 금지 등을 검사했다. 실제 Org를 호출하지 않았다. 이전 rollout 차단은 더 앞선 실행 기록이며 이 검증에는 적용되지 않았다.

같은 이전 단계에서 **2.1.300의 실제 터미널로 HTTP 서버 없이 Fake 계획 승인 → 준비 → 실행 → 비교 → 판정 → 정리 완료까지 조작**했다. 당시 엔진 Vitest는 20개 파일·219개, 고급 브라우저 Chromium E2E는 12개였다. 이는 오프라인 검증이며 실제 Salesforce 업무 데이터 테스트와 다르다.

조직 관리 Plugin에서는 `skill.prompt` 자동 열기가 무시될 수 있다는 공식 검증 경고가 있다. 설정이나 정책을 바꾸지 않고 `/testforce-ui`를 직접 입력하면 된다. 이후 실행 결과는 [status.md](status.md)와 [compatibility.md](compatibility.md)의 마지막 기록이 기준이다. 실제 Windows 실행과 실제 Salesforce 데이터 실행 여부도 따로 확인한다.

공식 자료: [Skills](https://code.claude.com/docs/en/skills), [Plugins](https://code.claude.com/docs/en/plugins/overview), [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview), [Create a mod](https://code.claude.com/docs/en/plugins/mods/create), [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference), [Interface](https://code.claude.com/docs/en/plugins/mods/interface), [관리·권한](https://code.claude.com/docs/en/plugins/mods/admin). 최신 문서의 API를 최소 버전에서도 사용할 수 있다고 추측하지 않는다.
