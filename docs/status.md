# 구현·검증 상태

현재 기준일: **2026-10-16**. 제품은 Claude Code Skill + Mod 패널 + 로컬 TypeScript 엔진이며, React 브라우저는 선택적 고급 화면이다. 아래 이전 단계의 기록은 당시 검증 결과로 보존한다.

## 2026-10-16 Mod 화면 단순화·직접 테스트 실행

- `plugin/mod/hooks/register.js` 및 Mod 0.3.0: **계획 / 테스트 / 마무리**. 시나리오 제목은 설명을 열고, 실행 포함 체크는 별도다. 목적·준비 데이터·실제 동작·기대 결과를 읽은 뒤 해당 시나리오의 비교 표를 볼 수 있다. 코드·스크립트·전체 ID와 단계별 실행은 접힌 영역에 남긴다.
- `src/mod/bridge.ts`: **테스트 시작** 버튼의 `run-tests`가 승인된 선택 묶음의 준비 → 도구 실행 → 비교를 이어간다. 사람 실행은 대신 수행하지 않고, Batch는 등록과 완료를 구분한다. 실패·결과 불명·완료 작업을 자동 반복하지 않는다. 단계마다 기존 엔진의 승인·소스·Org·잠금 검사를 통과해야 한다.
- 사람 실행 전용 계획은 **사람 테스트 준비**만 수행한다. 혼합 계획의 사람 실행 데이터도 준비하되, 테스트 Action은 사람이 수행할 때까지 기다린다. 비동기는 별도의 완료 확인 버튼을 사용한다.
- README·Skill·단계별 참조와 사용자 workspace의 `TESTFORCE.md` 안내를 새 버튼 흐름에 맞췄다. 업무 소스와 기존 실제 실행 기록을 수정하지 않는다.

| 실제 실행한 검사 | 결과 |
| --- | --- |
| Node 24 `npm run typecheck`, `npm run build` | strict 타입 검사 및 엔진·브라우저 빌드 통과 |
| Node 24 `npm test` | **20개 파일 · 228개 통과**, 34.59초. 신규 합성 실행의 승인·변경 소스/사용자·사람 Insert·Batch·독립 실패·재전송 차단 포함 |
| Node 24 `npx playwright test` | 기존 브라우저 회귀 **12개 통과**, 31.0초 |
| 공식 Mod 검증 | 정확한 2.1.287·설치된 2.1.300 validate 통과. 최종 UI 자동화 **각각 13개 통과**, 0개 실패. 실제 프로세스 응답은 가공이며 실제 Org 검증과 구분한다. |
| 실제 2.1.300 터미널 | 160×40 화면에서 설명 열기 → 확인 체크·승인 → **테스트 시작 한 번** → 시나리오별 비교 → MD/Excel 출력 → 보존을 실제 클릭했다. Fake 5개 실행·4 MATCH/1 의도한 MISMATCH, 쓰기 작업 5개 성공, plan v2 유지. `test-results/mod-ux-terminal-smoke.json` |
| 작은 실제 터미널 | **80×24** 화면에서 기존 결과를 열었다. 좁은 본문에 시나리오·다음 페이지가 바로 보이며, 클릭 후 목적 설명과 전후 비교 표가 표시되는 것을 확인했다. 6줄 본문에 대한 공식 UI 회귀 검사도 포함한다. |
| 개인 설치 갱신 | Node 24 `install-testforce.mjs --update`로 Skill과 Mod 0.3.0을 백업 후 갱신했다. `--plugin-dir` 없이 새 `claude`에서 `/testforce-ui` 자동 로딩·80×24 목록 표시 확인. 설치된 JS와 소스의 해시 및 기존 사용자 실행 상태 해시 일치 확인. |

실제 Salesforce 조회·쓰기는 하지 않았다. HTTP 서버 없이 로컬 Fake 엔진을 실행했다. 80×24의 작은 inline 패널에서 첫 화면이 지나치게 잘리는 것을 실제 발견하여 별도 축약 레이아웃으로 수정했다. 넓은 패널은 시나리오 5개 목록과 설명 카드를 사용하고, 아주 작은 패널은 1개 목록·설명 단계·결과 표로 넘긴다. 마지막 검토에서 Insert 설명의 동작별 입력 덮어쓰기와 대기 상태의 완료 오인 문구도 수정하고 회귀 검사를 통과했다. 기존 브라우저는 계속 사용할 수 있다. Windows 네이티브와 최소 2.1.287의 실제 터미널 조작은 미검증이다.

## 2026-10-16 Mod 기본 화면 전환 완료

- `plugin/mod/hooks/register.js`: `/testforce-ui`의 **계획 / 결과 / 마무리**. 짧은 요약과 접힌 상세, 확인 체크와 한 번의 계획 승인, 준비·실행·비교, 실행 전/후/기대값 3열, 개발자 판정, 보고서·보존·정리. JSON 입력과 승인자 이름·날짜 입력이 없다.
- `src/mod/bridge.ts`, `main.ts`: HTTP 서버 없이 필요한 순간에 엔진을 호출한다. stdin 전용 인터페이스, 허용 동작 목록, 5분·일회용 권한, 계획 버전/해시/실행 상태/정리 대상 검사. Production·기존 데이터·배포본·UNKNOWN 차단은 같은 엔진에 남는다.
- `scripts/install-testforce.mjs`, `configure-mod.mjs`: 개인 Skill과 Mod 설치, 기존 소유 확인·백업, Node 24 경로 연결. `scripts/package.mjs`는 머신별 Mod 설정과 생성된 타입을 제외한다.
- `plugin/skills/testforce/`: 자연어 분석·수정은 Skill, 사용자 조작은 패널. 서버 자동 시작과 Mod 승인 동작 모방을 금지한다. 넓은 표·Excel·수동 Import·고급 조정은 보조 브라우저/CLI에 유지한다.
- 사용자 lab-hub workspace의 `CLAUDE.md`, `TESTFORCE.md` 안내만 패널 방식으로 갱신했다. 기존 실행 상태·증거·업무 소스·Org는 변경하지 않았다.

| 실제 실행한 검사 | 결과 |
| --- | --- |
| Node 24.22.0 `npm run typecheck`, `npm run build` | 엔진/웹 strict 검사와 빌드 통과 |
| Node 24 `npm test` | **20개 파일 · 219개 통과**, 30.11초 |
| Node 24 `npx playwright test` | macOS Chromium **12개 통과**, 24.8초 |
| `claude plugin validate ./plugin/mod` | 설치된 2.1.300 및 정확한 최소 2.1.287 공식 정적 검증 통과 |
| `claude plugin test ./plugin/mod` | **2.1.300과 2.1.287 각각 8개 통과**. 실제 공식 런타임의 mounted UI callback 검사이며 SF 호출은 stub |
| 실제 터미널 Mod | 2.1.300의 PTY에서 Fake 실행을 확인 체크 → 승인 → 준비 → 실행 → 비교 → 판정 → 정리 대상 → 체크 → 정리로 조작. `MATCH`, `mod` 승인 채널, 정리 완료·잔여 0건 확인. HTTP 서버 시작 없음 |
| 화면/설치 회귀 | 70열 전후 비교, stale 체크 해제, double-click, UNKNOWN 재전송 금지, stdin·출력 잘림, 한글·공백 설치 경로, 기존 설치 백업·충돌 차단 검사 |
| 개인 설치 실제 확인 | `install-testforce.mjs --update`로 기존 Skill을 백업하고 갱신. lab-hub 소스 폴더에서 `claude`만 실행해 개인 Mod 자동 로딩·기존 계획 표시 확인. 기존 실행 상태 SHA-256 동일. `test-results/installed-mod-smoke.json` |
| `npm run package:local`, `npm run verify:package` | ZIP 독립 의존성 설치 후 서버 없는 Mod bridge, 개인 Skill/Mod 설치, Fake 계획과 선택적 UI/API 200 검증. 머신별 Mod config·타입·인증·실행 데이터 제외 확인. 최종 ZIP 해시는 `artifacts/install-smoke.json` |

터미널 결과 요약은 `test-results/mod-terminal-smoke.json`에 있다. 이전 읽기 전용 Mod 테스트가 신규 기능과 맞지 않아 첫 전체 테스트는 1개 실패했다. 실제 버튼·엔진 동작 계약으로 교체한 뒤 전체 219개를 다시 실행해 통과했다. 설치 테스트의 `/var`와 `/private/var` 경로 별칭 비교도 실제 경로로 바로잡았다.

이번 개발 검증은 Fake 모드이며 실제 Salesforce 조회·쓰기를 수행하지 않았다. Windows 네이티브와 최소 2.1.287의 실제 터미널 화면 조작은 미검증이다. 2.1.287의 공식 자동화 테스트 통과와 2.1.300 실제 터미널 검증을 구분한다. 조직 정책에 따라 자동 패널 열기 훅이 생략될 수 있어 `/testforce-ui` 명령을 유지하며 정책을 완화하지 않는다. 긴 작업 처리 중 중단 버튼은 비활성화되고, 패널 닫기는 Salesforce Job 취소가 아니다.

## 2026-10-16 UI·승인 개선 완료

- `web/src/App.tsx`, `style.css`: 현재 단계와 다음 작업, 선택한 방식에만 필요한 폼, 소스·고급 기능 접기, 기존 실행 선택, 작은 화면의 이름 있는 메뉴와 표 내부 스크롤.
- `web/src/components/ResultTables.tsx`, `web/src/result-data.ts`: **실행 전 → 실행 후 실제값 → 기대값 → 차이** 비교표. 입력·전후 레코드, Service 반환값/오류, Batch 관찰을 표·필드 목록으로 표시한다. null/빈 문자열/생략/미수집/0/false와 테스트 삭제/정리를 구분한다.
- `web/src/components/PlanReview.tsx`: 준비 입력·기대 결과·실행 인자·스크립트 검토. Excel 변경도 전후 값 표로 표시한다.
- 승인자 이름·날짜 입력 제거. 확인 체크와 한 번의 승인으로 해당 계획의 준비·도구 실행 범위를 승인한다. `src/server/commands.ts`, `src/cli/main.ts`에서 로컬 사용자 동작·시각을 자동 기록하고 버전·해시·확인 플래그를 검사한다. 실제 Salesforce 수동 실행자 보고는 별도로 유지한다.
- 정리는 대상 표를 보고 확인 체크 후 삭제 버튼 한 번으로 승인과 실행을 연결한다. 충돌·소유권·진행 중 작업의 엔진 차단은 유지한다.
- README·보안·결정 문서와 Plugin/설치된 개인 Skill 안내를 함께 갱신했다.

이번 변경에서 실제 실행한 검증:

| 검사 | 결과 |
| --- | --- |
| Node 24 `npm run typecheck`, `npm run build` | strict 엔진/웹 타입 검사·빌드 통과 |
| Node 24 `npm test` | **18개 파일, 198개 통과**, 28.26초 |
| Node 24 `npx playwright test` | macOS Chromium **12개 통과**, 16.7초 |
| 실제 브라우저 시나리오 | Fake 레코드 준비 9 → Update 10 → 기대값 11 불일치, 승인 한 번, 표·새로고침 영속성, Excel 왕복, 정리, 오래된 체크 해제, 사람 Anonymous/Import 다운로드, 조기 수집 후 새 비교 |
| 화면 확인 | 데스크톱/390px 모바일 캡처 확인. 표 내부 스크롤·키보드 접근·문서 가로 넘침 없음. `test-results/workbench-table-comparison.png`, `workbench-mobile.png`, `workbench-review.png` |
| 현재 사용자 실행 | 로컬에 저장된 4개 시나리오·11개 비교 결과를 새 UI에서 읽기 전용으로 확인. 화면에 노출된 JSON 블록 0개. 실제 Org 조회·쓰기, 기존 실행·증거 수정 없음 |
| 터미널 승인 | 명시적인 Fake 실행의 실제 PTY에서 `승인` 한 번 입력 후 이름 질문 없이 기록되는 것 확인 |

초기 E2E의 모바일 예제 생성 선택자가 숨겨진 데스크톱 버튼을 선택해 실패했다. 예제 생성 후 모바일 크기로 전환하도록 테스트 준비를 수정했고, 모바일의 실제 승인·실행·표·키보드·넘침 검사는 유지해 최종 12개 모두 통과했다. 단위 테스트와 E2E는 실제 Salesforce 검증을 뜻하지 않는다. Windows 네이티브와 Mod runtime 검증은 추가하지 않았다.

기존 사용자 서버를 종료하거나 현재 테스트를 다시 실행하지 않았다. 새 브라우저 빌드는 새로고침으로 볼 수 있고, 서버 승인 처리의 전체 갱신은 서버를 재시작해 같은 workspace의 기존 실행을 열면 된다. 저장된 run과 증거는 그대로 사용한다.

아래 검증 표는 초기 제품 및 비운영 정책 변경 당시의 기록이다.

## 구현 파일과 기능

| 영역 | 주요 파일 | 구현한 동작 |
| --- | --- | --- |
| 계획·안전·영속성 | `src/core/model.ts`, `plan.ts`, `store.ts`, `compare.ts` | strict 스키마, 버전/해시 승인, 원자적 저장·잠금·증거, 논리키, 선언적 비교 |
| 분석·AI 연결 | `src/analysis/index.ts`, `docs/schemas/` | 다중 packageDirectory·대상/오버로드 후보·현재 소스/커밋, 요청 ID·소스 해시·초안 제출 |
| 연결부 | `src/salesforce/` | 명시적 Org, IsSandbox 확인, Describe/제약·Tooling·SOQL 페이지, REST DML, CLI Apex, Job, Fake |
| 실행·복구 | `src/execution/engine.ts`, `manual.ts`, `src/cleanup/extended.ts` | 준비/Baseline/Action, Trigger·Service·Batch, 사람 안내, 오류·부분 성공·UNKNOWN·재개, 관찰, 승인 복구·Job 취소 |
| Excel | `src/workbook/index.ts` | 생성 양식 왕복, 값·행·기대값·Update 입력 편집, 모호한 빈칸 선택, 위조·수식·위험 ZIP 차단 |
| Import | `src/imports/index.ts` | SOAP Data Loader 단계별 CSV, 부모 ID 대기, 성공/실패 대응, 실제 조회·소유권 구분 |
| 보고서·정리 | `src/reports/index.ts`, engine cleanup | 한국어 MD·결과 XLSX, 입력/before/after, AI/판정 분리, 선택 대기·보존·충돌/부분 정리 |
| 로컬 API·CLI | `src/server/`, `src/cli/` | loopback 인증·Host/Origin/CSRF, 실제 엔진 명령, TTY 승인, doctor·fixture·파일 보안 |
| 브라우저 | `web/` | 실제 후보 선택·표 편집·승인·실행·사람 안내·Excel/Import·결과·판정·정리·영속 새로고침 |
| Claude 제품 연결 | `plugin/`, `src/mod/` | 수동 Skill·단계별 참조·런처와 기본 사용자 조작 Mod 패널 |
| 배포·문서 | `scripts/package.mjs`, `README.md`, `docs/` | 로컬 빌드 ZIP, Windows 명령, 계약·보안·수용 기준·환경 제한 |

## 실제 실행한 검증

아래 통과는 오프라인 fixture/가공 REST와 로컬 브라우저 검증이다. 실제 Salesforce에서 업무 테스트를 실행한 것은 아니다.

| 명령/검사 | 실제 결과·범위 |
| --- | --- |
| `npm run typecheck`, `npm run build` (Node 24.22.0) | 최종 소스 정리 후 엔진/웹 strict 타입 검사와 프로덕션 UI 빌드 통과. |
| `npm test` | 비운영 정책 변경 후 2026-10-15 23:03 실행: **16개 파일·175개 모두 통과**, 24.71초. 단위·통합·실제 프로세스 재시작·복구·파일·HTTP·Plugin 계약 포함. |
| `npx vitest run tests/integration/extended.test.ts tests/unit/files.test.ts tests/unit/files-security.test.ts` | 3개 파일·32개 실제 통과. 복구/Job 별도 승인·수동 스크립트·Import 실조회/소유권·XLSX/CSV·보고서 비밀 제거 포함. |
| `npm exec --yes --package=node@24 -- npx playwright test` | macOS Chromium **7/7 통과**, 최종 11.0초. 실제 소스 후보와 오버로드 선택, 승인/준비/실행/비교/판정/보고서/보존/정리/새로고침, Excel 편집 왕복, 사람 Insert와 CSV, 로컬 요청 보안. |
| `npm run schema` | Plan·Draft·Offline fixture JSON Schema를 최종 런타임 스키마로 재생성했다. |
| `npx vitest run tests/integration/plugin.test.ts` | 로컬 Skill/Mod harness 2개 통과. Claude terminal runtime 검증과 구분. |
| `claude plugin validate ./plugin` | 기존 전역 2.1.169에서 핵심 Plugin 통과. 전역 버전은 변경하지 않음. |
| `npm exec --yes --package=@anthropic-ai/claude-code@2.1.287 -- claude plugin validate ./plugin` | 정확한 최소 버전에서 핵심 Plugin 통과. |
| 위 최소 버전의 `claude plugin validate ./plugin/mod` | 독립 Mod의 공식 정적 검증 통과. 공식 runtime test는 rollout 비활성으로 차단되어 미실행. |
| `npm audit --json` | 최종 개발 의존성을 포함해 0 vulnerabilities. ExcelJS의 uuid 11.1.1 override 포함. deprecation 경고는 남아 있음. |
| `npm run package:local`, `npm run verify:package` | 실제 ZIP을 한글·공백 임시 폴더에 풀어 새 `npm ci --omit=dev` 설치 후 CLI·UI·인증 API를 검사한다. 파일 목록·빌드 머신 경로·작업/인증 폴더 제외도 검사하며 실행 결과와 ZIP SHA-256은 `artifacts/install-smoke.json`에 기록한다. |
| 독립 배포 설치 smoke | 한글/공백 임시 폴더에 빌드 파일·package/lockfile만 복사, `npm ci --omit=dev` 실행, Node 24.22.0 help/init/demo/UI200/인증 API200/fake 모드 확인·SIGTERM 종료 성공. |

브라우저 화면 증거는 로컬 `test-results/workbench-review.png`이다. 테스트 파일은 `tests/unit`, `tests/integration`, `tests/e2e`에 있으며 요구별 실제 검사 범위는 [수용 기준](acceptance-matrix.md)에 연결했다. 초기 Chromium 미설치·UI 접근성 선택 문제·타이밍 경쟁 및 관찰 회귀는 실제 실패를 확인한 뒤 수정했으며 최종 실행에서 모두 다시 통과했다.

## 명시적 환경 제한

- **Salesforce:** 초기 제품 검증은 오프라인이었다. 후속 사용자 요청으로 `lab-hub`의 실제 Developer Edition 유형을 조회하고 별도 testforce-demo 예제 6개 컴포넌트를 배포했다(Apex 테스트 11개 통과, 대상 실행 코드 100% 커버리지; 실제 배포 식별자는 로컬 기록에 보관). 실제 업무 레코드를 남기는 DML이나 워크벤치의 실제 데이터 테스트는 실행하지 않았다. Scratch Org 판별은 가공 Dev Hub 계약 테스트이며 실제 Scratch Org 통합은 미검증이다.
- **Windows:** PowerShell 명령과 sf.cmd 직접 실행 로직, 한글·공백·특수문자/CRLF·경로 검사 코드를 제공한다. 가공 Windows wrapper 검사는 macOS에서 수행했다. Windows 파일 잠금·실제 sf.cmd·종료 신호를 직접 검증하지 않았다.
- **Mod:** 최신 전환 검증은 맨 위 표를 따른다. 2.1.287/2.1.300의 공식 테스트 8개와 2.1.300 실제 Fake 터미널 흐름을 검증했다. Windows·조직별 정책·최소 버전 실제 화면은 별도 미검증이며 Mod가 없어도 핵심 엔진을 사용한다.
- **Data Loader/Office:** SOAP CSV 계약과 XLSX 편집은 Node/Chromium 자동화로 확인했다. 실제 Data Loader 실행·Microsoft Excel 앱의 locale별 저장 결과는 미검증이다. Bulk API/2.0은 이 파일 생성기의 지원 계약이 아니다.
- **정적 분석:** 로컬 구조 탐색과 공개 진입점 검사는 완전한 Apex 파서·부수 효과 증명·전체 제약 해결기가 아니다. 조회 가능한 제약과 실제 준비 오류를 사용하고 확인할 수 없는 실행 범위는 차단한다.
- **오프라인 실행:** Fake 모드는 선언적 사용자 fixture와 테스트용 어댑터로 지원한다. 임의 업무 Apex 로직을 자동 에뮬레이션하지 않는다. 시뮬레이션은 모든 보고서에서 실제 Org 증거와 구분한다.
- **배포:** 소스/빌드 ZIP 설치 경로를 제공한다. 의존성 최초 다운로드 또는 캐시가 필요하며 node_modules를 포함한 완전 오프라인 설치 ZIP은 아니다. 자동 push·배포·공개 업로드는 하지 않았다.

수동 Service·Batch 로그 연결은 [manual-evidence](manual-evidence.md)에 설명한다. 사용자 보고 시각과 실제 실행했다고 기재한 시각도 분리한다. 결과 불명 DML은 원래 요청 키·값을 실제 재조회하며, 생성 소유권은 별도 확인 전 unresolved를 유지한다. 정리·복구 이후 재수집으로 원래 테스트 판정을 덮어쓰지 않는다.

이 제한을 구현 TODO나 가짜 성공으로 대체하지 않는다. 사용자의 첫 설정은 Node 24, 도구 설치 경로와 workspace 선택이며 실제 모드에는 승인된 Sandbox 인증과 로컬 소스, AI 분석에는 기존 Claude Code 로그인 세션이 필요하다.
