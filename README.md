# Testforce

Claude Code에서 Salesforce 테스트를 분석하고, 작은 Mod 패널에서 계획을 검토·실행하는 도구입니다. 넓은 표·Excel·수동 Import가 필요하면 브라우저 UI도 사용할 수 있습니다.

**이 저장소는 일반 사용자 설치용입니다.** 빌드된 실행 엔진·브라우저 UI·Claude Code Skill·Mod와 설치 파일만 제공합니다. Playwright·Vitest·Vite·TypeScript 등 개발 도구나 자동화 테스트는 포함하지 않습니다. `npm ci`로도 Playwright가 설치되지 않으며 별도의 빌드 명령이 필요 없습니다.

## 필요한 것

- **Node.js 24 LTS**와 npm.
- AI 분석에는 로그인된 Claude Code. Mod 최소 목표 버전은 **2.1.287**이며 2.1.300에서도 검증했습니다. 조직 정책으로 Mod를 사용할 수 없으면 Skill과 브라우저/CLI를 사용합니다.
- 실제 Salesforce 테스트에는 **SF CLI**, 인증된 **Sandbox·Developer Edition·확인된 Scratch Org**, 해당 Org의 로컬 Salesforce 소스 프로젝트.
- 실제 테스트할 업무 코드와 인증 정보는 이 저장소에 포함하지 않습니다.

## 설치

Windows PowerShell:

```powershell
git clone https://github.com/gittgi/testforce.git
Set-Location testforce
node --version
npm.cmd ci
node .\scripts\install-testforce.mjs
```

macOS / Linux:

```bash
git clone https://github.com/gittgi/testforce.git
cd testforce
node --version
npm ci
node scripts/install-testforce.mjs
```

`node --version`이 24 계열인지 확인하세요. 최초 설치에는 npm 다운로드 또는 캐시가 필요합니다. 설치기는 개인 Claude 설정에 `/testforce` Skill과 `/testforce-ui` Mod를 등록하며 권한 설정이나 Salesforce 기본 Org를 변경하지 않습니다. 설치 폴더는 엔진 실행에 계속 필요하므로 삭제하거나 이동하지 마세요.

기존 Testforce 설치가 있다면 마지막 명령에 `--update`를 붙입니다. 소유가 확인된 기존 설치를 백업하고 갱신합니다. 다른 PC에서는 이 설치를 다시 수행해야 합니다.

## 실제 사용하는 폴더

설치 폴더가 아니라 **테스트할 Salesforce 코드가 있는 프로젝트 폴더**에서 Claude Code를 새로 시작합니다. 그 폴더의 `sfdx-project.json`과 소스를 분석하며, 실행 기록은 그 폴더의 `.workbench/`에 저장됩니다.

```powershell
Set-Location "C:\업무\내 Salesforce 프로젝트"
claude
```

Claude Code에서 대상 Org 별칭과 코드를 지정합니다.

```text
/testforce my-sandbox의 MyService와 관련 Trigger를 분석해서 테스트 계획을 만들어줘
```

패널이 보이지 않으면 직접 다음 명령을 입력합니다.

```text
/testforce-ui
```

1. **계획:** 시나리오 제목을 눌러 목적·준비 데이터·실제 동작·기대 결과를 읽습니다. 실행 포함 체크는 별도입니다. 대상 Org·변경 범위를 확인하고 체크 후 승인합니다.
2. **테스트:** **테스트 시작**을 누르면 승인한 선택 묶음의 준비 → 도구 실행 → 비교를 진행합니다. 시나리오를 누르면 실행 전·후·기대값을 표로 확인합니다. 실행을 위해 Claude에게 다시 말할 필요가 없습니다.
3. **마무리:** 개발자 판정, MD·Excel 출력, 데이터 보존 또는 정리를 선택합니다. 선택 전에는 자동 삭제하지 않습니다.

자연어 분석·계획 수정·결과 해석은 Claude와 대화합니다. 수정된 계획은 새로고침하여 검토하고 재승인합니다. 이미 완료한 테스트를 다시 하려면 **새 테스트**로 별도 실행을 만듭니다. 사람 실행 항목은 도구가 대신 수행하지 않으며, 사람 실행만 선택했을 때는 **사람 테스트 준비**로 fixture만 준비합니다. Batch 등록과 처리 완료는 별개이며 **완료 확인**으로 관찰합니다.

## Salesforce 인증

조직에서 허용한 방식으로 SF CLI에 로그인하고, `/testforce`에 사용할 별칭을 명시하세요. 비밀번호나 토큰을 파일·프롬프트에 넣지 않습니다. Sandbox 예시의 URL은 실제 My Domain으로 바꿔야 합니다.

```powershell
sf.cmd org login web --alias my-sandbox --instance-url "https://MyDomain--Sandbox.sandbox.my.salesforce.com"
```

macOS/Linux에서는 `sf.cmd` 대신 `sf`를 사용합니다. 엔진은 별칭 문자열이 아니라 실제 Org ID·유형·실행 사용자를 확인하고 Production 및 유형 미확인 Org의 쓰기를 차단합니다.

## 선택적 브라우저와 오프라인 확인

일반 Mod 사용에는 상시 HTTP 서버가 필요 없습니다. Excel 편집·수동 Import·넓은 비교 표·고급 조정이 필요할 때 브라우저를 사용합니다. 아래 예제는 **실제 Org에 연결하지 않는 Fake 모드**입니다. 도구 설치 폴더에서 실행하세요.

```powershell
$workbenchCli = Join-Path (Get-Location) "dist\cli\main.js"
$sfWorkspace = Join-Path $HOME "testforce-offline"
node $workbenchCli --workspace $sfWorkspace init --mode fake --target offline
node $workbenchCli --workspace $sfWorkspace demo
node $workbenchCli --workspace $sfWorkspace serve
```

macOS/Linux:

```bash
node dist/cli/main.js --workspace "$HOME/testforce-offline" init --mode fake --target offline
node dist/cli/main.js --workspace "$HOME/testforce-offline" demo
node dist/cli/main.js --workspace "$HOME/testforce-offline" serve
```

브라우저 서버는 loopback에서만 실행되며 종료는 `Ctrl+C`입니다. 브라우저·Mod·로컬 프로세스를 닫아도 이미 시작된 Salesforce Job이 취소되지는 않습니다. Fake는 임의 Apex를 실행하는 에뮬레이터가 아니며 결과를 실제 Org 증거로 사용하면 안 됩니다.

## 업데이트와 문제 해결

도구 설치 폴더에서 `git pull`, `npm ci`, `node scripts/install-testforce.mjs --update`를 실행하고 Claude Code를 다시 시작하세요. Windows에서 npm 정책 오류가 나면 `npm.cmd`를 사용하며 실행 정책은 변경할 필요가 없습니다.

- 패널이 안 보임: Claude Code를 재시작하고 `/testforce-ui`를 입력하세요. Mod 정책은 우회하지 않습니다.
- 엔진 경로 오류: 배포 파일의 `dist/`를 복원하고 설치기를 `--update`로 다시 실행하세요. `npm run build`는 이 배포본의 명령이 아닙니다.
- 실행 중 응답을 잃음: 새로고침하여 상태를 확인합니다. 결과 불명 쓰기는 재전송하지 말고 기존 ID·Job·증거를 조정해야 합니다.
- 도구/경로 점검: `npm run doctor`. 전체 CLI 도움말: `node dist/cli/main.js --help`.
- `doctor`의 도구 버전 확인은 실제 Org 통합 검증이나 쓰기 승인이 아닙니다.

## 안전 정책과 사용 범위

자동 비교·AI 의견·개발자 판정은 분리합니다. 빈 조건이나 조회 실패를 성공으로 처리하지 않습니다. 업무 소스 자동 배포, 메타데이터·권한·규칙 변경, 기존 업무 데이터의 무승인 변경은 하지 않습니다. 실제 테스트 실행과 정리는 사용자가 해당 범위를 확인하고 승인해야 합니다. 정리는 전체 트랜잭션이나 외부 영향을 되돌리는 롤백이 아닙니다.

이 도구는 Apex 단위 테스트·배포 검증·커버리지를 대체하지 않습니다. 코드 기반 기대값과 실제값의 일치가 업무 요구사항 전체의 정확성을 보증하지 않습니다.

- [로컬 서버·승인·데이터 보안](docs/security.md)
- [Excel 편집·Data Loader CSV](docs/excel-import-contract.md)
- [사람 실행의 Service·Batch 증거](docs/manual-evidence.md)
- [오프라인 fixture 사용](docs/offline-fixtures.md)

개발 검증은 Node 24.22.0/macOS의 단위·통합 228개, 브라우저 12개, Claude Code 2.1.287·2.1.300 공식 Mod 검사 각각 13개를 통과한 구현을 기준으로 합니다. 실제 2.1.300 터미널의 Fake 흐름과 작은 화면을 확인했습니다. Windows 네이티브, 최소 버전 실제 터미널, 실제 Salesforce의 모든 업무 코드·환경은 검증하지 않았습니다. 개발 테스트 자체는 이 설치용 저장소에 포함하지 않습니다.

MIT License. 번들 의존성의 고지는 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)를 참고하세요.
