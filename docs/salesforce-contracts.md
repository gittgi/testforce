# Salesforce 연결부 계약

확인일: 2026-10-15. 초기 제품 개발에서는 실제 Org를 사용하지 않았다. 이후 사용자 요청으로 Developer Edition 유형을 실제 조회하고 별도 예제를 배포했다. 아래 계약 테스트의 응답은 **로컬에서 작성한 가공 응답**이다. 실제 Sandbox 캡처 응답이라고 표시하지 않는다.

## 확인한 도구

로컬 `sf --version`: `@salesforce/cli/2.128.5 darwin-arm64 node-v25.8.1`. 설치된 `@salesforce/plugin-apex`는 `3.9.29`이다. 제품의 Node 24 실행과 Salesforce CLI 자체의 번들 Node 버전은 별개이다. `sf apex run --help`, `sf data query --help`, `sf sobject describe --help`, `sf org display --help`로 실제 플래그를 확인했다. 이 문서의 버전 확인은 Windows 실행 검증이 아니다.

사용 명령은 다음과 같다. 매 호출에 `--target-org <명시적 대상>`과 `--json`을 넣으며 기본 Org에 의존하지 않는다.

- `sf org display`: 인증 재사용 전용. 결과에는 accessToken이 포함되므로 어댑터 private 필드에서만 사용하고 원문을 화면·분석·로그·파일에 출력하지 않는다. `--verbose`는 사용하지 않는다.
- `sf apex run --file <임시 승인 스크립트> --api-version <지원 버전>`: 실행 파일을 UTF-8/0600으로 임시 저장해 호출하고 삭제한다. 승인 엔진이 확인한 내용 그대로 사용한다.
- `sf data query`와 `sf sobject describe`의 명령 계약은 확인했으나, 제품의 조회·Describe·데이터 변경은 같은 CLI 인증을 재사용하는 공식 REST API로 구현했다. 따라서 페이지 처리와 레코드별 부분 결과를 직접 보존한다.

명령은 shell=false인 Node spawn으로 실행한다. 자식 SF 프로세스에만 `SF_DISABLE_TELEMETRY=true`, `SF_AUTOUPDATE_DISABLE=true`를 전달하며 전역 설정은 바꾸지 않는다. [공식 telemetry 설정](https://developer.salesforce.com/docs/platform/sfdx-setup/guide/sfdx-dev-cli-telemetry.html)과 [자동 업데이트 설정](https://developer.salesforce.com/docs/platform/sfdx-setup/guide/sfdx-setup-disable-autoupdate.html)을 확인했다. 문자열 명령 결합, cmd.exe, PowerShell 스크립트 평가를 사용하지 않는다. Windows `sf.cmd`는 알려진 CLI Node 진입점을 확인한 뒤 Node로 직접 실행하며, 알 수 없는 wrapper는 오류로 종료한다. 한글·공백·따옴표·개행·셸 특수문자는 argv 데이터로 전달한다. Windows 경로 해석 로직은 macOS에서 가공 wrapper로 검사했으며 실제 Windows 프로세스 실행은 별도 검증이 필요하다.

## 공식 자료 및 설치 패키지 근거

- [Salesforce CLI Apex plugin](https://github.com/salesforcecli/plugin-apex): `apex run`.
- [Salesforce CLI Data plugin](https://github.com/salesforcecli/plugin-data): 조회·데이터 명령 계약.
- [sobject describe 명령](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_sobject_describe.html): Describe 출력과 Tooling 구분.
- [sObject Collections](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-composite-sobjects-collections.html): API 42.0 이상.
- [Collection create](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-composite-sobjects-collections-create.html): 최대 200건, allOrNone, 입력 순서의 SaveResult, 레코드별 success/errors.
- [Collection update](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-composite-sobjects-collections-update.html): PATCH 최대 200건.
- [Duplicate Rule Header](https://developer.salesforce.com/docs/platform/api-rest/guide/headers-duplicaterules.html): 제품은 우회 allowSave 헤더를 설정하지 않는다.

설치된 `plugin-apex/lib/commands/apex/run.js`, `lib/reporters/runReporter.js` 및 `apex-node/lib/src/execute/executeService.js`를 읽어 계약을 확인했다. `apex run`은 SOAP executeAnonymous의 요청 단위 DebuggingInfo를 받아 `logs`를 반환한다. 이 경로는 TraceFlag·DebugLevel 생성이나 log tail 호출을 사용하지 않는다. 설치 버전이 달라지면 doctor와 계약 검증을 다시 수행한다.

## JSON 및 REST 계약

CLI 정상 응답은 `{status:0,result:{...}}`이다. 프로세스 exit code만으로 성공 처리하지 않는다. Apex 오류 응답은 `{status:1,data:{compiled,success,compileProblem,exceptionMessage,logs,...}}`일 수 있다. 문법 오류와 실행 예외를 별도로 해석한다. 형식이 다르면 실행 성공으로 추정하지 않는다.

API 버전은 `/services/data/` 목록과 프로젝트 `sourceApiVersion` 또는 인증 결과 버전을 대조한다. 지정 버전이 지원되지 않으면 차단하고 프로젝트 파일을 변경하지 않는다. 프로젝트 버전이 없으면 서버가 광고한 지원 버전을 선택한다.

Organization의 `Id, Name, IsSandbox, OrganizationType`를 실제 조회한다. 인증 Org ID 불일치는 차단한다. IsSandbox=true 또는 OrganizationType=Developer Edition이면 비운영 Org로 허용한다. Scratch Org는 `sf org display`의 devHubId(설치된 plugin-org 소스상 Dev Hub 사용자 이름)를 연결 힌트로만 사용하며, 해당 Hub에 명시적 target-org로 `ActiveScratchOrg.ScratchOrg, ExpirationDate`를 조회해 대상 ID와 유효기간을 확인한다. Production·유형 미확인·Scratch 증거 불일치/만료/조회 실패는 다른 허용 근거가 없으면 차단한다. 매 실행 직전 identity를 갱신하며 승인 엔진은 계획 Org ID·사용자와 비교한다. 어댑터 인스턴스도 최초 identity의 Org ID·사용자를 고정하여 검증과 쓰기 사이 별칭 변경을 차단한다. Apex CLI 호출에는 실제 인증 사용자 이름을 명시한다.

- Describe: `/sobjects/{object}/describe`, 필드 타입·필수 여부·길이·정밀도·CRUD·참조·Picklist·RecordType·자식 관계를 구조화한다.
- Query: `/query?q=...`, Tooling `/tooling/query?q=...`. `done` 및 `nextRecordsUrl`로 페이징한다. 다음 URL은 동일 인증 호스트와 선택 API 경로만 허용한다. 제한된 재시도는 읽기만 수행한다.
- DML: `/composite/sobjects`, POST/PATCH/DELETE. 단일 요청 최대 200건. 더 큰 단일 트랜잭션을 요청하면 거부하며 여러 HTTP 요청을 한 트랜잭션이라고 표시하지 않는다. 반환 결과 길이·success·errors·실제 ID를 확인한 후 순서가 계약으로 보장된 응답을 논리키에 연결한다. 성공인데 ID가 없거나, 성공·오류가 서로 모순되거나, 수정·삭제의 응답 ID가 요청과 다르면 결과 불명으로 보존한다. 이는 수동 Import 결과 행 순서를 신뢰하는 것과 다르다.
- Apex 배포본: Tooling ApexClass/ApexTrigger `Body, ApiVersion`을 메모리에서 조회한다. 사용자 소스를 덮어쓰지 않는다. 비교 정규화는 BOM 제거와 CRLF→LF만 제공하며 API 버전은 따로 비교한다.
- AsyncApexJob: Id, Status, NumberOfErrors, JobItemsProcessed, TotalJobItems, ParentJobId, ExtendedStatus. 등록·완료·업무 결과는 서로 다르다.

REST 쓰기는 자동 재전송하지 않는다. 연결 오류·타임아웃·해석 불가능한 응답은 결과 불명으로 처리한다. 최상위 엔진은 의도를 먼저 기록하고 응답을 즉시 저장해야 한다. 로컬 op_id는 Salesforce 멱등성 키가 아니다.

## 메타데이터와 제약

ValidationRule, DuplicateRule, 활성 ApexTrigger, 활성 FlowDefinition/Flow.Metadata를 읽기 전용으로 조회한다. Org API 버전·사용자 권한에 따라 특정 객체·필드 조회가 실패할 수 있으며 이를 명시적인 제약 조회 오류로 제공한다. 관련 Flow 검색은 반환 metadata의 실제 object 참조 문자열을 사용하며 최대 100개의 활성 Flow를 읽는다. 그 한도를 넘으면 제한을 기록한다. 이 분석은 정적 제약 해결기나 모든 자동화의 완전한 그래프가 아니다.

Describe는 API 저장 제약이며, 화면 레이아웃·컴포넌트 입력 조건을 완전히 대체하지 않는다. 조회 실패를 '규칙 없음'으로 해석하지 않는다. 자동화와 Duplicate Rule을 비활성화하거나 우회하지 않는다.

## Apex 값·반환 계약

Service 인자와 생성자 인자는 JSON.serialize 형식의 데이터 문자열로 만들어 `JSON.deserialize(..., ApprovedType.class)`로 해석한다. 타입·클래스·메서드 식별자는 검증하고 문자열은 Apex 리터럴 규칙으로 escape한다. Batch는 `Database.executeBatch(new ExistingClass(...), scope)`로 실제 진입한다. private 접근이나 보조 클래스 배포를 하지 않는다.

로그의 `SFTW:<correlation>:BEGIN`, `RETURN:<JSON>` 또는 `JOB:<JSON>`, `END`를 정확히 한 번씩 확인한다. 실제 USER_DEBUG 행만 읽고, 소스 에코·다른 상관 ID·중복·누락·잘림은 반환값 확보로 처리하지 않는다. 예외를 catch해 삼키지 않으므로 실제 업무 코드의 트랜잭션 의미를 바꾸지 않는다. 승인된 임의 Anonymous 스크립트는 그대로 실행하며 반환 marker가 없으면 값을 확보했다고 주장하지 않는다. session credential은 증거로 반환하기 전에 제거한다.

## 오프라인 어댑터

FakeAdapter는 동일 SalesforceAdapter 인터페이스를 구현하지만 `mode=fake`를 고정하고 네트워크·CLI를 호출하지 않는다. 스키마·소스·동작은 명시적인 fixture 설정으로 전달한다. 제품 코드에 특정 업무 필드나 문자열 동작을 넣지 않는다. fixture에 없는 Apex 동작은 `FAKE_APEX_NOT_CONFIGURED`로 보고한다. 생성 ID·부분 실패·allOrNone·관계·Job·상태 파일은 결정론적 로컬 시뮬레이션이며 실제 Org 증거로 사용할 수 없다. Describe상 숫자 필드의 조회 비교는 Decimal을 사용해 정확한 숫자 문자열이 사전식 문자열 순서로 비교되지 않게 한다.

소스 호출 검증은 public/global, 정적/인스턴스, 정확한 인자 타입 오버로드, 생성자, void 반환 및 Batchable/start 구조를 확인한다. 완전한 Apex 파서가 아니며 다형성·동적 호출·메서드 내부 영향 범위를 증명하지 않는다. 확인할 수 없는 구조는 추측해서 실행하지 않고 공개 진입점 검토를 요청한다.

### 숫자 증거와 기존 로그 복구 (2026-10-15 추가)

REST 원문과 상관 ID가 붙은 Apex 반환 JSON은 손실 없는 숫자 파서로 읽습니다. JavaScript Number로 변환한 뒤 십진 값이 달라지는 Decimal/Long 토큰은 원래 숫자 문자열로 저장합니다. 예를 들어 `9007199254740993` 및 `0.123456789012345678`은 정확한 문자열로 남고, 일반 건수와 `0.1`은 숫자로 유지됩니다. 비교 엔진의 숫자 비교는 Decimal을 사용합니다. 수신 숫자의 이미 손실된 표시를 원래 값으로 추정하지 않습니다.

결과 불명 Apex는 사용자가 지정한 **기존 로그 ID**에서만 복구 증거를 수집할 수 있습니다. 설치된 `sf apex get log --help` 및 plugin-apex 3.9.29의 `commands/apex/get/log.js`, apex-node `logs/logService.js`를 확인했습니다. `sf apex get log --log-id <id> --api-version <verified> --target-org <verified username> --json`은 `result: [{log: "..."}]`를 반환하며 기존 Tooling ApexLog/ID/Body를 조회합니다. `--output-dir`, `--number`, tail을 사용하지 않고 TraceFlag 또는 DebugLevel을 만들지 않습니다.

Tooling `ApexLog`에서 `Id, LogUser.Username, StartTime, Status`를 읽고 인증 사용자와 대조합니다. 메타데이터 접근이 불가능하거나 로그가 보존되지 않았으면 복구를 단정하지 않습니다. `Status=Success`와 정확히 한 번 나타나는 순서가 맞는 실행 상관 `BEGIN/END` 및 반환·Job 마커를 모두 검사하며, 잘림·중복·다른 실행 상관·FATAL_ERROR는 확인 불가입니다. 엔진은 해당 로그 시각과 원래 작업의 전송 시각도 대조합니다. 임의 Anonymous Apex에 마커가 없으면 기존 로그만으로 성공을 추정하지 않습니다.

공식 참고: [plugin-apex](https://github.com/salesforcecli/plugin-apex), [ApexLog Tooling API](https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_apexlog.htm). ApexLog 공식 웹페이지는 이 개발 환경에서 본문 추출이 되지 않았으므로 설치 패키지 구현과 구조화된 가공 계약 테스트를 함께 확인했습니다. 실제 Org 로그 조회는 실행하지 않았습니다.
