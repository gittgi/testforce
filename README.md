# Testforce

**Claude Code 안에서 분석하고 작은 패널로 검토·실행하는 Salesforce 테스트 도구**입니다. `/testforce`에 테스트 대상과 목적을 말하면 Skill이 계획을 작성하고, `/testforce-ui` 패널에서 **계획 → 테스트 → 마무리**로 진행합니다. 시나리오 제목을 눌러 설명을 보고, 승인한 뒤 **테스트 시작** 버튼으로 실행합니다. 기본 흐름에는 브라우저나 상시 HTTP 서버가 필요하지 않습니다.

AI는 시나리오·기대값의 초안을 작성합니다. 자동 비교와 AI 의견, 개발자의 최종 판정은 분리합니다. Apex 단위 테스트·배포 검증·커버리지를 대체하지 않으며 일치 결과가 업무 요구사항 전체의 정확성을 보증하지 않습니다.

Trigger DML, 공개 Service 호출, 실제 Batch 시작·관찰을 지원합니다. 넓은 표 편집, Excel 왕복, 수동 Import, 결과 불명 조정은 필요할 때 고급 브라우저 또는 CLI에서 엽니다. 화면이 작아져도 동일 엔진의 Org·계획·승인·소유권 검사는 유지합니다.

## 먼저 확인할 사항

- **Node.js 24 LTS**와 npm이 필요합니다. macOS에서 **Node 24.22.0**으로 빌드·실행·브라우저 검증을 했습니다.
- 오프라인 예제는 Salesforce 인증과 Claude Code 없이 실행할 수 있습니다. AI 분석은 로그인된 기존 Claude Code 세션을 사용합니다.
- 실제 연결에는 SF CLI와 **비운영 Org(Sandbox·Developer Edition·확인된 Scratch Org)**가 필요합니다. Production·유형 미확인 Org에서는 쓰기가 차단됩니다.
- Windows 네이티브 PowerShell 사용을 고려했지만 **실제 Windows에서는 실행하지 않았습니다**. WSL이나 실행 정책 변경을 요구하지 않습니다.
- 기본 화면은 Claude Code Mod입니다. Mod를 사용할 수 없으면 Skill+브라우저/CLI로 같은 엔진을 사용합니다. **현재 Testforce 패널의 공식 테스트·실제 화면 검증과 지원 버전은 [상태](docs/status.md)와 [호환성](docs/compatibility.md)을 확인하세요.**
- 초기 제품 검증은 Fake 모드에서 수행했습니다. 이후 사용자 요청으로 Developer Edition `lab-hub`에 별도 예제 Apex를 배포하고 배포 테스트 11개를 통과했습니다. 워크벤치를 통한 실제 데이터 시나리오 전체 검증과는 구분합니다.

전체 근거와 제한은 [호환성](docs/compatibility.md), [수용 기준](docs/acceptance-matrix.md), [검증 상태](docs/status.md)에 있습니다.

## 설치 후 바로 시작

GitHub의 비공개 저장소에 접근할 수 있는 계정으로 소스를 내려받고 실행합니다. 아래 도구 설치 경로는 원하는 폴더로 바꿀 수 있습니다. 한글·공백 경로는 항상 인용합니다. PowerShell이 `npm.ps1` 실행을 제한해도 정책을 바꾸지 않고 `npm.cmd`를 사용할 수 있습니다.

```powershell
git clone https://github.com/gittgi/testforce.git "C:\도구\testforce"
Set-Location "C:\도구\testforce"
node --version
npm.cmd ci
npm.cmd run build
node .\scripts\install-testforce.mjs

Set-Location "C:\업무\lab-hub"
claude
```

`C:\업무\lab-hub`는 실제 Salesforce 소스 폴더로 바꾸세요. 설치기는 개인 Claude 설정의 `skills/testforce`와 `skills/testforce-panel`에 Skill과 Mod를 등록합니다. 도구의 Node 24 실행 경로는 설치된 Mod 설정에 저장하며 업무 workspace와 Claude 권한 설정은 바꾸지 않습니다. 다른 소유자의 동명 설치는 덮어쓰지 않습니다. 이 설치기로 등록한 Testforce를 갱신할 때는 `node .\scripts\install-testforce.mjs --update`를 사용합니다.

새 Claude Code 세션에서 다음처럼 시작합니다. 소스·기대값·실행 방식은 자연어로 요청하면 되며 JSON을 직접 작성할 필요가 없습니다.

```text
/testforce lab-hub의 MyTrigger Insert와 Update를 테스트하고 싶어
/testforce-ui
```

Skill 호출 뒤 패널이 이미 열렸다면 두 번째 명령은 생략합니다. 보이지 않으면 `/testforce-ui`를 한 번 입력하세요. 분석이나 자연어 수정을 마친 뒤 패널의 **새로고침**으로 엔진의 최신 계획을 읽습니다. Skill은 기본적으로 `serve`를 실행하지 않습니다.

macOS/Linux는 `npm.cmd` 대신 `npm`을 사용합니다. 기존 설치를 갱신하거나 엔진 폴더를 옮기면 설치기를 다시 실행하고 Claude Code를 새로 시작하세요. 상세 설치·Plugin 대안은 [Claude 연결](docs/claude-plugin.md)에 있습니다.

## 작은 패널에서 하는 일

| 단계 | 확인하고 누를 항목 |
| --- | --- |
| **계획** | 시나리오 목록에서 **제목을 눌러 설명**을 엽니다. **선택 체크**는 별도이며, 실행할 목록과 대상·변경 범위를 검토한 뒤 승인합니다. |
| **테스트** | **테스트 시작**을 누르면 승인한 선택 묶음의 데이터 준비 → 도구 실행 → 실제값 수집을 진행합니다. 시나리오를 눌러 예상한 결과와 실제 차이를 확인합니다. |
| **마무리** | 개발자 판정을 저장하고 MD·Excel을 만듭니다. 데이터 보존 또는 현재 삭제 대상·충돌을 검토한 정리를 선택합니다. |

처음에는 짧은 목록과 현재 상태만 보입니다. 시나리오를 열면 무엇을 확인하는지, 어떤 조건·동작을 사용하는지, 기대 결과가 무엇인지 설명합니다. 코드 위치·실제 ID·스크립트·원시 값 같은 기술 정보는 상세를 펼쳐 확인합니다. 상세를 여는 것만으로 선택이 바뀌거나 테스트가 실행되지는 않습니다.

**테스트 시작은 지금 열어 본 한 시나리오가 아니라 승인한 선택 묶음을 실행합니다.** 사람 실행 항목은 입력·저장·Import를 대신하지 않고 대기로 남습니다. Batch 등 비동기 작업을 시작한 뒤에는 상태를 확인하고 필요한 완료 관찰을 별도로 진행합니다. 모든 결과가 즉시 확정된다고 가정하지 않습니다.

사람 실행만 선택한 경우에는 **사람 테스트 준비**가 표시됩니다. 이 버튼은 fixture와 실행 전 상태만 준비합니다. 실제 화면 입력·Import·Anonymous 실행과 완료 보고는 사람이 수행합니다.

완료된 테스트를 다시 하려면 **새 테스트**를 누릅니다. 이전 ID·증거를 보존하며 새 실행에서 계획을 검토·승인합니다. 자연어 분석·수정이 필요할 때만 `/testforce` 대화로 돌아가세요. 이미 계획이 준비된 테스트를 시작하기 위해 Claude에게 다시 실행을 부탁할 필요는 없습니다.

승인자 이름이나 날짜를 입력할 필요는 없습니다. 엔진이 실제 로컬 확인 동작과 시각을 기록합니다. 같은 계획·범위의 유효한 승인을 단계마다 다시 받지 않으며, 편집·Org/사용자 변경이나 별도 기존 데이터 변경·정리·복구·Job 취소에는 해당 범위의 승인이 필요합니다. AI가 패널 버튼이나 터미널 승인을 대신 누르지는 않습니다.

## 오프라인 예제와 고급 브라우저

실제 Org 없이 확인하려면 별도 작업 폴더에서 명시적 Fake 예제를 엽니다. 고급 브라우저가 필요할 때만 `serve`를 시작합니다.

```powershell
$workbenchRoot = "C:\도구\testforce"
$sfWorkspace = "C:\테스트 작업공간"
$workbenchCli = Join-Path $workbenchRoot "dist\cli\main.js"
node $workbenchCli --workspace $sfWorkspace init --mode fake --target offline
node $workbenchCli --workspace $sfWorkspace demo
node $workbenchCli --workspace $sfWorkspace serve
```

빌드된 UI와 API는 loopback에만 열립니다. 다음에 브라우저를 다시 열 때는 같은 workspace로 `open`을 실행합니다. 서버 종료는 Ctrl+C이며 이미 시작한 Salesforce Job을 취소하지 않습니다. Fake 예제 소스·데이터는 `.workbench` 안에만 저장하고 실제 Org에 배포하지 않습니다.

기본 예제와 별개로 범용 오프라인 스키마·기준 레코드·Job·제약 fixture를 지정할 수 있습니다. `schema --kind fixture`로 계약을 보고, workspace 안에 둔 파일을 `init --mode fake --fixture "가상 fixture.json"`으로 설치합니다. 실행마다 fixture 사본을 고정하며 임의 Apex 로직을 자동 에뮬레이션하지 않습니다. 구체적인 입력과 명령은 [오프라인 fixture 안내](docs/offline-fixtures.md)에 있습니다.

## 빌드된 ZIP과 소스 폴더의 차이

소스에서 `npm run package:local`을 실행하면 `artifacts/salesforce-sandbox-workbench-0.1.0.zip`을 만듭니다. 먼저 `npm run build`를 수행해야 합니다. `npm run verify:package`로 ZIP을 새 임시 폴더에 설치하고 오프라인 CLI·UI·API를 검사할 수 있습니다. 이 ZIP에는 빌드된 엔진/UI, Plugin, 문서, lockfile이 있고 **node_modules, 개발용 src/tests, 회사 소스, 실행 데이터, 인증 파일은 없습니다**.

빌드된 ZIP을 푼 폴더에서는 개발 도구 없이 런타임 의존성만 설치합니다. 다시 빌드하는 명령을 실행하지 않습니다.

```powershell
Set-Location "C:\도구\salesforce-sandbox-workbench"
npm.cmd ci --omit=dev
node .\scripts\install-testforce.mjs
```

의존성 최초 설치에는 npm 다운로드가 필요합니다. 설치 후 Fake UI·파일·비교·보고서는 네트워크 없이 작동합니다. 실제 Salesforce 및 Claude Code AI 분석은 각 서비스 연결이 필요합니다. 의존성을 포함한 완전 오프라인 설치 패키지는 아닙니다. 별도 한글/공백 임시 폴더에 빌드 산출물을 복사하고 `npm ci --omit=dev`만 수행한 뒤 help/init/demo/UI/API 실행을 실제 확인했습니다.

## Skill과 Plugin의 역할

`/testforce`는 기존 Claude Code 세션에서 코드 분석·시나리오 추천·입력과 기대값 초안·자연어 수정을 담당합니다. `/testforce-ui`는 같은 엔진을 호출하는 사용자 패널입니다. Skill의 `disable-model-invocation: true`는 모델의 임의 자동 호출을 막습니다. Skill은 승인 대화·Mod 동작 토큰을 대신 사용하거나 SF CLI/MCP로 직접 쓰지 않습니다.

개인 설치 대신 소스 Plugin을 로드할 수도 있습니다. `node scripts/configure-mod.mjs`로 현재 Node 24·엔진 위치를 구성한 뒤 Claude를 시작합니다. 이 경로의 Skill 이름은 `/sandbox-workbench:testforce`입니다.

```powershell
Set-Location "C:\도구\testforce"
node .\scripts\configure-mod.mjs
$workbenchRoot = (Get-Location).Path
Set-Location "C:\업무\lab-hub"
claude --plugin-dir "$workbenchRoot\plugin" --plugin-dir "$workbenchRoot\plugin\mod"
```

## Sandbox 인증과 실제 프로젝트 선택

조직에서 허용한 SF CLI 로그인 방식을 사용합니다. 아래 명령의 `--alias`, `--instance-url`은 설치된 `sf org login web --help`에서 확인한 옵션입니다. 본인의 실제 Sandbox My Domain을 넣으세요. 비밀번호·토큰을 코드나 계획 파일에 넣지 않습니다.

```powershell
sf.cmd org login web --alias my-sandbox --instance-url "https://MyDomain--Sandbox.sandbox.my.salesforce.com"
node $workbenchCli --workspace $sfWorkspace init --mode live --target my-sandbox
node $workbenchCli --workspace $sfWorkspace new --mode live --target my-sandbox
```

`init`은 workspace 설정이고 `new`가 실행 ID를 발급합니다. 엔진은 기본 Org 설정을 변경하지 않으며 매 호출에 대상을 명시합니다. 별칭 이름이나 URL 모양만으로 Sandbox를 판단하지 않습니다. 실제 Org ID·사용자·IsSandbox·OrganizationType 및 필요한 Scratch Org 증거를 읽고 승인 내용과 맞는지 확인합니다. `doctor`는 도구/경로 점검이며 Org 통합 테스트 통과를 뜻하지 않습니다.

실제 프로젝트에는 `sfdx-project.json`과 대상 `.cls`/`.trigger`가 필요합니다. 여러 packageDirectory를 읽습니다. workspace 밖 소스나 심볼릭 링크로 경계를 우회할 수 없습니다. 소스가 없는 임의 클래스·필드·메서드를 만들어 계획에 쓰지 않습니다.

## 분석부터 결과까지

1. **대상 선택:** 클래스/트리거, `Class.method(Type)`, 기능 설명, Git 커밋/범위, diff 경로·본문을 입력합니다. 후보가 여러 개면 경로와 오버로드 시그니처를 선택합니다. 커밋 입력도 현재 로컬 코드를 분석하며 자동 checkout/reset/배포를 하지 않습니다.
2. **Claude 분석:** 엔진이 요청 ID·소스 해시가 연결된 컨텍스트를 만듭니다. Skill이 시나리오·준비·동작·기대값을 구조화해 제출합니다. 패널을 새로고침해 실제 제출된 계획을 확인합니다. 응답 전에는 분석 완료로 표시하지 않습니다.
3. **검토:** 시나리오 제목을 눌러 목적·방법·기대 결과를 읽고 별도의 체크로 실행 대상을 선택합니다. 시나리오 추가·입력·실행 경로 변경은 자연어로 요청합니다. Fixture와 Action을 구분합니다. Insert Trigger의 Insert는 Action이고 Update 변경값은 `fieldOverrides`로 준비값과 분리합니다.
4. **승인:** 시나리오 설명과 필요한 기술 상세에서 실제 Org/사용자·배포본 정합성·입력·기대값·스크립트·변경 범위를 확인하고 **계획 확인** 체크 후 **승인**을 누릅니다. 준비와 도구 실행까지 허용하며 승인자 이름이나 날짜를 입력하지 않습니다. 준비까지만 승인하거나 기존 데이터 예외를 검토할 때는 고급 브라우저/CLI를 사용합니다. 승인한 계획과 범위가 그대로면 준비·실행 단계에서 다시 승인하지 않습니다. 계획을 변경하면 새 버전과 재승인이 필요합니다.
5. **테스트 시작:** 패널 버튼으로 승인한 선택 묶음을 실행합니다. 엔진이 fixture를 준비·재조회하고 전제조건을 확인한 뒤 도구 실행 항목만 DML/Service/Batch로 실행하고 실제값을 수집합니다. 사람 실행·비동기 미완료·오류·부분 실패·결과 불명은 각 상태로 남습니다.
6. **비교와 검토:** 테스트 목록에서 시나리오를 눌러 차이를 확인하고, 넓은 비교표가 필요하면 고급 브라우저를 엽니다. 표시 상태는 일치/불일치/확인 불가/미실행입니다. AI 가설을 별도로 읽고 개발자가 최종 판정합니다. 원시 JSON은 기본 사용 흐름에 필요하지 않습니다.
7. **출력과 데이터 처리:** MD/Excel을 생성한 뒤 보존 또는 정리를 선택합니다. 선택하지 않으면 데이터는 남고 대기 상태입니다. 정리는 정확한 생성 ID·현재 상태·관계·충돌을 재확인합니다.

고급 CLI의 실제 예입니다. `<실행ID>` 등은 엔진이 발급한 값으로 바꿉니다. 초안 파일은 Skill이 작성합니다.

```powershell
node $workbenchCli --workspace $sfWorkspace context --run "<실행ID>" --selection "MyService.calculate(String)"
node $workbenchCli --workspace $sfWorkspace schema --kind draft
node $workbenchCli --workspace $sfWorkspace submit --run "<실행ID>" --file ".workbench\draft.json"
node $workbenchCli --workspace $sfWorkspace plan --run "<실행ID>"
node $workbenchCli --workspace $sfWorkspace approve --run "<실행ID>" --version 1 --hash "<검토한해시>" --scope execute
node $workbenchCli --workspace $sfWorkspace prepare --run "<실행ID>" --version 1
node $workbenchCli --workspace $sfWorkspace execute --run "<실행ID>" --version 1
node $workbenchCli --workspace $sfWorkspace collect --run "<실행ID>" --version 1
node $workbenchCli --workspace $sfWorkspace reports --run "<실행ID>"
```

CLI 승인은 실제 터미널에서 표시 범위를 검토한 뒤 **승인**을 한 번 입력하면 됩니다. 검토자 이름이나 날짜는 묻지 않습니다. 브라우저·터미널에서 확인했다는 사실과 시각은 엔진이 자동 기록하며, 이 기록을 실제 Salesforce 실행자 신원으로 간주하지 않습니다. 파이프·일괄 자동승인 옵션은 없습니다. 전체 명령과 옵션은 `node $workbenchCli --help`, `node $workbenchCli <명령> --help`에서 확인하세요. 세부 payload는 JSON Schema와 Skill 단계별 참조에 있습니다.

추가 Describe·관련 규칙이 필요하면 `context ... --objects Object__c Other__c`를 사용할 수 있습니다. 아직 생성되지 않은 레코드 ID를 기대값에서 참조할 때는 `{"$recordId":"논리키"}`를 사용하며, 승인한 규칙에 따라 실제 ID로 바인딩됩니다. AI가 임의 ID를 만들어 넣지 않습니다.

## 사람 실행, Excel, Import

**사람 실행:** 시나리오를 화면/Import/Anonymous 경로로 선택합니다. 준비 후 **수동 실행 안내 생성**으로 실제 입력과 스크립트 파일·해시·순서를 받습니다. 화면 메시지는 수동 관찰로, DB 결과는 실제 재조회로 구분합니다. 완료 보고에는 실제 Salesforce 실행 사용자·경로·ID를 기록합니다. 이는 승인자 이름 입력과 별개이며 다른 사용자가 실행했다면 그 사용자를 명시합니다. 실제 실행 시각을 모르면 생략하며 보고 시각으로 대신하지 않습니다. 보고 버튼만 누른다고 저장 성공을 확정하지 않습니다.

사람 실행의 상세 입력·Excel·Import·결과 불명 조정은 고급 브라우저 또는 CLI에서 처리합니다. Service/Batch의 기존 ApexLog가 있으면 승인한 상관 ID·사용자·시각을 검증해 반환값/Job을 읽을 수 있습니다. 로그를 만들기 위해 TraceFlag를 변경하거나 실행을 반복하지 않습니다. [수동 실행 증거 안내](docs/manual-evidence.md)를 따르세요.

**Excel 편집:** 계획 Excel 내보내기 → 값/행/기대값 편집 → Excel 재불러오기 → 변경점과 빈칸 처리 선택 → 새 계획 저장 → 재승인 순서입니다. 기존 논리키를 유지하고 복제한 새 행의 키는 비우세요. 관계·동작 참조도 맞춰야 합니다. 기존 빈칸의 null/생략/빈 문자열은 보존하며, 값이 있던 셀을 비운 경우 유지/생략/지우기/빈 문자열을 명시적으로 선택합니다. ID·날짜·정밀한 소수는 텍스트로 편집하세요. 수식·매크로·외부 링크·가짜 승인/ID는 거부합니다.

```powershell
node $workbenchCli --workspace $sfWorkspace excel-export --run "<실행ID>"
node $workbenchCli --workspace $sfWorkspace excel-import --run "<실행ID>" --version 1 --file "edited-plan.xlsx"
```

Excel 파일은 workspace 안에 둡니다. 이어지는 변경 적용·빈칸 선택은 브라우저에서 처리할 수 있습니다. `excel-apply`의 구조화 선택 파일은 Skill이 작성할 수도 있습니다.

**수동 Import:** 계획 Excel을 Salesforce에 업로드하지 않습니다. 승인 후 생성한 **Data Loader SOAP 전용 CSV**를 사용합니다. 준비 파일과 동작 파일을 구분하고 부모 업로드 → 성공/실패 결과 연결·재조회 → 자식 파일 생성을 지킵니다. 파일마다 null 설정이 다를 수 있으므로 생성된 README를 따르세요. Bulk API/2.0은 이 파일 생성기의 지원 모드가 아닙니다.

```powershell
node $workbenchCli --workspace $sfWorkspace import-generate --run "<실행ID>" --phase fixture --scenario "<시나리오ID>"
node $workbenchCli --workspace $sfWorkspace import-results --run "<실행ID>" --bundle "<묶음ID>" --file "success.csv"
node $workbenchCli --workspace $sfWorkspace import-generate --run "<실행ID>" --phase action --scenario "<시나리오ID>"
```

성공/실패 행 순서나 Name만으로 ID를 추측하지 않습니다. 불명확한 대응은 UI에서 명시적으로 연결합니다. 성공 CSV와 실제값 일치만으로 생성 소유권을 인정하지 않습니다. 사용자의 생성 사실 확인과 Org의 CreatedDate/CreatedById 확인 전에는 불명 소유 상태로 남고 자동 정리에서 제외됩니다.

원본 `.csv`는 업로드 전용이고 `.review.csv`는 수식 주입을 방지한 검토용입니다. 검토 파일을 업로드하지 마세요. Data Loader가 빈 문자열 의미를 보존할 수 없는 입력은 차단하고 도구/UI 경로를 안내합니다. 자세한 계약은 [Excel·Import](docs/excel-import-contract.md)에 있습니다.

## 중단·재개·재실행과 정리

```powershell
node $workbenchCli --workspace $sfWorkspace status --run "<실행ID>"
node $workbenchCli --workspace $sfWorkspace pause --run "<실행ID>"
node $workbenchCli --workspace $sfWorkspace resume --run "<실행ID>"
node $workbenchCli --workspace $sfWorkspace observe --run "<실행ID>"
node $workbenchCli --workspace $sfWorkspace rerun --run "<실행ID>"
node $workbenchCli --workspace $sfWorkspace keep --run "<실행ID>"
node $workbenchCli --workspace $sfWorkspace cleanup-preview --run "<실행ID>"
```

같은 run의 resume는 중단된 상태에서 이어갑니다. rerun은 원본 결과를 유지하고 새 run_id·재승인으로 시작합니다. UNKNOWN은 요청이 전달됐으나 결과를 모를 수 있으므로 Insert·Service·Batch를 자동 반복하지 않습니다. 실제 ID/Job/조회 증거를 확인한 뒤 브라우저의 조정 또는 `reconcile`로 처리합니다.

패널 중단·재개는 **계획/테스트 → 단계별 실행·기타**, 이전 실행은 **마무리 → 메모·실행 기록·상세 도구**에서 찾습니다. 좁은 화면은 상단 **ⓘ**를 열면 단계별 도구가 보입니다. 중단·재개는 요청 사이에 사용합니다. **테스트 시작**의 준비·실행·수집 요청을 처리하는 동안 버튼은 대기 상태이며, 이미 전송한 요청이나 Salesforce Job을 중간 취소하지 않습니다. Mod 요청의 최대 대기는 10분입니다. 응답을 놓치면 상태를 새로고침해 확인하고 쓰기를 자동 반복하지 않습니다.

정리 미리보기에서 현재 삭제 대상을 확인한 뒤 체크하고 정리를 선택합니다. 이름·날짜 입력은 없으며 현재 대상 해시에 승인이 연결됩니다. CLI에서는 `cleanup-approve` 후 `cleanup`을 실행합니다. 다른 사용자의 변경, 새 관계, 진행 중 Job, 불명 쓰기가 있으면 충돌을 해결해야 합니다. 기존 데이터의 승인 필드 복구는 `restore-preview` → `restore-approve` → `restore`, 확인된 Job 취소는 `cancel-preview` → `cancel-approve` → `cancel-job`의 별도 사용자 검토 경로입니다. Job/키 등의 구조화 인자는 브라우저 또는 Skill이 작성한 `--file`로 전달합니다.

서버/브라우저 종료는 이미 시작된 Salesforce Job을 취소하지 않습니다. 데이터 삭제는 완전한 롤백이 아니며 이미 전달된 통지·외부 영향까지 되돌리지 않습니다.

## 결과 파일

`<workspace>/.workbench/runs/<run_id>/`에 저장합니다.

| 파일 | 내용 |
| --- | --- |
| `test-plan.xlsx` | 검토·편집용 계획과 입력·기대값 |
| `test-results.xlsx` | 승인 입력, 실행 직전/후 재조회, 비교·ID·작업·정리·AI/판정 |
| `test-report.md` | 사실 중심 한국어 시나리오 보고서, 검토 대기와 남은 데이터 |
| `plan.json`, `state.json`, `record-mapping.json`, `operations.json` | 버전·재개·ID·전송 상태 |
| `evidence/`, `evidence-index.jsonl` | 원본 구조화 관찰·작업 증거 |
| `import/<bundle_id>/` | 업로드·검토 CSV, 수동 스크립트, 매핑 manifest, 안내 |

`.workbench`는 Git 제외 대상입니다. 파일에는 업무 테스트 데이터가 들어갈 수 있으므로 조직 정책에 맞게 보관하세요. 메타데이터·권한·규칙·공유·TraceFlag는 자동 변경하지 않습니다. 로컬 승인과 잠금은 실수 방지 장치이며 Salesforce 권한이나 Org 전체 잠금을 대신하지 않습니다.

## 테스트와 문제 해결

소스 폴더에서 실행합니다. Playwright 브라우저 설치에는 최초 다운로드가 필요합니다.

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd exec playwright install chromium
npm.cmd run test:e2e
npm.cmd audit
```

단위/통합 테스트는 서로 다른 가상 스키마·소스와 Fake/가공 REST 응답을 사용합니다. 실제 Chromium E2E는 승인·실행·결과·정리·Excel 편집 왕복·수동 Import·후보 선택·보안 요청을 검증했습니다. [수용 기준](docs/acceptance-matrix.md)에 각 요구와 테스트가 연결되어 있습니다.

| 오류/상황 | 처리 |
| --- | --- |
| `NON_PRODUCTION_REQUIRED`, `ORG_CHANGED` | 실제 비운영 Org 유형과 인증 사용자를 확인하고 새 계획/승인을 사용합니다. 별칭 이름만 바꿔 우회하지 않습니다. |
| `DEPLOYED_SOURCE_MISMATCH`, `SOURCE_CHANGED` | 개발자가 배포·정합성을 해결한 뒤 다시 분석/검토합니다. 도구가 자동 배포하지 않습니다. |
| `VERSION_CONFLICT`, `STALE_ANALYSIS` | 최신 계획/요청 ID를 읽고 변경을 다시 적용합니다. |
| `APPROVAL_REQUIRED`, `EXISTING_APPROVAL` | 브라우저나 실제 터미널에서 해당 계획·변경 범위를 직접 승인합니다. |
| `REVIEW_REQUIRED` | 해당 범위를 검토한 뒤 **확인했습니다**를 체크합니다. 승인자 이름·날짜 입력은 필요하지 않습니다. |
| `UNKNOWN_WRITE` | 실제 데이터/Job을 확인하고 조정합니다. 같은 쓰기를 반복하지 않습니다. |
| `IMPORT_VERIFY`, `CREATION_EVIDENCE` | 실제값·ID·생성 사용자/시각을 검토합니다. 불명 ID는 자동 정리하지 않습니다. |
| `CLEANUP_CONFLICT`, `RESTORE_CONFLICT` | 현재 데이터·관계·타인 변경을 검토하고 새로운 미리보기로 재승인합니다. |
| `RUN_BUSY` | 진행 중 작업을 확인합니다. 작업 중 lock 파일을 지우지 않습니다. |
| `EPERM`/`EBUSY`, Excel 저장 실패 | 해당 파일을 연 앱을 닫고 재시도합니다. 실제 Windows 잠금 검증은 별도입니다. |
| 브라우저 인증 만료/서버 재시작 | 같은 workspace로 서버를 시작하고 `open`을 사용합니다. 토큰을 대화나 보고서에 붙이지 않습니다. |
| Mod 미지원/rollout 차단 | 핵심 Plugin만 로드하고 Skill+브라우저를 사용합니다. 회사 정책이나 권한을 완화하지 않습니다. |
| `FAKE_SCHEMA`, `FAKE_APEX_NOT_CONFIGURED` | 기본 예제 밖의 임의 업무를 Fake가 자동 시뮬레이션하지 않습니다. `init --mode fake --fixture`로 명시적 스키마·데이터를 설정하거나, 실제 로직 실행에는 승인된 Sandbox 연결을 사용합니다. |

추가 설계·정책: [요구사항](docs/requirements.md), [아키텍처](docs/architecture.md), [결정 기록](docs/decisions.md), [보안](docs/security.md), [SF 연결 계약](docs/salesforce-contracts.md).
