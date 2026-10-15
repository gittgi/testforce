# 수용 기준과 실제 검증 대응

기준일: 2026-10-16. 아래는 구현 파일과 **테스트가 실제로 검사하는 내용**의 대응표다. 테스트 제목만으로 관련 요구 전체가 검증되었다고 간주하지 않는다. 모든 Fake/가공 응답 검증은 실제 Salesforce 검증과 구분한다. 이후 Testforce Mod 전환의 새 검증은 마지막 절에 분리한다.

정책 변경 후 Node 24.22.0 실행(2026-10-15 23:03): `npm test` **16개 파일·175개 통과**(24.71초), `npm run test:e2e` **Chromium 7개 통과**(11.0초). strict 타입 검사·프로덕션 빌드·스키마 생성도 통과했다. `tests/integration/recovery.test.ts`의 18개 회귀 검사, `manual-evidence.test.ts`의 7개 수동 로그 검사, `final-guards.test.ts`의 5개 관찰·불변성·경로 검사가 포함된다. 실제 Windows/Sandbox 검증과 구분한다. 상세 실행 기록은 [status.md](status.md)를 따른다.

| 표기 | 의미 |
| --- | --- |
| 오프라인 검증 | 해당 핵심 검사를 Fake/가공 입력으로 실제 실행하여 통과했다. live 검증은 아니다. |
| 구현·추가 확인 | 구현 경로가 있으나 해당 세부 조건의 실행 검증이 부족하거나 연결 작업이 남아 있다. |
| 환경 미검증 | 실제 Sandbox/Windows/Claude 버전 등의 외부 환경 검증을 하지 않았다. |

## A. 승인·환경

| ID | 요구 | 구현 | 실제 검사·한계 | 상태 |
| --- | --- | --- | --- | --- |
| A1 | 승인 전 실제 쓰기 차단 | `execution/engine.ts` gate/write, `server/commands.ts` | `integration/engine.test.ts`: 승인 전 Fake 쓰기 0, stale 버전/재승인 차단. 실제 live 호출은 하지 않음 | 오프라인 검증 |
| A2 | 운영/미확인 Org·별칭/사용자 변경 차단 | engine identityCheck, `salesforce/cli-adapter.ts` identity/mutate | org-policy 테스트의 Developer Edition 허용·Production/미확인 차단·Dev Hub Scratch 검증·유형 변경 재승인, Org ID/username 변경; adapter 가공 REST 인증 변경 | 오프라인 검증 |
| A3 | 데이터·기대값·스크립트·소스·경로 변경 재승인 | core hash/plan, engine installPlan/localCheck | 기대값 수정 승인 해제, 실제 로컬 소스 변경 차단 검증. 모든 필드별 변경 조합의 독립 테스트는 추가 대상 | 오프라인 검증 / 일부 추가 확인 |
| A4 | Excel/JSON 가짜 승인·오래된 UI 거부 | strict Plan/Draft, workbook contract, version/hash 검사 | JSON approved 필드 거부, Excel 승인 시트/소유ID/계약 변조/오래된 버전 거부. 실제 HTTP의 stale 승인409와 브라우저 편집 후 승인 해제도 통과 | 오프라인 검증 |
| A5 | 로컬/배포본 차이 차단, 자동 배포 금지 | engine sourceCheck, adapter deployedSource | 추가 engine 테스트에서 실제 가공 배포 본문 차이를 주입하여 DEPLOYED_SOURCE_MISMATCH, 로컬 소스 불변, 쓰기0을 검사. BOM/CRLF 외 보존도 검사 | 오프라인 검증 |

## B. 준비·실행

| ID | 요구 | 구현 | 실제 검사·한계 | 상태 |
| --- | --- | --- | --- | --- |
| B1 | 수동 Insert는 준비 중 실행하지 않음 | engine prepare/human | fixture만 생성, action ID 미생성, prepare 승인으로 execute해도 추가 쓰기 없음 | 오프라인 검증 |
| B2 | Update/Delete 준비 후 전제조건 재조회 | engine recordRead/preconditions, Action.fieldOverrides | 준비 자동화로 값이 바뀐 사례를 재조회 후 실패 처리. Excel/CSV는 before와 Update 입력 분리. 실제 DML Update/Delete의 상세 통합 사례는 최종 테스트 참조 | 오프라인 검증 / 일부 추가 확인 |
| B3 | 의도한 오류 입력 유지 | plan.validateFields intentionalInvalid, engine DML | 길이 초과 원본을 유지하고 실제 Fake DML 오류 코드 비교가 MATCH가 되는지 검사 | 오프라인 검증 |
| B4 | 준비 실패·의존 중단·독립 진행 | engine prepare | 실패 fixture, 의존 시나리오 BLOCKED, 독립 fixture 성공이 각각 저장됨 | 오프라인 검증 |
| B5 | 실제 DML 경로·트랜잭션·부분 성공 | adapter composite collections, Action transaction/allOrNone | Fake 부분 실패/allOrNone rollback, 200건 제한 계약, per-record 모드에서 실제 요청/작업2개 기록 검사. 실제 REST 및 Data Loader 요청 분할/트랜잭션은 미검증. CSV를 한 트랜잭션이라고 보고하지 않음 | 오프라인 검증 / 환경 미검증 |
| B6 | Service 반환·예외·관찰 불가 | salesforce/apex.ts, engine execute/collect, execution/manual.ts | 상관 로그 정상/누락/중복/잘림/비USER_DEBUG 및 compile 오류 파싱, 공개 진입점 구조 검사, Fake 반환 비교. manual-evidence.test.ts에서 기존 ApexLog의 승인 스크립트·상관 ID·사용자·시각과 RETURN/Job 증거 및 별도 human 보고를 검사. 실제 Apex 로그는 미캡처 | 오프라인 검증 |
| B7 | Batch 범위 확대 차단·등록/완료 구분 | engine scopeQuery/approvedScopeIds, adapter.job | executeBatch/Job ID, 실제 실행 전 대상 확대시 Apex시작0, 미완료 Job→UNVERIFIABLE·정리차단, 누락 Job ID→UNKNOWN, 알려진 Job만 별도 승인 취소 검사. 기존 ID 누락·조회 한도 도달도 차단. 기간/후속 완료 조건은 통합 테스트 참조 | 오프라인 검증 / 일부 추가 확인 |

## C. 데이터·파일

| ID | 요구 | 구현 | 실제 검사·한계 | 상태 |
| --- | --- | --- | --- | --- |
| C1 | Excel 편집·행 정렬·재불러오기·재승인 | workbook, commands excel-import/apply | 원래 순서를 유지하며 논리키로 수정 연결; 기대값/값 변경·새 행·중복/삭제 참조 검증. 엔진 저장은 새 버전 승인 해제 경로 | 오프라인 검증 |
| C2 | 관계·타입·ID·정밀도·시간대 보존 | InputValue, workbook, imports verifier | null/omit/빈 문자열, 긴 소수 텍스트, 선행 0·문자열 ID·시간대·참조·Boolean 왕복. MS Excel 앱 자체 미실행 | 오프라인 검증 |
| C3 | 모호한 빈칸을 파괴적 Update로 바꾸지 않음 | WorkbookAmbiguity/resolveWorkbookImport | keep/omit/null/empty 미선택 거부, 선택별 적용, 동작 override와 fixture 독립 유지 | 오프라인 검증 |
| C4 | 부모/자식 Import 순서와 실제 ID | imports createImportBundle/mapImportResults | 부모 미연결 자식 차단, 연결 후 실제 ID 컬럼 생성, fixture/action 분리. extended 통합 테스트에서 command를 통해 Fake 실제 조회 후 ID 연결도 검사 | 오프라인 검증 |
| C5 | 성공/실패 혼재·재정렬·불명 연결 | imports result parser/verifyImportMapping | 전체 tuple 대응, 실패 별도, 동일 Name/행 순서 추정 금지, 명시적 매핑·없는 ID 거부, 타입별 실제값 비교. 소유권은 unresolved 유지하며, 명시적 사용자 확인과 실제 CreatedDate/CreatedById 확인 후에만 created로 변경하는 통합 테스트 포함 | 오프라인 검증 |
| C6 | 승인/ID 위조·수식·경로 공격 | workbook ZIP 검사, safePath, source 경로 검사 | 가짜 승인·소유ID, 수식·외부 링크, 매크로/ActiveX/embedding, ZIP traversal/절대경로/크기/압축률/엔티티 검사 | 오프라인 검증 |

SOAP Data Loader는 지원 경로이며 Bulk API/2.0은 이 버전의 파일 생성 계약이 아니다. 빈 문자열과 null을 구분할 수 없는 Data Loader 입력은 차단하고 도구/UI 경로를 사용한다. 원본 전송 CSV와 수식 보호 검토 CSV를 분리한다. 성공 CSV는 생성 소유권 증명이 아니므로 불명 수동 ID를 자동 정리하지 않는다.

## D. 결과·정리

| ID | 요구 | 구현 | 실제 검사·한계 | 상태 |
| --- | --- | --- | --- | --- |
| D1 | 결과/조건 없음 자동 통과 금지 | core/compare, engine.collect | 빈 assertion은 UNVERIFIABLE; 전달 전 오류/빈 동작은 NOT_EXECUTED. 반환 로그 없으면 returnCaptured=false. UI MATCH를 하드코딩하지 않음 | 오프라인 검증 |
| D2 | 의도한 오류도 승인 조건에 따라 MATCH | engine.collect error subject | 실제 Fake 오류 STRING_TOO_LONG 조건으로 MATCH 검사 | 오프라인 검증 |
| D3 | 준비/조회/비동기 문제와 업무 결함 분리 | ScenarioState, comparison execution context | 준비 실패/의존 중단, 미완료·Job ID 누락, UNKNOWN 유지, 완료 데이터가 생겨도 미실행/UNKNOWN을 성공으로 승격하지 않는 관찰 회귀 테스트 통과. 모든 조회 실패 변형은 미검증 | 오프라인 검증 / 일부 추가 확인 |
| D4 | AI 의견·사실·개발자 판정 분리 | Run.aiNotes/review/assertions, reports | AI note 추가가 비교를 바꾸지 않음; 검토 전 review 없음과 검토 대기, 명시적 판정 저장 검사 | 오프라인 검증 |
| D5 | MD/Excel 입력·before·after·기대·차이 일치 | reports/index.ts | 금액 입력/10 before/20 after/30 기대 및 MISMATCH를 실제 읽어 검사. 승인동작 override도 별도 출력 | 오프라인 검증 |
| D6 | 선택 전 자동 삭제 없음 | cleanup.decision pending, keep/approveCleanup | 결과 수집 후 pending, 승인 없는 cleanup 거부 | 오프라인 검증 |
| D7 | 다른 실행·기존·소유 불명 보호 | buildCleanup 정확한 ownership/runId | 기존/불명 ID를 미리보기에서 제외, child reference 추적 확인. 자동화 추가 생성 소유권을 임의 추정하지 않음 | 오프라인 검증 |
| D8 | 정리 부분 실패·타인 변경 충돌 | buildCleanup/cleanup, adapter relatedRecords | 다른 수정 발생 시 승인 거부, 일부 삭제 실패 시 남은 ID와 partial 상태 보존 | 오프라인 검증 |

`cleanup/extended.ts`와 `integration/extended.test.ts`에서 기존 레코드의 승인한 필드만 복구, 별도 사용자 승인, 승인 전후 현재값 변경 충돌, 알려진 Job만 현재 상태 해시로 별도 승인 취소하는 동작을 실제 Fake로 검증했다. 삭제·통지·외부 영향의 완전 복원은 보증하지 않는다.

## E. 복구·보안·UI

| ID | 요구 | 구현 | 실제 검사·한계 | 상태 |
| --- | --- | --- | --- | --- |
| E1 | 더블클릭·중복 프로세스 중복 쓰기 방지 | Store.lock + 상태 검사 | 동시 execute 2회에서 write1/operation1, restart.test.ts에서 별도 CLI 프로세스2개 경합 후 operation1/ID1을 검사. 강제종료 시점의 모든 변형은 미검증 | 오프라인 검증 |
| E2 | 결과 불명·부분 성공·중단 후 맹목 재실행 금지 | operation journal/change/gate/reconcile | 전달 후 연결 오류→UNKNOWN, pause/resume와 새 Engine 재생성 후에도 맹목 재실행 차단. 여러 완료 응답/개별 요청 복원, 요청 키·필드 불일치 조정 차단, 기존 상관 로그의 사용자·시각·BEGIN/END 확인으로 Service/Batch 복원 | 오프라인 검증 |
| E3 | 재시작 후 상태·ID·증거 보존 | Store/FakeAdapter persistence | 새 FakeAdapter의 ID 재조회, 새 Engine의 UNKNOWN 유지, 실제 서버 프로세스 SIGTERM/재시작 후 승인·ID·증거 유지 및 MATCH 수집 통과 | 오프라인 검증 |
| E4 | 무인증·Origin/Host·경로 차단 | server/http.ts, Store.safePath, source discovery | 파일 traversal/symlink, 실제 loopback HTTP 무인증401·Origin/Host/CSRF403·허용 밖 다운로드·sourceRoot 거부 검사. Chromium 보안 E2E 통과 | 오프라인 검증 |
| E5 | 비밀값 로그·UI·보고서 유출 방지 | adapter credential private/redact, core errors, reports redact | 가공 인증 오류 처리·Fake 상태에 토큰 없음, core.test.ts의 Bearer/accessToken/refresh_token/session 형식 제거 및 files-security에서 외부 오류·AI 메모의 인증 문자열이 MD/XLSX/증거로 나가지 않는지 확인. 모든 임의 회사 비밀에 대한 DLP 보장은 아님 | 오프라인 검증 / 추가 확인 |
| E6 | Windows 한글/공백·argv·프로세스 | salesforce/process, store atomicWrite | 한글/특수문자 argv, 가공 sf.cmd→Node, CRLF CSV, 한글/공백 파일 경로 검사. 실제 Windows 파일 잠금·종료·PowerShell 실행 미검증 | 환경 미검증 |
| E7 | Mod 없어도 핵심 동작 | engine/UI 독립, Skill과 고급 브라우저/CLI | Mod 없이 Chromium 12개 통과. 새 기본 Mod도 같은 엔진을 사용하고 불가 시 고급 경로를 유지한다. 정확한 2.1.287/2.1.300 공식 validate·mounted test 각 8개 통과, 실제 2.1.300 터미널 Fake 승인~정리 완료 | 오프라인 검증 / Windows 별도 확인 |
| E8 | 실제 엔진 연결·영속 UI | React→command→Engine, Playwright | 주요 검토/승인/실행/비교/판정/보고서다운로드/보존/정리/편집·새로고침, Excel 실제 편집 왕복, 수동 Insert 준비 미실행·CSV다운로드, 실제 소스 후보·메서드 오버로드 선택의 Chromium7개 E2E 통과 | 오프라인 검증 |

## 남은 플랫폼 확인과 기능 점검

- 실제 Sandbox: 이번 개발 요청에서 Org 업무 쓰기를 승인받지 않았다. Fake 성공을 실제 플랫폼 통합 성공으로 표현하지 않는다.
- Windows: 지원 코드와 가공 계약 검사는 있으나 네이티브 PowerShell·실제 sf.cmd·파일 잠금·종료 신호 검증은 별도다.
- Claude Mod: 새 Testforce 패널은 정확한 최소 2.1.287과 2.1.300에서 공식 validate와 mounted test 각 8개가 통과했다. 테스트는 process.run 응답을 가공하며 실제 Org 실행 검증과 다르다. 별도로 2.1.300 실제 터미널에서 HTTP 서버 없이 Fake 승인~정리를 완료했다. 과거 읽기 전용 Mod의 rollout 차단 결과와 구분한다.
- 실제 Data Loader/Excel 앱: 파일 계약을 Node로 검증했으며 실제 제품의 locale·설정·출력 파일을 이용한 통합 검증은 별도다.
- 수동 Anonymous/Service 스크립트 파일은 승인 내용·실제 ID 바인딩·상관 ID·manifest 해시·안내 파일이 일치하고 안내 생성 자체가 실행하지 않는다는 것을 extended 통합 테스트로 확인했다.
- Import 실제 조회 불일치와 오래된 기존 레코드의 생성 소유권 승격을 command 통합 테스트에서 거부했다.
- 비동기 후속 쿼리/각 시나리오 시간 요구조건은 구현되었으며, 플랫폼별 처리시간·후속 Job 조합과 복구 실패의 모든 변형에 대한 검증까지 완료했다고 주장하지 않는다.

## 2026-10-16 UI 개선 추가 검증

- A1/A4: `tests/integration/approval-interaction.test.ts`에서 이름 없이 실제 사용자 확인, `reviewed !== true` 거부, 제출한 승인자·시각 무시, 사용자 경로 아닌 요청 거부, 오래된 버전 거부를 검사했다. 실제 이름/날짜 입력을 제거해도 계획 해시와 Org 보호는 유지한다.
- D1/D4/D5: `tests/unit/result-tables.test.ts` 19개에서 저장된 결과만 표시, null/빈 값/미수집/생략/0/false, 목록·중첩 값·정밀 문자열·날짜, 반환값 미확보, 테스트 삭제와 정리 구분, HTML 이스케이프와 원본 불변을 검사했다.
- E8: Chromium E2E는 **12개 통과**. 기존 7개에 9→10 Update와 기대 11 비교, 이름 없는 1회 승인·전후 표·영속성, 편집 시 체크 해제, 모바일 메뉴/표 스크롤/키보드, Anonymous 자료 다운로드, 실행 전 조기 수집 이후 새 수집 안내를 추가했다.
- 실제 Org 쓰기 없이 Fake로 검증했으며 macOS Chromium 화면을 확인했다. Windows/Mod runtime은 이번 변경에서 새로 검증하지 않았다.

## 2026-10-16 Testforce Mod 중심 전환

위 브라우저 테스트 결과는 이전 단계의 실제 기록이다. 기본 흐름은 `/testforce` 분석·수정과 `/testforce-ui`의 세 단계이며 HTTP 서버를 요구하지 않는다. 당시 화면은 계획/결과/마무리였고 아래 후속 개선에서 계획/테스트/마무리로 바뀌었다. 고급 브라우저/CLI의 Excel·Import·상세 조정은 유지한다.

이 단계의 실행 기록: **Vitest 20개 파일·219개 통과, Chromium 12개 통과(24.8초), 공식 Mod 테스트 2.1.287/2.1.300 각각 8개 통과**. 실제 2.1.300 터미널에서도 Fake 계획 승인→준비→실행→비교→판정→정리 완료를 확인했다. 실제 Org를 사용한 증거는 아니다.

| 대응 | 구현·검증 파일 | 확인하는 내용 | 실제 실행 상태 |
| --- | --- | --- | --- |
| A1/A3/A4/E1 | `src/mod/bridge.ts`, `tests/integration/mod-bridge.test.ts` | 확인 체크, 계획/전체 상태 연결 토큰, 만료·재사용·더블클릭 거부, 가짜 승인자/시각 거부, 승인 없는 쓰기 차단 | 최종 Vitest 219개에 포함하여 통과. Fake/가공 응답 범위. |
| A2/A5/D6/D7/E2 | 같은 bridge 통합 테스트 | Production·Org/소스 변경 차단, UNKNOWN 재전송 금지, 정확한 미리보기 정리와 현재값 충돌, 선택 전 보존 | 최종 Vitest에 포함하여 새 진입점의 엔진 보호 검사 통과. |
| D4/D5/E8 | `plugin/mod/tests/status.test.ts` | 승인 버튼의 현재 버전·stdin 전달, 편집/새로고침 후 체크 해제, before9/after10/expected11 분리, 정리의 별도 확인, 실패 요청 자동 반복 금지 | 정확한 Claude 2.1.287/2.1.300 공식 `plugin test` **각 8개 통과**. process.run은 가공 응답이며 실제 Org 호출 없음. |
| E4/E5/E6 | `src/mod/main.ts`, bridge 테스트 | 1 MiB stdin 계약·토큰 argv 배제, 허용 명령만, 안전 경로/심볼릭 링크, 비밀 제거, 한글·공백 실제 로컬 프로세스 | 최종 Vitest에 포함하여 통과. 실제 Windows는 미검증. |
| E7/E8 | `scripts/install-testforce.mjs`, `tests/integration/mod-install.test.ts` | 개인 Skill+Mod 설치, Node 경로 설정, 소유 설치만 백업·갱신, 다른 소유자의 동명 설치 보존, 권한/workspace 불변 | 최종 Vitest에 포함하여 통과. |

Skill과 단계별 참조는 Mod bridge/action/token·브라우저 승인 요청·TTY 자동 입력을 통해 사용자를 가장하지 않도록 명시한다. 자연어 수정 후 패널 새로고침을 안내하고 일반 분석 때문에 `serve`를 시작하지 않는다. 2.1.300의 공식 검증은 `skill.prompt` 자동 열기가 조직 관리 Plugin에서 무시될 수 있다고 경고하며, 직접 `/testforce-ui` 호출을 유지한다. 정책을 우회하지 않는다.

## 시나리오 설명과 테스트 시작 추가 검증

작은 목록 → 시나리오 설명 → 필요한 기술 상세로 화면을 정리했다. 계획과 테스트 화면에서 제목을 눌러 같은 목적·조건·실행 방법·기대 결과를 읽을 수 있다. 선택 체크는 제목과 분리되어 있고 **테스트 시작**은 승인한 선택 묶음에 적용된다. 현재 상세로 열어 본 항목만 실행하지 않는다. 완료된 항목은 새 테스트로 이어지고 이전 증거를 보존한다.

이번 개선의 전체 Node 검증은 **20개 파일·228개 통과(34.59초)**, Chromium은 **12개 통과(31초)**다. 마지막 화면 수정 이후 공식 Mod 테스트·실제 터미널 검증의 최종 결과는 status.md의 최신 기록을 따른다. 위 역사적 구간의 219개·8개 수치는 해당 이전 실행의 기록으로 보존한다.

| 대응 | 구현·검사 | 확인하는 내용 | 검증 범위 |
| --- | --- | --- | --- |
| A1/A2/A3, B1/B4 | `ModBridge.runTests`, `tests/integration/mod-bridge.test.ts` | 실행 승인 없으면 준비도 금지, Org/소스 재검사, 준비 실패/의존 중단/독립 실행, 혼합 계획에서 사람 Insert 미전송 | `mod-bridge.test.ts`의 **26개 검사 실제 통과**. Fake/가공 연결 범위. |
| B7, D1/D3, E1/E2 | 같은 bridge 검사 | Batch 등록 후 자동 observe 반복 없음, 미완료는 UNVERIFIABLE, 완료 작업 재전송 금지, UNKNOWN 후 추가 쓰기 차단, 오래된 버튼 재사용 거부 | 같은 26개 통과에 포함. 실제 Org 호출 없음. |
| E8 | `plugin/mod/hooks/register.js`, 공식 Mod UI 테스트 | 기본 목록의 정보량, 제목 클릭은 설명만 열기, 선택 체크의 별도 Plan 변경, 테스트 중에도 설명 접근, 기술 상세 접기, 테스트 시작의 실제 dispatch와 새 테스트 안내 | 새 화면의 공식·대화형 실행 결과는 status.md의 이번 개선 기록을 따른다. 기존 UI8개 검증을 재사용하지 않는다. |

설치 위치와 Node 24 설정 계약은 그대로다. 설치기는 소유 설치에 `--update`를 적용하고 백업한다. Skill은 사용자에게 패널 **테스트 시작**을 안내하며 실행을 Claude에 다시 부탁하게 하지 않는다. 사용자용 `run-tests`/동작 토큰/승인 입력은 Skill이 호출하지 않는다. 작은 UI 때문에 승인·Org·소스·소유권 검사나 고급 Excel·Import·UNKNOWN 조정 경로를 제거하지 않는다.
