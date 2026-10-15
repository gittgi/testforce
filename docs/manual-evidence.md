# 사람 Service·Batch 실행과 로그 증거

승인·준비 후 브라우저의 **승인 스크립트·안내서 생성**을 사용한다. 엔진은 배포본과 로컬 코드 정합성을 다시 확인하고, Batch 대상 ID·기존 데이터 영향·확대 승인도 재확인한다. 생성한 `.apex` 파일과 README를 따라 개발자가 실행한다. 준비용 승인은 도구가 대신 Apex를 실행하는 권한이 아니다.

Service·Batch 스크립트에는 실행 자료별 상관 ID와 `BEGIN/END`, 필요한 `RETURN/JOB` 표식이 있다. 승인한 템플릿의 논리키는 실제 ID로 바뀌며 스크립트 SHA, 계획 버전·해시, Org·사용자, 생성 시각을 manifest에 보관한다. 기존 Anonymous 스크립트는 원문 그대로 제공하고 임의 표식을 추가하지 않는다.

이미 존재하는 **ApexLog ID**를 알고 있으면 브라우저의 **수동 Service·Batch 로그 증거**에서 자료 묶음 ID와 `동작 ID=ApexLog ID`를 입력한다. Skill은 동일한 명령을 사용할 수 있다.

```powershell
node .\dist\cli\main.js --workspace "C:\테스트 프로젝트" manual-evidence --run <run_id> --version <version> --bundle <bundle_id> --file "logs.json"
```

`logs.json`의 계약은 아래와 같다. 입력 파일에는 반환값이나 성공 판정을 넣지 않는다. Skill이 사용자에게 받은 실제 로그 ID로 작성할 수 있다.

```json
{"logs":{"service-action":"07L000000000001AAA"}}
```

엔진은 다음을 확인한 뒤 원본 로그와 조회 결과를 새 `evidence/manual-apex-….json`에 저장한다.

- 현재 접속 Org·사용자가 승인 계획과 일치하는지.
- 자료 묶음이 현재 run·계획 버전·해시·시나리오에 속하는지.
- 파일 내용의 SHA와 승인 동작·현재 ID 바인딩에서 다시 생성한 스크립트가 일치하는지.
- 로그 사용자가 승인 사용자이고 시작 시각이 자료 생성 이후인지.
- 해당 상관 ID의 완전한 단일 표식이 있고, 필요한 반환값 또는 Job ID가 확보되었는지.

Batch는 상관 로그로 확인한 Job만 조회한다. Job 등록과 처리가 끝났다는 사실은 별개다. 조회가 실패하면 확인된 등록 ID를 남기고 상태를 다시 관찰할 수 있다. 기존에 저장한 동작 증거를 다른 로그로 덮어쓰지 않는다. 같은 묶음·로그 재요청은 기존 증거를 유지한다.

이 경로는 읽기 전용이며 Apex 실행, Salesforce 데이터 쓰기, TraceFlag·DebugLevel 변경을 하지 않는다. 기존 로그가 없거나, 잘림·중복·다른 사용자·다른 시각·상관 ID 불일치가 있으면 결과를 확정하지 않는다. 임의 Anonymous 로그에서 반환값을 추론하지 않는다. 사용자 화면 관찰과 실행 오류에 대한 수동 메모는 별도 증거로 남길 수 있지만 자동 RETURN 증거를 대신하지 않는다.

**로그 수집과 사람 완료 보고는 별도다.** 실제 사용자·경로·완료 사실은 브라우저나 터미널의 `human` 대화에서 기록한다. 실제 실행 시각을 알 때만 `executedAt`을 입력한다. 입력하지 않으면 미확인으로 남고, 보고 제출 시각을 실행 시각으로 표시하지 않는다. 진행 중 Job은 사람 완료 보고 이후에도 비동기 대기로 유지한다. 이후 `collect`·`observe`로 DB 실제값과 승인 기대값을 비교한다.

검증: `tests/integration/manual-evidence.test.ts`는 가공한 실제 로그 문법을 Fake Adapter의 공통 파서로 읽어 Service 반환값, Batch 등록, 수동 보고 분리, 잘림·중복·다른 상관 ID·오래된 시각·다른 사용자, 파일/manifest 변조, 기존 증거 보존, 준비 이후 배포본·Batch 범위 변경을 검사한다. 실제 Sandbox 로그를 캡처한 시험이 아니다.
