# 호환성·공식 계약 확인 기록

확인일: **2026-10-16** (기존 라이브러리·SF 계약 확인은 10월 15일). 아래 설치·실행 결과는 macOS arm64에서 얻었다. Windows 네이티브 실행, 실제 Salesforce Sandbox, 실제 Data Loader/Excel 앱을 검증한 결과로 확대하지 않는다.

## 런타임과 라이브러리

제품은 `package.json`의 `engines.node >=24 <25`와 `.nvmrc`의 24를 사용한다. [Node 공식 릴리스 표](https://nodejs.org/en/about/previous-releases)에서 24 계열의 LTS 지원을 확인했고, 실제 빌드·테스트·브라우저·독립 설치 실행에는 **24.22.0**을 사용했다. TypeScript의 Node 타입 패키지 버전이 런타임 지원 버전을 의미하지 않는다.

다음 버전은 설치된 패키지와 lockfile로 확인했다. 재현 설치는 `npm ci`를 사용한다.

| 구성 | 확인한 버전 | 실제 사용·확인 |
| --- | --- | --- |
| Node.js | 24.22.0 | 제품 빌드, CLI, HTTP 서버, Vitest, Chromium E2E |
| TypeScript | 7.0.2 | strict 컴파일과 별도 웹 타입 검사 |
| React / React DOM | 19.3.1 | 브라우저 UI 및 실제 Chromium 조작 |
| Vite / React plugin | 8.3.4 / 6.1.2 | 빌드된 UI를 Fastify에서 제공 |
| Fastify / static | 5.12.7 / 10.1.6 | loopback 서버, 인증·Origin·Host·CSRF 검사 |
| Zod | 4.6.7 | 런타임 검증과 `z.toJSONSchema` |
| Commander | 15.0.0 | 실제 `--help`, CLI 옵션·TTY 승인 |
| ExcelJS | 4.4.0 | 계획 왕복·결과 Excel, MIT 라이선스 |
| csv-parse / csv-stringify | 7.0.3 / 6.9.0 | UTF-8·CRLF CSV, MIT 라이선스 |
| yauzl | 3.4.0 | ZIP 항목·크기·압축률·경로 사전 검사, MIT 라이선스 |
| decimal.js | 10.6.0 | 정밀 숫자 비교와 허용오차 |
| Vitest / Playwright | 4.1.11 / 1.64.1 | 단위·통합 / 실제 Chromium E2E |
| tsx | 4.23.15 | 개발 CLI와 스키마 생성 |

[ExcelJS 공식 저장소](https://github.com/exceljs/exceljs)의 API와 설치된 패키지의 라이선스·소스를 확인했다. 최신의 모든 Office 기능 지원이나 유지보수 수준을 보장하지 않는다. 제품은 생성한 양식의 데이터 왕복으로 지원 범위를 제한한다. 실제 Microsoft Excel 앱의 저장 동작·locale는 미검증이다.

ExcelJS 하위 `uuid`의 `<11.1.1` 범위가 [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)에 해당하여 `overrides.exceljs.uuid=11.1.1`을 적용했다. 설치된 ExcelJS의 사용처는 인자 없는 `v4()`이며 [uuid 11.1.1 공식 package 정의](https://github.com/uuidjs/uuid/blob/v11.1.1/package.json)의 CommonJS export와 실제 XLSX 직렬화·재읽기를 확인했다. 확인 당시 `npm audit --omit=dev`는 **0 vulnerabilities**였다. 이 결과는 미래 취약점이 없다는 보증이 아니다. `inflight`, 구형 `rimraf/glob/fstream`, `lodash.isequal` 등의 하위 패키지 deprecation 경고는 별개로 남아 있다.

## Salesforce CLI와 API

설치된 도구는 `@salesforce/cli/2.128.5 darwin-arm64 node-v25.8.1`, `@salesforce/plugin-apex 3.9.29`이다. SF CLI 자체의 번들 Node 25.8.1과 제품의 Node 24 지원 범위는 별개다.

`sf org display`, `sf apex run`, `sf data query`, `sf sobject describe`, `sf org login web`의 설치된 `--help`를 실제 확인했다. 로그인 예제의 `--alias`와 `--instance-url`은 존재하는 옵션이다. 초기 제품 개발에서는 로그인·실제 Org 조회·쓰기를 실행하지 않았다. 후속 사용자 요청으로 기존 인증의 Developer Edition 실제 유형을 조회하고 별도 예제 Apex를 배포했다. Org 실제 데이터 시나리오 전체 통합 검증은 별개다.

- 인증은 명시적인 `--target-org`의 `sf org display --json`을 어댑터 내부에서 사용한다. 원본 인증 응답은 분석·화면·보고서로 내보내지 않는다.
- Anonymous Apex는 `sf apex run --file --api-version --target-org --json`을 사용한다. 설치된 `plugin-apex`와 `apex-node`에서 SOAP 요청 단위 DebuggingInfo와 JSON 응답을 확인했다. TraceFlag/DebugLevel 변경이나 log tail을 호출하지 않는다.
- Describe, SOQL 페이지 처리, Tooling 소스·메타데이터, sObject Collections DML은 CLI 인증을 재사용하는 공식 REST API다. API 버전은 대상의 지원 목록과 프로젝트 설정을 확인하며 프로젝트 설정을 올리지 않는다.
- 가공 응답 계약 테스트는 실제 캡처 응답이 아니다. HTTP 성공과 컴파일 성공·레코드별 업무 결과를 분리한다.
- Windows `sf.cmd`는 알려진 Salesforce Node 진입점을 확인하여 인자 배열로 실행한다. macOS에서 가공 `.cmd`와 한글·공백·특수문자 경로로 검증했으나 실제 Windows 실행·파일 잠금·프로세스 종료는 미검증이다.

세부 JSON·REST 계약과 공식 문서 링크는 [Salesforce 연결 계약](salesforce-contracts.md)에 있다. [Apex CLI 공식 plugin](https://github.com/salesforcecli/plugin-apex), [Data CLI 공식 plugin](https://github.com/salesforcecli/plugin-data), [Apex 개발자 가이드](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/)를 기준으로 한다.

[Salesforce DX MCP](https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-mcp-server.html)는 선택적 보조다. 제품 실행 엔진의 필수 의존성이 아니며 MCP를 통한 별도 쓰기·자동승인 경로는 제공하지 않는다. MCP 설치만으로 Salesforce 인증이나 실제 Org 통합 검증이 완료된 것은 아니다.

## Excel과 Data Loader

지원 양식은 도구가 생성한 XLSX이며 임의 양식 추론, 매크로·수식 실행, 외부 링크는 지원하지 않는다. [yauzl 공식 API](https://github.com/thejoshwolfe/yauzl)의 strict filename·lazy entry 처리와 설치된 구현을 확인하고 XLSX 읽기 전에 파일 제한을 적용한다.

수동 Import의 첫 지원 모드는 **Data Loader SOAP**, UTF-8 CSV다. [공식 Data Loader 안내](https://developer.salesforce.com/docs/platform/data-loader-impl/guide/inserting-updating-or-deleting-data.html), [공식 null 처리 설명](https://help.salesforce.com/s/articleView?id=000385696&language=en_US&type=1), [공식 사용자 가이드](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_data_loader.pdf)를 확인했다. Bulk API/2.0의 다른 null 표현을 동일하게 취급하지 않는다.

null 업데이트 묶음은 `Insert Null Values` 사용을 안내하고, 생략할 필드는 컬럼에서 제외한다. null과 의미 있는 빈 문자열을 이 경로에서 구분할 수 없는 입력은 차단한다. 조용히 null로 바꾸지 않는다. 원본 전송 CSV와 수식 보호 검토 CSV는 별도 파일이다. 부모/자식 단계·결과 대응·실제 ID 연결·재조회는 로컬 테스트로 검증했으며 실제 Data Loader 출력 캡처와 사용자 설정 조합의 통합 검증은 하지 않았다. 자세한 계약은 [Excel·Import](excel-import-contract.md)에 있다.

## Claude Code Skill·Plugin·Mod

[공식 Skills](https://code.claude.com/docs/en/skills), [Plugins](https://code.claude.com/docs/en/plugins/overview), [Mods](https://code.claude.com/docs/en/plugins/mods/overview), [Mod 관리·정책](https://code.claude.com/docs/en/plugins/mods/admin) 및 공식 타입 선언을 확인했다. 핵심 Skill은 `disable-model-invocation: true`이며 사용자의 수동 호출 이후 기존 세션이 초안을 작성한다. 별도 AI API를 호출하지 않는다.

| 대상 | 실제 결과 |
| --- | --- |
| 현재 설치된 Claude Code 2.1.300 | `testforce-panel` **0.3.0** 공식 validate 통과, 공식 Mod 테스트 **13개 통과**. 실제 160×40 터미널에서 Fake 승인→테스트 시작 한 번→비교→보고서→보존, 80×24에서 축약 목록·설명·결과 표를 확인했다. 이전 0.2.0의 판정·정리 검증은 status의 별도 기록이다. Claude 버전·권한 설정을 변경하지 않았다. |
| 정확한 최소 버전 2.1.287 | npm 임시 실행으로 버전 확인. Mod 0.3.0 공식 validate 통과, 공식 Mod 테스트 **13개 통과**. 최소 버전의 실제 터미널 화면 조작은 미검증이다. |
| 로컬 Mod harness / 엔진 bridge | Vitest 패널 계약 5개, bridge 26개, 설치 1개 통과. 전체 단위·통합 **228개**와 구분하며 실제 Org 증거가 아니다. |
| 과거 읽기 전용 Mod 기록 | 당시 2.1.169는 Mod 미지원, 2.1.287은 정적 검증만 통과하고 runtime rollout이 차단되었다. 10월 16일의 새 Mod 공식 테스트는 차단 없이 실행되었으며 정책 우회는 하지 않았다. |
| 독립 Claude Skill 행동 확인 | 가상 승인 주석·UNKNOWN Insert 재시도 입력에 안전하게 응답. 도구 비활성·빈 MCP·세션 저장 없음. 실제 Org 실행 증거가 아니다. |

2.1.300이 대화형 로딩 시 생성한 공식 타입을 읽고 `session.start`, `command.run`, `skill.prompt`, `turn.complete`, `ui.close`, `ui.render(Pane)`와 `$.command.register`, `$.session.cwd`, `$.plugin.root`, `$.fs.read`, `$.process.run`(인자 배열·stdin·timeoutMs), `$.ui.open/resolve/invalidate`를 사용했다. UI는 공식 Box/Text/Button/Input/Select를 조합하며 별도 React/HTTP 서버를 패널 안에 넣지 않는다. 생성 타입과 머신별 config는 배포에 포함하지 않는다.

[공식 Create](https://code.claude.com/docs/en/plugins/mods/create), [API](https://code.claude.com/docs/en/plugins/mods/api), [Reference](https://code.claude.com/docs/en/plugins/mods/reference)의 설치·테스트·요소 계약을 확인했다. 조직 관리 환경에서는 사용자 Plugin의 `skill.prompt`가 무시될 수 있다는 공식 validate 안내가 있으므로 자동 열기에만 의존하지 않고 `/testforce-ui`를 제공한다. Mod 없이도 Skill+브라우저/CLI는 동작한다. 회사 정책을 바꾸거나 지원하지 않는 API를 보장하지 않는다.

## 배포와 실제 실행 범위

`scripts/package.mjs`는 빌드된 `dist`, `web-dist`, Plugin, 문서, 배포 스크립트, README, LICENSE, package/lockfile, `.nvmrc`만 ZIP에 넣는다. node_modules와 src/tests 및 업무 workspace는 포함하지 않는다. 소스 설치는 `npm ci` 후 build, 빌드된 ZIP은 `npm ci --omit=dev` 후 바로 CLI를 실행한다. ZIP에서 재빌드하는 명령은 지원하지 않는다.

`install-testforce.mjs`는 공식 개인 skills-directory Plugin 로딩 경로를 사용한다. 실제 lab-hub 소스 폴더에서 `--plugin-dir` 없이 `claude`를 시작하고 `/testforce-ui`를 열어 자동 로딩을 확인했다. 기존 개인 Skill은 소유 확인 후 백업했으며 승인·권한·회사 정책은 바꾸지 않았다. 설치된 Node 실행 파일이나 엔진 폴더가 이동·삭제되면 Node 24에서 설치기를 `--update`로 다시 실행한다. ZIP 독립 설치에서도 Mod bridge 조회와 개인 Skill/Mod 설정 생성을 확인했다.

별도 한글·공백 임시 폴더에 빌드 산출물과 package/lockfile만 복사하여 `npm ci --omit=dev`를 실제 수행했다. Node 24.22.0에서 CLI help/init/demo, 빌드 UI HTTP 200, 인증된 실행 목록 API HTTP 200, fake 모드 확인, SIGTERM 종료가 통과했다. 저장소의 node_modules를 재사용하지 않았다. 최초 의존성 설치에는 다운로드 또는 npm 캐시가 필요하다. 설치 후 오프라인 기능에 네트워크는 필요하지 않지만 Salesforce/Claude 연결은 각 서비스가 필요하다.

최신 Chromium E2E **12개**가 macOS/Node24에서 통과했다. 검증한 전체 명령·시점은 [상태](status.md), 요구별 한계는 [수용 기준](acceptance-matrix.md)에 기록한다. 실제 Windows·Sandbox·Excel/Data Loader와 최소 Mod 버전의 실제 터미널 화면은 각각 별도 미검증 항목이다.

TypeScript Node 타입은 실행 런타임과 같은 `@types/node` 24.19.2로 고정했다. 최종 전체 `npm audit --json`은 개발 의존성을 포함해 취약점 0건이었다. 번들에 포함된 React/React DOM/scheduler 라이선스 고지는 배포 루트 `THIRD-PARTY-NOTICES.txt`에 있다.

## 비운영 Org 정책 확인 (2026-10-15)

실제 lab-hub에서 Organization.IsSandbox=false, OrganizationType=Developer Edition을 확인했고 수정한 실제 어댑터에서 허용으로 판정했다. Scratch 판별의 ActiveScratchOrg.ScratchOrg/ExpirationDate 필드는 실제 Dev Hub Describe로 확인했다. 설치된 plugin-org의 org/display.js는 devHubId를 AuthFields.devHubUsername에서 반환한다. 이 값만으로 허용하지 않고 Dev Hub 활성 기록을 재조회한다. Developer/Enterprise 등 Scratch Edition은 다양하므로 OrganizationType만으로 Enterprise Scratch를 Production이라고 확정하지 않는다. Scratch 존재·만료·불일치·Hub 조회 실패는 가공 응답 테스트로 확인했으며 실제 Scratch Org 통합은 미검증이다. 공식 참고: https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-scratch-orgs-def-file.html 및 https://developer.salesforce.com/docs/platform/pkg2-dev/guide/sfdx-dev-scratch-orgs-view-lex.html
