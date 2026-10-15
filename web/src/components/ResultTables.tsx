import { useId } from "react";
import type {
  Assertion, AssertionResult, InputValue, Run, Scenario, ScenarioState,
} from "../../../src/core/model";
import {
  assertionExpected, comparisonCounts, comparisonLabels, comparisonRows,
  inputCellValue, operatorLabels, ownValue, recordComparisons, scalarText,
  subjectLabels, type InputCell,
} from "../result-data";

/** Values are rendered as escaped text and labelled fields, never raw JSON/HTML. */
export function ValueContent({ value, missingLabel = "수집 안 됨" }: { value: unknown; missingLabel?: string }) {
  if (value === undefined) return <span className="value-state value-missing">{missingLabel}</span>;
  if (value === null || value === "" || (typeof value === "object" && !Object.keys(value).length)) {
    return <span className="value-state">{scalarText(value)}</span>;
  }
  if (Array.isArray(value)) {
    return <ol className="value-list">{value.map((item, index) => <li key={index}><ValueContent value={item} /></li>)}</ol>;
  }
  if (typeof value === "object") {
    return <dl className="value-fields">{Object.entries(value).map(([key, item]) =>
      <div key={key}><dt>{key}</dt><dd><ValueContent value={item} /></dd></div>)}</dl>;
  }
  return <span className="value-content">{scalarText(value)}</span>;
}

export function InputValueContent({ input, bindings }: {
  input?: InputValue;
  bindings?: Run["bindings"];
}) {
  if (!input) return <span className="value-state">입력 없음</span>;
  if (input.kind === "omit") return <span className="value-state">전송하지 않음</span>;
  if (input.kind === "ref") return <span className="value-reference">참조: <code>{input.key}</code>
    {bindings?.[input.key] && <small className="value-id">{bindings[input.key]!.id}</small>}</span>;
  return <ValueContent value={input.kind === "null" ? null : input.value} />;
}

function InputCellContent({ cell, bindings }: { cell?: InputCell; bindings: Run["bindings"] }) {
  if (!cell) return <span className="value-state">입력 없음</span>;
  if (cell.input.kind === "omit" || cell.input.kind === "ref") return <InputValueContent input={cell.input} bindings={bindings} />;
  return <ValueContent value={inputCellValue(cell)} missingLabel="해당 필드 입력 없음" />;
}

export function ExpectedContent({ assertion, result }: { assertion?: Assertion; result?: AssertionResult }) {
  const needsValue = !assertion || !["null", "notNull", "exists", "absent", "changed", "unchanged"].includes(assertion.operator);
  return <div className="expected-content">
    {assertion && <span className="condition-label">{operatorLabels[assertion.operator]}</span>}
    {needsValue && <ValueContent value={assertionExpected(assertion, result)} missingLabel="기대값 없음" />}
    {assertion && assertion.tolerance > 0 && <small>허용 오차 ±{assertion.tolerance}</small>}
    {assertion?.unordered && <small>목록 순서는 비교하지 않음</small>}
    {assertion?.valueType === "datetime" && <small>시간대: {assertion.timezone}</small>}
  </div>;
}

export function ComparisonSummary({ run, scenarioId }: { run: Run; scenarioId: string }) {
  const rows = comparisonRows(run, scenarioId), counts = comparisonCounts(rows);
  return <div className="result-summary" aria-label="자동 비교 요약">
    {(["MATCH", "MISMATCH", "UNVERIFIABLE", "NOT_EXECUTED"] as const).map((status) =>
      <div className={`result-summary-item summary-${status.toLowerCase()}`} key={status}>
        <span>{comparisonLabels[status]}</span><strong>{counts[status]}</strong>
      </div>)}
    {counts.pending > 0 && <div className="result-summary-item summary-pending"><span>비교 대기</span><strong>{counts.pending}</strong></div>}
    {!rows.length && <p className="result-empty">비교 결과가 없습니다. 조건과 실제 증거를 수집한 뒤 비교합니다.</p>}
  </div>;
}

export function AssertionComparisonTable({ run, scenarioId }: { run: Run; scenarioId: string }) {
  const rows = comparisonRows(run, scenarioId);
  const labelId = useId();
  if (!rows.length) return <p className="result-empty">아직 비교할 조건이 없습니다. 비어 있는 결과는 성공으로 처리하지 않습니다.</p>;
  return <div className="table-scroll result-table-scroll" role="region" aria-labelledby={labelId} tabIndex={0}>
    <table className="comparison-table assertion-comparison-table">
      <caption id={labelId}>기대 결과와 실제 결과 비교</caption>
      <thead><tr><th scope="col">확인할 항목</th><th scope="col">실행 전</th><th scope="col">실행 후 실제값</th><th scope="col">기대 결과</th><th scope="col">비교 결과 · 차이</th></tr></thead>
      <tbody>{rows.map(({ id, label, assertion, result }) => <tr key={id} className={result ? `comparison-${result.status.toLowerCase()}` : "comparison-pending"}>
        <th scope="row"><span>{label}</span>{assertion && <small className="field-context">
          {subjectLabels[assertion.subject.kind]}{assertion.subject.key ? ` · ${assertion.subject.key}` : ""}{assertion.subject.field ? ` · ${assertion.subject.field}` : ""}
        </small>}</th>
        <td><ValueContent value={result?.before} missingLabel={assertion && assertion.subject.kind !== "record" ? "해당 없음" : "수집 안 됨"} /></td>
        <td>{assertion?.operator === "count" && Array.isArray(result?.actual)
          ? <><strong>{result.actual.length}건</strong><details><summary>조회한 레코드 보기</summary><ValueContent value={result.actual} /></details></>
          : <ValueContent value={result?.actual} />}</td>
        <td><ExpectedContent assertion={assertion} result={result} /></td>
        <td><span className={`badge result-badge badge-${result?.status.toLowerCase() ?? "pending"}`}>{result ? comparisonLabels[result.status] : "◷ 비교 대기"}</span>
          <p className="comparison-message">{result?.message ?? "실제 결과를 수집하면 비교할 수 있습니다."}</p>
          {result?.evidenceRef && <details className="evidence-reference"><summary>증거 위치</summary><code>{result.evidenceRef}</code></details>}
        </td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function RecordComparisonTable({ run, scenarioId }: { run: Run; scenarioId: string }) {
  const records = recordComparisons(run, scenarioId);
  if (!records.length) return <p className="result-empty">이 시나리오에는 준비하거나 조회한 레코드가 없습니다.</p>;
  return <div className="record-comparisons">{records.map((record) => <section className="record-comparison" key={record.key}>
    <div className="record-comparison-heading"><h4>{record.object} · {record.key}</h4>
      {record.id ? <code className="record-id">{record.id}</code> : <span className="value-state">실제 ID 연결 전</span>}
      {record.cleanupDeleted && <span className="value-state">결과 보관 후 정리됨</span>}
    </div>
    {!record.rows.length ? <p className="result-empty">표시할 입력·조회 필드가 없습니다.</p> :
      <div className="table-scroll result-table-scroll" role="region" aria-label={`${record.key} 레코드 값 비교`} tabIndex={0}>
        <table className="comparison-table record-comparison-table">
          <caption>{record.key}: 계획한 입력과 Org에서 실제 조회한 값</caption>
          <thead><tr><th scope="col">필드</th><th scope="col">준비 입력</th><th scope="col">테스트 동작 입력</th><th scope="col">실행 전 실제값</th><th scope="col">실행 후 실제값</th><th scope="col">변화</th></tr></thead>
          <tbody>{record.rows.map((row) => <tr key={row.id} className={row.change === "changed" ? "field-changed" : undefined}>
            <th scope="row">{row.field}</th>
            <td><InputCellContent cell={row.setup} bindings={run.bindings} /></td>
            <td>{row.actions.length ? row.actions.map((cell, index) => <div className="action-input" key={`${cell.source}-${index}`}>
              {row.actions.length > 1 && <small>{cell.source}</small>}<InputCellContent cell={cell} bindings={run.bindings} />
            </div>) : <span className="value-state">직접 필드 입력 없음</span>}</td>
            <td><ValueContent value={row.before} /></td>
            <td>{row.change === "deleted" ? <span className="value-state">테스트 삭제 동작 성공 확인</span> : <ValueContent value={row.after} />}</td>
            <td><span className={`field-change field-change-${row.change}`}>{({ changed: "↔ 변경됨", unchanged: "= 유지됨", missing: "? 비교할 값 부족", deleted: "− 삭제됨" })[row.change]}</span></td>
          </tr>)}</tbody>
        </table>
      </div>}
  </section>)}</div>;
}

function ActionArguments({ scenario, bindings }: { scenario: Scenario; bindings?: Run["bindings"] }) {
  const callable = scenario.actions.filter((action) => action.kind === "service" || action.kind === "batch");
  if (!callable.length) return null;
  return <div className="action-arguments">{callable.map((action) => <section key={action.id}>
    <h4>{action.className}{action.method ? `.${action.method}` : ""} · 호출 인자</h4>
    {!action.constructorArgs.length && !action.args.length ? <p className="value-state">전달하는 인자가 없습니다.</p> :
      <div className="table-scroll" role="region" aria-label={`${action.id} 호출 인자`} tabIndex={0}><table className="comparison-table">
        <thead><tr><th scope="col">위치</th><th scope="col">타입</th><th scope="col">계획한 입력</th></tr></thead>
        <tbody>{[...action.constructorArgs.map((arg, index) => ({ arg, label: `생성자 ${index + 1}` })), ...action.args.map((arg, index) => ({ arg, label: `메서드 ${index + 1}` }))].map(({ arg, label }) =>
          <tr key={label}><th scope="row">{label}</th><td><code>{arg.type}</code></td><td><InputValueContent input={arg.value} bindings={bindings} /></td></tr>)}</tbody>
      </table></div>}
  </section>)}</div>;
}

export function ActionEvidenceTable({ scenario, state, bindings }: { scenario: Scenario; state?: ScenarioState; bindings?: Run["bindings"] }) {
  return <div className="action-evidence">
    <ActionArguments scenario={scenario} bindings={bindings} />
    {scenario.actions.map((action) => {
      const result = state?.actionResults[action.id];
      const results = ownValue(result, "results");
      const captured = ownValue(result, "returnCaptured") === true;
      const unknown = ownValue(result, "unknown") === true;
      return <section key={action.id} className="action-evidence-item"><h4>{action.id} · {action.kind === "dml" ? `${action.object} ${action.verb === "insert" ? "생성" : action.verb === "delete" ? "삭제" : "변경"}` : action.kind === "batch" ? "Batch 시작" : action.kind === "service" ? "Service 호출" : "Anonymous Apex"}</h4>
        {result === undefined ? <p className="result-empty">동작 결과가 수집되지 않았습니다.</p> : <>
          <div className="action-receipt">
            <span>{unknown ? "? 전달 결과 불명" : ownValue(result, "success") === true ? "✓ 실행 응답 성공" : ownValue(result, "success") === false ? "! 실행 응답 실패" : "실행 응답 수집됨"}</span>
            {typeof ownValue(result, "compiled") === "boolean" && <span>{ownValue(result, "compiled") ? "컴파일 성공" : "컴파일 실패"}</span>}
            {ownValue(result, "transaction") !== undefined && <span>트랜잭션: {ownValue(result, "transaction") === "single" ? "한 번에 실행" : "레코드별 실행"}</span>}
          </div>
          {Array.isArray(results) && <div className="table-scroll" role="region" aria-label={`${action.id} 레코드별 응답`} tabIndex={0}><table className="comparison-table action-response-table">
            <thead><tr><th scope="col">레코드</th><th scope="col">실제 ID</th><th scope="col">DML 응답</th><th scope="col">오류</th></tr></thead>
            <tbody>{results.map((record, index) => <tr key={index}>
              <th scope="row"><ValueContent value={ownValue(record, "key")} /></th><td><ValueContent value={ownValue(record, "id")} /></td>
              <td>{ownValue(record, "success") === true ? "✓ 성공" : ownValue(record, "success") === false ? "! 실패" : "? 확인 불가"}</td>
              <td>{Array.isArray(ownValue(record, "errors")) && (ownValue(record, "errors") as unknown[]).length === 0 ? "보고된 오류 없음" : <ValueContent value={ownValue(record, "errors")} />}</td>
            </tr>)}</tbody>
          </table></div>}
          {action.kind !== "dml" && <dl className="action-result-fields">
            <div><dt>반환값</dt><dd>{captured ? <ValueContent value={ownValue(result, "returnValue")} /> : <span className="value-state">{action.kind === "batch" ? "Job ID로 추적" : !action.returns ? "반환값 수집 대상 아님" : "반환값을 확보하지 못함"}</span>}</dd></div>
            <div><dt>보고된 예외</dt><dd><ValueContent value={ownValue(result, "exception")} missingLabel={ownValue(result, "success") === true && !unknown ? "보고된 예외 없음" : "예외 정보 수집 안 됨"} /></dd></div>
            {ownValue(result, "jobId") !== undefined && <div><dt>등록한 Job ID</dt><dd><ValueContent value={ownValue(result, "jobId")} /></dd></div>}
          </dl>}
        </>}
      </section>;
    })}
    {!!state?.jobs.length && <div className="table-scroll" role="region" aria-label="비동기 작업 관찰" tabIndex={0}><table className="comparison-table job-evidence-table">
      <caption>비동기 작업 관찰 — 등록과 처리 완료를 구분합니다.</caption>
      <thead><tr><th scope="col">Job ID</th><th scope="col">상태</th><th scope="col">처리 건수</th><th scope="col">오류 수</th><th scope="col">완료 관찰</th></tr></thead>
      <tbody>{state.jobs.map((job) => <tr key={job.id}><th scope="row"><code>{job.id}</code></th><td>{job.status}{job.extendedStatus && <small>{job.extendedStatus}</small>}</td><td>{job.processed} / {job.total}</td><td>{job.errors}</td><td>{job.done ? "종료 상태 확인" : "처리 완료 대기"}</td></tr>)}</tbody>
    </table></div>}
  </div>;
}

export function ScenarioResultTables({ run, scenario }: { run: Run; scenario: Scenario }) {
  return <div className="scenario-result-tables">
    <ComparisonSummary run={run} scenarioId={scenario.id} />
    <AssertionComparisonTable run={run} scenarioId={scenario.id} />
    <details className="result-detail"><summary>레코드별 입력과 전후 값 자세히 보기</summary>
      <p className="muted">입력은 계획한 값입니다. 실행 전·후는 Org에서 재조회한 값이며, 값의 변화와 기대 결과 일치는 별도로 표시합니다.</p>
      <RecordComparisonTable run={run} scenarioId={scenario.id} />
    </details>
    <details className="result-detail"><summary>호출 인자 · 반환값 · 오류 · 비동기 작업</summary>
      <p className="muted">실행 응답 성공만으로 테스트 일치를 판정하지 않습니다. 위 비교 표에서 승인한 기대 결과를 확인합니다.</p>
      <ActionEvidenceTable scenario={scenario} state={run.scenarios[scenario.id]} bindings={run.bindings} />
    </details>
  </div>;
}
