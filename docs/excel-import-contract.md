# Excel·Data Loader 파일 계약

확인일: 2026-10-15. 이 문서는 실제 구현한 `dist/workbook/index.js`, `dist/imports/index.js`, `dist/reports/index.js`의 계약이다. 테스트는 Node에서 생성·수정한 XLSX/CSV fixture를 사용한다. Microsoft Excel 앱, Windows Data Loader, 실제 Sandbox 업로드는 별도 통합 검증이 필요하다.

## 계획 Excel

`exportPlanWorkbook(plan, path)`는 `사용안내`, `시나리오`, 오브젝트·단계별 `입력_N`, Update 등 별도 입력이 있는 `동작_N`, `기대결과`, `참조안내` 시트를 만든다. 머리글·필터·고정 행·텍스트 형식을 적용한다. 필드 API 이름은 실제 입력 열이고 논리키·시나리오·소유구분·기존 ID·의존키는 로컬 관리 열이다. 이 Excel은 업로드 파일이 아니다.

`importPlanWorkbook(originalPlan, path)`는 새 후보 `plan`, `changes`, `ambiguities`를 반환한다. 원본 계획이나 승인·수집 증거는 수정하지 않는다. 엔진은 후보에 메타데이터/참조/권한 검증을 적용하여 새 버전으로 저장하고 재승인을 요구한다. 숨김 `_contract`는 편의용 식별 정보이며 권한 경계가 아니다. 내용은 엔진이 보유한 원본으로 재계산한 값과 정확히 일치해야 한다. 승인/ID/증거 시트를 추가하거나 기존 ID·소유구분·오브젝트·단계를 바꾸면 거부한다. Excel에 승인 이벤트를 기록할 경로가 없다.

입력 행은 논리키로 대응한다. 물리적 행 정렬은 계획의 실행 순서를 변경하지 않는다. 중복 키는 오류이며 빈 키를 가진 새 행은 새 `new_...` 키를 발급하고 추가 변경으로 보여준다. 행을 복제할 때 복제본의 키를 비운다. 삭제한 행은 변경점으로 표시하고 남아 있는 동작·관계의 참조가 깨지면 거부한다. 새 오브젝트·단계는 Skill 또는 브라우저에서 계획에 추가한 뒤 다시 내보낸다. Excel에서 동작의 `recordKeys`에 새 키가 들어가지 않았다면 새 행을 테스트 동작에 임의 포함하지 않는다.

입력 값은 기존 타입을 따르며, 새 필드의 기본 타입은 문자열이다. `{ "$value": true }`처럼 구조화 타입을 명시할 수 있다. 관계는 `{ "$ref": "parent-key" }`로 표현한다. 이 예약 표현이 실제 업무 문자열이면 `{ "$value": "원본 문자열" }`로 입력한다. 기대값·동작·관찰 조건은 열 이름에 표시한 JSON 계약을 사용하며 `eval`하지 않는다.

변경하지 않은 빈 셀은 원래의 `null`, `omit`, 빈 문자열을 각각 보존한다. 기존 값이 있던 셀을 비우면 즉시 파괴적 Update를 만들지 않는다. 재불러오기 결과에서 각 셀의 처리 방법을 `keep`(기존 요청 유지), `omit`(필드 생략), `null`(값 지우기), `empty`(빈 문자열) 중 선택한다. 엔진은 미해결 항목이 있으면 저장·실행하지 않는다. `resolveWorkbookImport`가 이 선택을 적용한다. 문자열 ID, 선행 0, 날짜·시간대 문자열, 정확한 소수 문자열을 숫자로 바꾸지 않는다. Excel이 숫자형으로 이미 손상시킨 값은 복원할 수 없으므로 텍스트 셀로 편집해야 한다.

입력은 일반 `.xlsx`, 최대 20 MiB로 제한한다. ZIP 항목 수 5,000, 전체 압축 해제 크기 100 MiB, 단일 항목 25 MiB, 과도한 압축 비율을 검사한 후 ExcelJS가 읽는다. ZIP 내용을 디스크에 추출하지 않는다. 경로 순회, 암호화 항목, 매크로·바이너리·ActiveX·임베딩·외부 링크·XML 외부 엔티티·수식 셀을 거부한다. 다른 Excel 양식을 자동 추정하지 않는다. 내부 API 호출자는 파일 경로를 승인 workspace 경계 내로 먼저 검증해야 한다.

## Data Loader

첫 지원 모드는 **SOAP API**이며 Bulk API·Bulk API 2.0은 이 생성기에서 지원하지 않는다. 공식 안내에 따르면 SOAP의 `Insert Null Values` 설정은 매핑된 빈값을 null로 저장하는 동작에 영향을 준다. Bulk 경로는 빈값과 명시적 null의 방식이 다르므로 혼용하지 않는다. [Salesforce 공식 설명](https://help.salesforce.com/s/articleView?id=000385696&language=en_US&type=1), [Data Loader Guide](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_data_loader.pdf).

`createImportBundle(plan, bindings, phase, outputDir, scenarioId?)`는 `fixture`와 `action` 파일을 따로 만든다. 승인과 Org/메타데이터 검증은 호출 엔진의 책임이다. 부모 ID가 미연결이면 자식 파일을 만들지 않고 막힌 논리키와 이유를 반환한다. 부모를 업로드하고 성공 결과 ID를 연결·Org 재조회한 뒤 함수를 다시 호출하면 자식 파일을 만든다. 순환 참조는 부모 생성 후 별도 관계 Update 계획으로 분리한다. 이미 ID가 연결된 Insert는 재생성하지 않는다.

포함 필드 집합과 null 설정별로 파일을 분리한다. `omit` 필드는 열에서 제외한다. 명시적 null을 가진 파일은 빈 셀과 `Insert Null Values: 켜기`, 나머지는 `끄기`를 안내한다. 원래 빈 문자열을 유지하는 계획은 SOAP Data Loader에서 의미를 보장할 수 없으므로 이유를 보여주고 파일 생성을 차단한다. 도구 실행 또는 명시적 null로 수정·재승인하는 경로를 사용한다. 필드를 자동 보정하지 않는다.

CSV에는 실제 API 필드만 있다. 논리키·원본 tuple·파일 해시는 별도 `manifest.json`에 저장된다. UTF-8 BOM과 CRLF를 사용한다. 실제 업로드 `.csv`는 승인 원본 문자열을 보존하고, 사람 검토용 `.review.csv`는 수식처럼 보이는 값 앞에 작은따옴표를 붙인다. 원본 CSV는 Data Loader로만 읽고 스프레드시트 앱에는 검토 파일을 연다. 검토 파일은 업로드하면 안 된다. 안내서가 실제 생성한 파일별 오브젝트·DML 종류·필드·행수·null 설정을 나열한다.

Data Loader가 성공/실패 파일을 각각 생성한다는 계약을 사용한다. 전체 반향 입력 필드의 값이 유일하게 일치할 때만 자동 대응 후보를 만든다. Name 하나나 행 순서로 추정하지 않는다. 완전한 대응 정보가 없거나 동일 입력 행이 여러 개면 `unresolved`를 반환하고 사용자가 명시적으로 키와 ID를 연결한다. `mapImportResults`의 결과는 `requiresVerification: true`인 후보이며 실제 DB 재조회 전 성공 또는 소유권 증명이 아니다. 실패 행은 오류와 함께 따로 유지한다. 파일 완료 보고만으로 다음 검증을 통과하지 않는다. [공식 실행·결과 파일 절차](https://developer.salesforce.com/docs/platform/data-loader-impl/guide/inserting-updating-or-deleting-data.html).

SOAP 요청 최대 크기와 Data Loader의 요청 분할을 고려해야 한다. 하나의 CSV가 한 Salesforce 트랜잭션을 뜻하지 않는다. `allOrNone`·단일 트랜잭션 검증이 핵심인 시나리오는 해당 정책을 보장하는 도구 DML 경로를 사용한다. Data Loader 요청 단위가 증명되지 않은 경우 보고서에 트랜잭션 검증 완료라고 기록하지 않는다.

## 결과물

`generateReports(run, outputDir)`는 한국어 사실 보고서, 결과 Excel, 계획 Excel, 구조화 증거를 생성한다. 입력/실행 직전 재조회/실행 후 조회를 분리하고, AI 의견·수동 관찰·자동 비교·개발자 판정을 별도 기록한다. 결과 없는 검사는 자동 일치로 처리하지 않는다. 오프라인 모드는 모든 보고서에 실제 Org 증거가 아님을 표시한다. 정리 미선택은 선택 대기로 남는다. 큰 상세 값은 `evidence/report-details.json`으로 연결하며 반환 상태 없는 값을 만들어내지 않는다.

## 라이브러리와 실행 검증

설치 패키지에서 ExcelJS 4.4.0, csv-parse 7.0.3, csv-stringify 6.9.0, yauzl 3.4.0과 각 MIT 라이선스를 확인했다. [ExcelJS 공식 저장소](https://github.com/exceljs/exceljs) 및 [yauzl 공식 API](https://github.com/thejoshwolfe/yauzl)를 참고했다. ExcelJS는 직접 수식 계산을 요청하지 않으며 읽기 전 별도 ZIP/실행 요소 검사를 수행한다. 취약점 검사는 전체 lockfile의 `npm audit` 결과를 따른다.

개발 단계의 파일 검증 23개가 통과했다. 이 배포본에는 테스트 파일·테스트 실행 도구를 포함하지 않는다. ZIP 크기·경로·매크로·외부 엔티티 차단, 실제 조회값의 타입별 비교, ExcelJS의 UUID 사용 경로까지 포함한다. 한글·공백을 가진 임시 경로, CRLF CSV, XLSX 편집 왕복을 Node에서 검증했다. 실제 Office 편집과 Windows 파일 잠금, 실제 Data Loader success/error 응답은 이 테스트의 범위가 아니다.


2026-10-15 의존성 점검에서 ExcelJS의 uuid 8.3.2에 [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)가 보고되었다. ExcelJS 소스의 사용 지점은 인자 없는 `v4()`이며 취약점의 buffer 입력 경로를 사용하지 않는다. 그래도 `exceljs -> uuid 11.1.1`의 한정 override를 권고한다. [uuid 11.1.1 공식 package exports](https://github.com/uuidjs/uuid/blob/v11.1.1/package.json)가 CommonJS `require`를 제공함을 확인했다. 개발 단계에서 실제 조건부 서식 직렬화를 통해 해당 의존성 호출 경로를 검증했다. 이 배포본은 해당 override를 적용한다.

`verifyImportMapping(mapping, actualRow, describe?)`는 ID·문자열·Boolean·Decimal·시간대 날짜·null을 실제 재조회값과 비교한다. 이 함수는 반드시 `ownership: unresolved`를 반환한다. 성공 CSV의 전체 입력값과 현재 레코드가 일치하더라도, CSV 자체가 이번 실행의 신규 생성 증거가 되지는 않는다. 수동·불명 결과 ID는 기본 자동 정리에서 제외한다. 엔진이 더 강한 생성 근거를 별도로 확보하지 않았다면 파일만으로 소유 구분을 승격하지 않는다.


Update 동작은 `Action.fieldOverrides[logicalKey]`를 사용할 수 있다. Excel의 `동작_N` 시트는 이 값을 준비 레코드의 `fields`와 구분하여 편집한다. 지정하지 않은 경우 기존 필드를 보여주되 변경하지 않으면 불필요한 override를 추가하지 않는다. 동작 표와 JSON을 서로 다르게 동시에 변경하면 충돌로 거부한다. 동작 입력의 빈칸은 동작 ID까지 포함한 고유 식별자로 해결하며 fixture 값을 바꾸지 않는다. Data Loader 동작 CSV와 결과 보고서도 이 입력 재정의를 사용한다. 기존 데이터의 간접 변경 범위 `existingImpactIds`는 원본에서 보존하며 Excel의 신규 행은 빈 목록으로 시작한다. 영향 범위 변경은 브라우저/Skill 계획 편집과 별도 승인을 사용한다.

uuid override 적용 후 `npm ls uuid`에서 `exceljs@4.4.0 -> uuid@11.1.1 overridden`을 확인했고, 23개 파일 테스트를 다시 실행하여 통과했다. 이 결과에는 ExcelJS의 UUID를 호출하는 확장 조건부 서식 직렬화가 포함된다.

외부 오류/AI 메모에 포함된 camelCase accessToken과 Salesforce 세션 문자열을 보고서에서도 제거하도록 공통 인증정보 제거기를 적용했다. 회귀 테스트는 MD, 결과 workbook, 구조화 evidence 모두에서 비밀 문자열이 사라지는지 확인한다.
