# 아키텍처

## 실행 구조

Testforce의 기본 진입점은 Claude Code의 `/testforce` Skill과 `/testforce-ui` Mod다. Skill은 기존 세션에서 분석·자연어 수정을 수행하고, Mod는 계획·테스트·마무리 세 단계의 사용자 화면을 제공한다. Mod가 필요할 때 Node bridge를 실행하므로 기본 사용에는 상시 HTTP 서버가 필요 없다.

Mod bridge·CLI·브라우저는 `src/server/commands.ts`를 거쳐 동일한 `Engine`을 호출한다. 고급 브라우저가 필요한 경우에만 `serve`가 Fastify와 빌드된 React/Vite UI를 제공한다. 실행 데이터는 선택 workspace의 `.workbench/runs/<run_id>/`에 저장한다. 설치된 Skill/Mod 폴더에는 사용자 실행 데이터를 저장하지 않는다.

| 구성 | 구현 | 역할 |
| --- | --- | --- |
| 런타임 계약 | `src/core/model.ts`, `plan.ts`, `hash.ts` | strict Zod, 참조·계획 검사, 결정론적 해시, 논리키 치환 |
| 저장소 | `src/core/store.ts` | 원자적 JSON 저장, 프로세스 잠금, 안전한 상대경로, 증거 인덱스 |
| 분석 | `src/analysis/index.ts` | sfdx 구조 탐색, 후보/오버로드, 현재 소스 스냅샷, 구조화 컨텍스트 |
| 엔진 | `src/execution/engine.ts` | 계획 전이, 승인 게이트, 준비·실행·관찰·비교·정리·복구 |
| Salesforce 연결 | `src/salesforce/` | 명시적 SF 대상, CLI 인증/Apex, 공식 REST 조회/Describe/DML, Fake |
| Excel | `src/workbook/index.ts` | 생성 양식 왕복, 수정 비교, 빈칸 결정, ZIP/수식 검사 |
| Import | `src/imports/index.ts` | SOAP Data Loader 파일 묶음, 의존 파동, 결과 후보/검증 |
| 보고서 | `src/reports/index.ts` | 증거 기반 한국어 MD, 세 시점 Excel, AI/판정 분리 |
| CLI/HTTP | `src/cli/`, `src/server/` | 터미널 대화 승인, 명령 인터페이스, 로컬 인증과 다운로드 |
| Mod 연결 | `src/mod/main.ts`, `bridge.ts` | stdin JSON, 허용 명령, 화면 상태에 연결한 일회성 토큰, 동일 엔진 호출 |
| 브라우저 | `web/` | 넓은 표·Excel·수동 Import·UNKNOWN 조정 등 선택적 고급 편집/검토 |
| Claude Code | `plugin/` | 수동 분석 Skill, 시나리오 목록·설명과 테스트 시작 버튼을 제공하는 Mod |

## 작은 목록과 시나리오 설명

Mod의 기본 화면은 짧은 시나리오 목록과 현재 단계에 필요한 행동이다. 제목을 누르면 시나리오의 목적·준비 조건·실행 방법·기대 결과를 읽는 상세를 연다. 테스트 중에도 동일한 설명과 실제 비교를 볼 수 있다. 코드·ID·스크립트·긴 원본 값은 기술 상세에 둔다. 표시를 접는 것은 실행 승인에 필요한 내용을 제거하는 것이 아니며 사용자가 상세를 열어 검토할 수 있어야 한다.

제목 클릭은 UI의 상세 선택만 바꾸고 Plan을 수정하지 않는다. 별도의 실행 선택 체크가 엔진의 계획 편집으로 이어져 새 버전·재승인이 필요하다. 현재 열린 상세와 실제 실행할 선택 묶음은 서로 다른 상태다.

## AI 왕복

엔진은 실제 로컬 소스를 읽고 `analysis-context.json`을 기록한다. 기존 Claude Code 세션의 Skill이 이 파일을 분석하고 `DraftSchema`에 맞는 초안을 제출한다. 엔진은 요청 ID·run_id·계획 버전·소스 해시를 확인하고 Describe·권한·참조·스크립트를 검증한 뒤 계획을 저장한다. 자연어 편집, 브라우저 편집, Excel 편집은 같은 새 계획 설치 경로로 수렴한다.

계획을 바꾼다는 행위와 실행을 승인한다는 행위는 별개다. 구조화 초안에는 승인 필드가 없으며 제출 파일이 승인 이벤트를 만들 수 없다. Skill의 계획 제출 뒤 패널에서 새로고침하여 최신 상태를 읽는다. Skill은 `serve`를 자동 시작하거나 Mod bridge/action/token으로 사용자 버튼을 대신 호출하지 않는다. 실행 후 AI는 저장된 증거를 읽고 `ai-note`로 원인 가설을 별도 추가한다. 자동 비교 조건을 사후에 바꾸거나 AI 설명을 실제값으로 대체하지 않는다.

사용자가 **테스트 시작**을 누르면 bridge의 `run-tests`가 승인한 선택 묶음에 대해 기존 엔진의 준비 → 도구 실행 → 수집을 연결한다. 화면에서 보고 있는 시나리오 하나만 실행하는 API가 아니다. 준비 후 Baseline·전제조건과 각 단계의 승인/Org/소스 검사는 그대로 적용된다. 사람 실행 항목은 기다리고, 비동기 Job의 긴 완료 관찰은 이 버튼에 포함하지 않는다. 완료한 동작을 재생하지 않으며 새 테스트는 `rerun`으로 이전 증거와 연결된 새 실행을 만든다.

## 준비와 실행 경계

`RecordSpec.fields`는 fixture 또는 Insert 입력이다. Update는 `Action.fieldOverrides[recordKey]`에 변경할 필드만 둔다. 준비는 fixture만 생성/참조하고 Org에서 값을 재조회해 Baseline을 보관한다. 전제조건이 불충족하면 해당 시나리오를 막고 독립 시나리오는 진행할 수 있다.

각 쓰기에는 `Operation`이 있다. NOT_SENT를 저장한 뒤 SENDING으로 바꾸고, 실제 응답을 받으면 SUCCEEDED/FAILED/UNKNOWN과 매핑을 저장한다. 서버 재시작 시 남은 SENDING은 UNKNOWN으로 처리한다. UNKNOWN이 있으면 자동 쓰기를 막고 실제 데이터/Job/사용자 ID 연결로 조정한다. 로컬 op_id는 Salesforce 서버의 멱등성 보장이 아니다.

Service·Batch 스크립트는 승인 계획에 담고 인자를 JSON 데이터로 직렬화한다. 실행별 상관 ID와 이미 승인한 논리키→ID 치환만 런타임에 달라진다. Batch 범위 조회와 Job 관찰은 실제 처리 완료·최종 DB 비교와 구분한다. 임의 Apex의 모든 부수 효과를 구조 검색만으로 증명할 수 없으므로 영향 범위가 불명확한 계획은 자동화하지 않는다.

## 승인과 영속성

Approval은 계획 버전/해시, 실제 Org ID/사용자, 범위, 시각, mod/browser/terminal 출처를 갖는다. Mod는 승인 상태를 자체 보유하지 않으며 사용자의 검토 버튼 동작을 엔진으로 전달한다. 실행 진입점은 이를 다시 확인한다. 계획·소스·스크립트·사용자 변경은 이전 승인으로 통과할 수 없다. 완료된 시나리오의 증거는 덮어쓰지 않고 변경된 재실행은 새 run_id로 연결한다.

`state.json`은 현재 상태, `plan.json`은 현재 계획, `record-mapping.json`은 실제 ID 연결, `operations.json`은 작업 상태를 제공한다. 원본 증거는 개별 `evidence/*.json`과 해시 인덱스로 축적한다. AI 의견과 개발자 판정은 별도 모델이다. 최종 MD/Excel은 구조화 사실에서 다시 생성할 수 있다.

잠금은 같은 실행에 대한 로컬 프로세스와 더블클릭을 조정한다. 다른 사용자의 Org 변경을 잠그지 않는다. 정리는 정확한 생성 ID를 현재 상태와 비교하고 관계/비동기/외부 변경이 있으면 차단한다. 파일 잠금이나 부분 오류는 삭제 완료로 추정하지 않는다.

## 연결과 배포

실제 연결은 SF CLI의 기존 인증을 내부적으로 재사용한다. SF 비밀 토큰을 브라우저·AI 입력·보고서에 전달하지 않는다. 읽기는 제한된 재시도가 가능하지만 결과가 불명확한 쓰기는 재시도하지 않는다. Fake는 명시적 `mode=fake`에서만 사용하고 네트워크를 호출하지 않는다.

로컬 배포는 npm lockfile을 포함한 프로젝트 폴더/ZIP이다. 개인 설치기는 `/testforce` Skill과 `testforce-panel` Mod를 Claude 개인 설정에 설치하고 Node 24·엔진 위치를 설치된 Mod 설정에 저장한다. 업무 workspace에 런타임 경로 설정을 만들지 않는다. 소스 Plugin을 사용할 때는 `configure-mod.mjs`로 소스 Mod의 로컬 설정을 준비한다. 이 설치별 절대경로 설정을 배포 ZIP의 공용 설정으로 포함하지 않는다.

처음 설치 시 npm 패키지 다운로드가 필요하며 의존성 설치 후 Fake 핵심 흐름은 로컬에서 동작한다. 실제 Salesforce는 네트워크/인증/권한이 필요하고 AI 분석은 사용자의 기존 Claude Code 세션에 의존한다. Mod 비활성화·누락 시 Skill+브라우저/CLI가 같은 엔진 상태를 사용한다.
