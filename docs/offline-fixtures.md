# 사용자 정의 오프라인 fixture

`fake` 모드는 Salesforce에 연결하지 않는다. 일반 프로젝트는 `Example__c` 같은 예제 스키마를 자동으로 사용하지 않는다. 사용자가 명시한 로컬 JSON에서 Describe, 가상 기존 레코드, Job 상태, 분석용 제약 설명을 읽는다. 이 파일은 회사 업무 데이터 대신 테스트용 합성 자료로 작성한다.

```powershell
node .\dist\cli\main.js schema --kind fixture
node .\dist\cli\main.js --workspace "C:\테스트 프로젝트" init --mode fake --fixture "fixtures\offline.json"
node .\dist\cli\main.js --workspace "C:\테스트 프로젝트" new --mode fake --target offline
node .\dist\cli\main.js --workspace "C:\테스트 프로젝트" context --run <run_id> --selection <클래스명> --objects <실제오브젝트API이름>
node .\dist\cli\main.js --workspace "C:\테스트 프로젝트" serve
```

스키마 계약에 맞는 최소 예시다. `Thing__c`와 `Label__c`는 설명용 가상 이름이며 제품에 특별 취급되는 필드가 아니다. 실제 프로젝트의 테스트용 스키마로 바꾼다.

```json
{
  "schemaVersion": 1,
  "schemas": [{
    "name": "Thing__c",
    "createable": true,
    "updateable": true,
    "deletable": true,
    "fields": [
      {"name":"Id","type":"id","nillable":false,"defaultedOnCreate":true,"createable":false,"updateable":false},
      {"name":"Label__c","type":"string","length":80,"nillable":false,"defaultedOnCreate":false,"createable":true,"updateable":true}
    ]
  }],
  "records": {
    "Thing__c": {
      "a01000000000001AAA": {"Id":"a01000000000001AAA","Label__c":"가상 기준정보"}
    }
  },
  "jobs": {},
  "constraints": []
}
```

`identity`에는 가상 Org ID·사용자·Sandbox 여부·이름을 선택적으로 넣을 수 있다. `mode`와 별칭은 JSON으로 바꾸지 못하며 항상 `fake`와 명령에서 지정한 target을 사용한다. `records` 맵의 키는 행의 `Id`와 같아야 하고, 오브젝트·필드는 Describe에 존재해야 한다. Job은 ID·상태·완료 여부가 일치해야 한다. 관계의 실제 가상 레코드는 같은 fixture에 준비한다. 문자열·소수 문자열·null은 JSON 타입을 그대로 사용한다.

입력은 workspace 내부의 일반 파일, 5 MiB 이하, 최대 중첩 30단계로 제한한다. 경로 이탈·심볼릭 링크·중복 이름·예약된 관리 키·알 수 없는 옵션을 거부한다. 함수, 실행 코드, 상태 저장 경로, `sourceFiles`, 인증값을 전달하는 계약이 아니다. 잘못된 fixture는 자동 보정하지 않는다.

초기화 시 검증한 사본을 `.workbench/offline-fixture.json`에 저장한다. 실행이 처음 어댑터를 사용할 때 `.workbench/runs/<run_id>/offline-fixture.json`으로 고정하므로 이후 workspace fixture 변경은 이미 시작한 실행에 반영되지 않는다. 새 fixture를 시험하려면 새 실행을 만든다. 데이터 상태와 실제 가상 ID는 각 실행의 `fake-org.json`에 저장되며 재시작 후 이어진다. ID 생성기는 기존 가상 레코드를 덮어쓰지 않는다.

가상 배포본은 항상 해당 실행의 현재 소스 snapshot을 사용한다. **실제 Org 배포본 확인이 아니다.** JSON fixture가 Apex를 해석하거나 Trigger·Flow·Service·Batch 로직을 자동 실행하지 않는다. 범용 DML·조회·관계·부분 실패·Job 조회는 어댑터를 통해 동작한다. 임의 Apex 호출은 실행 가능한 시뮬레이터가 구성되지 않은 경우 `FAKE_APEX_NOT_CONFIGURED`를 반환하며 성공을 만들지 않는다. 제품 자체의 Service·Batch 테스트는 별도의 테스트 전용 `FakeAdapter` 동작 함수를 주입해 검증한다. 이 함수는 일반 JSON 파일이나 웹 API로 불러오지 않는다.

`demo`와 브라우저의 **오프라인 예제 열기**는 명시적인 별도 가상 소스에서만 예제 Trigger 동작을 제공한다. 사용자 정의 fixture 설정과 실제 `live` 연결을 덮어쓰지 않는다. `init --mode live --fixture ...`는 거부한다.

검증: `tests/unit/cli-fixture.test.ts`는 실제 CLI 실행, 한글·공백 경로와 CRLF/BOM JSON, run별 설정 고정, source snapshot, 경로·스키마 공격, 예제 분리, seeded ID 충돌 방지, `sf.cmd`의 안전한 Node 진입점 실행을 다룬다. Windows 분기 계약은 macOS에서 가상 wrapper로 검증했으며 Windows 네이티브 실행을 대신하지 않는다.
