import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanSchema, type Run, type ScenarioState } from "../../src/core/model.js";
import {
  assertionExpected, comparisonCounts, comparisonRows, confirmedActionDeletion,
  recordComparisons, sameValue, scalarText, valueLeaves,
} from "../../web/src/result-data.js";
import {
  ActionEvidenceTable, AssertionComparisonTable, InputValueContent,
  RecordComparisonTable, ScenarioResultTables, ValueContent,
} from "../../web/src/components/ResultTables.js";

const freshState = (): ScenarioState => ({ status: "EXECUTED", actionResults: {}, baseline: {}, after: {}, jobs: [], manualObservations: {} });
function sample(): Run {
  const plan = PlanSchema.parse({
    schemaVersion: 1, plan_id: "plan-table", version: 1, hash: "hash",
    org: { mode: "fake", alias: "offline", orgId: "FAKE", username: "offline", isSandbox: true, name: "가상 Org" },
    source: { hash: "source", root: "/virtual", files: [], gitCommit: null, dirty: false, selection: "가상 테스트" },
    scenarios: [{ id: "one", title: "레코드 변경", purpose: "표시 검증", rationale: "가상 데이터", sourceRefs: [], selected: true, execution: "tool",
      actions: [{ id: "change", kind: "dml", verb: "update", object: "Example__c", recordKeys: ["first"], fieldOverrides: { first: { Number__c: { kind: "value", value: 10 } } }, impact: { description: "새 레코드", bounded: true } }], observation: {} }],
    records: [{ key: "first", scenarioId: "one", object: "Example__c", stage: "fixture", ownership: "created", fields: {
      Number__c: { kind: "value", value: 9 }, Empty__c: { kind: "value", value: "" }, Null__c: { kind: "null" }, Omit__c: { kind: "omit" },
    } }],
    expectations: [{ id: "number", scenarioId: "one", label: "직원 수", subject: { kind: "record", key: "first", field: "Number__c" }, operator: "eq", expected: 10 }],
    policies: { existingMutation: false, notes: "" },
  });
  return {
    schemaVersion: 1, run_id: "run-table", createdAt: "2026-10-15", updatedAt: "2026-10-15", mode: "fake", target: "offline", sourceRoot: "/virtual", status: "검토 대기", paused: false,
    plan, planHistory: [], approvals: [], bindings: { first: { key: "first", object: "Example__c", id: "a00000000000001AAA", ownership: "created", runId: "run-table", scenarioId: "one", proof: "operation" } }, operations: [],
    scenarios: { one: { ...freshState(), baseline: { first: { Number__c: 9, Enabled__c: false, Null__c: null, Empty__c: "" } }, after: { first: { Number__c: 10, Enabled__c: false, Null__c: null, Empty__c: "" } } } },
    assertions: [{ assertionId: "number", scenarioId: "one", status: "MATCH", before: 9, actual: 10, expected: 10, message: "승인한 조건과 일치합니다." }], aiNotes: [], cleanup: { decision: "pending", status: "pending", results: [] }, events: [],
  };
}

describe("result presentation preserves evidence", () => {
  it("distinguishes missing, null, empty text, false, zero, and empty collections", () => {
    expect([undefined, null, "", false, 0, [], {}].map(scalarText)).toEqual([
      "수집 안 됨", "값 없음 (null)", '빈 문자열 ("")', "false (거짓)", "0", "빈 목록 (0개)", "빈 객체 (필드 없음)",
    ]);
  });
  it("keeps exact decimal strings, IDs and timezones", () => {
    for (const value of ["9007199254740993.12345", "001230000000000AAA", "2026-10-15T09:00:00+09:00"]) expect(scalarText(value)).toBe(value);
  });
  it("flattens nested data into readable field paths without dropping null/false", () => {
    expect(valueLeaves({ Parent: { Name: "가나다" }, Items: [{ enabled: false }, null] }).map(({ label, value }) => [label, value])).toEqual([
      ["Parent.Name", "가나다"], ["Items[1].enabled", false], ["Items[2]", null],
    ]);
  });
  it("uses captured engine status even when displayed values appear equal", () => {
    const run = sample(); run.assertions[0]!.status = "UNVERIFIABLE";
    expect(comparisonCounts(comparisonRows(run, "one"))).toMatchObject({ MATCH: 0, UNVERIFIABLE: 1 });
  });
  it("keeps missing comparison pending and empty comparisons empty", () => {
    const run = sample(); run.assertions = [];
    expect(comparisonCounts(comparisonRows(run, "one"))).toMatchObject({ MATCH: 0, NOT_EXECUTED: 0, pending: 1 });
    run.plan!.expectations = [];
    expect(comparisonRows(run, "one")).toEqual([]);
  });
  it("retains generated no-conditions/duration comparisons and resolved expected IDs", () => {
    const run = sample(); run.assertions.push({ assertionId: "no-assertions", scenarioId: "one", status: "UNVERIFIABLE", message: "조건 없음" });
    expect(comparisonRows(run, "one")[1]!.label).toBe("비교 조건 없음");
    expect(assertionExpected(run.plan!.expectations[0], { ...run.assertions[0]!, expected: "actual-record-id" })).toBe("actual-record-id");
  });
  it("separates setup input from actual baseline and test action override", () => {
    const run = sample(), number = recordComparisons(run, "one")[0]!.rows.find((row) => row.field === "Number__c")!;
    expect(number.setup?.input).toEqual({ kind: "value", value: 9 });
    expect(number.actions[0]?.input).toEqual({ kind: "value", value: 10 });
    expect([number.before, number.after, number.change]).toEqual([9, 10, "changed"]);
    const enabled = recordComparisons(run, "one")[0]!.rows.find((row) => row.field === "Enabled__c")!;
    expect([enabled.before, enabled.after, enabled.change]).toEqual([false, false, "unchanged"]);
  });
  it("matches engine whole-record override semantics, including an explicit empty override", () => {
    const run = sample(), action = run.plan!.scenarios[0]!.actions[0]!;
    action.verb = "insert";
    const rows = recordComparisons(run, "one")[0]!.rows;
    expect(rows.find((row) => row.field === "Number__c")!.actions[0]!.input).toEqual({ kind: "value", value: 10 });
    expect(rows.find((row) => row.field === "Empty__c")!.actions).toEqual([]);
    action.fieldOverrides.first = {};
    expect(recordComparisons(run, "one")[0]!.rows.every((row) => row.actions.length === 0)).toBe(true);
    delete action.fieldOverrides.first;
    expect(recordComparisons(run, "one")[0]!.rows.find((row) => row.field === "Number__c")!.actions[0]!.input).toEqual({ kind: "value", value: 9 });
  });
  it("never substitutes lastKnown/cleanup snapshots for collected after evidence", () => {
    const run = sample(); run.scenarios.one!.after = {}; run.bindings.first!.lastKnown = { Number__c: 99 }; run.bindings.first!.deleted = true;
    run.cleanup.results.push({ key: "first", id: run.bindings.first!.id, success: true });
    const record = recordComparisons(run, "one")[0]!;
    expect(record.cleanupDeleted).toBe(true); expect(record.deletedByAction).toBe(false);
    expect(record.rows.find((row) => row.field === "Number__c")).toMatchObject({ after: undefined, change: "missing" });
  });
  it("labels deletion only for a confirmed test Delete response", () => {
    const run = sample(); run.plan!.scenarios[0]!.actions[0]!.verb = "delete"; run.scenarios.one!.after = {};
    run.scenarios.one!.actionResults.change = { results: [{ key: "first", success: false, errors: [] }] };
    expect(confirmedActionDeletion(run, "one", "first")).toBe(false);
    run.scenarios.one!.actionResults.change = { results: [{ key: "first", success: true, errors: [] }] };
    expect(confirmedActionDeletion(run, "one", "first")).toBe(true);
    expect(recordComparisons(run, "one")[0]!.rows[0]!.change).toBe("deleted");
  });
  it("keeps multiple record identities separate and leaves source evidence unchanged", () => {
    const run = sample(); run.scenarios.one!.after.second = { Number__c: 0 }; const original = structuredClone(run);
    expect(recordComparisons(run, "one").map((record) => record.key)).toEqual(["first", "second"]);
    expect(run).toEqual(original);
    expect(sameValue({ x: 1, y: 2 }, { y: 2, x: 1 })).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue(null, undefined)).toBe(false);
  });
});

describe("result table HTML", () => {
  it("renders safe readable nested fields instead of JSON or executable HTML", () => {
    const html = renderToStaticMarkup(createElement(ValueContent, { value: { Name: '<script>alert("x")</script>', Enabled: false, count: 0 } }));
    expect(html).toContain("<dt>Name</dt>"); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
    expect(html).toContain("false (거짓)"); expect(html).toContain(">0<"); expect(html).not.toContain("<pre");
  });
  it("shows omit and logical references explicitly", () => {
    expect(renderToStaticMarkup(createElement(InputValueContent, { input: { kind: "omit" } }))).toContain("전송하지 않음");
    const run = sample(); const html = renderToStaticMarkup(createElement(InputValueContent, { input: { kind: "ref", key: "first" }, bindings: run.bindings }));
    expect(html).toContain("참조:"); expect(html).toContain(run.bindings.first!.id);
  });
  it("has keyboard-scrollable tables, semantic headers, and one primary assertion set", () => {
    const run = sample(); const html = renderToStaticMarkup(createElement(ScenarioResultTables, { run, scenario: run.plan!.scenarios[0]! }));
    expect(html).toContain('role="region"'); expect(html).toContain('tabindex="0"'); expect(html).toContain('scope="col"'); expect(html).toContain('scope="row"');
    expect(html).toContain("실행 전"); expect(html).toContain("기대 결과"); expect(html).toContain("실행 후 실제값");
    expect(html.match(/직원 수/g)).toHaveLength(1); expect(html).not.toContain("<pre");
  });
  it("displays pending checks without claiming not-executed or success", () => {
    const run = sample(); run.assertions = [];
    const html = renderToStaticMarkup(createElement(AssertionComparisonTable, { run, scenarioId: "one" }));
    expect(html).toContain("비교 대기"); expect(html).not.toContain("✓ 일치"); expect(html).not.toContain("– 미실행");
  });
  it("presents count comparisons as counts while retaining the returned records", () => {
    const run = sample(); run.plan!.expectations[0]!.operator = "count"; run.plan!.expectations[0]!.expected = 2;
    run.assertions[0]!.actual = [{ Id: "a" }, { Id: "b" }]; run.assertions[0]!.expected = 2;
    const html = renderToStaticMarkup(createElement(AssertionComparisonTable, { run, scenarioId: "one" }));
    expect(html).toContain("2건"); expect(html).toContain("조회한 레코드 보기");
  });
  it("does not present uncaptured Service returns as verified values", () => {
    const run = sample(), scenario = run.plan!.scenarios[0]!; scenario.actions[0]!.kind = "service";
    run.scenarios.one!.actionResults.change = { success: false, compiled: true, returnCaptured: false, returnValue: "DO-NOT-SHOW", exception: { code: "EXPECTED_ERROR", message: "예상 오류" } };
    const html = renderToStaticMarkup(createElement(ActionEvidenceTable, { scenario, state: run.scenarios.one }));
    expect(html).toContain("반환값을 확보하지 못함"); expect(html).not.toContain("DO-NOT-SHOW"); expect(html).toContain("EXPECTED_ERROR"); expect(html).toContain("실행 응답 실패");
  });
  it("does not label a registered Batch as complete", () => {
    const run = sample(), scenario = run.plan!.scenarios[0]!; scenario.actions[0]!.kind = "batch";
    run.scenarios.one!.actionResults.change = { success: true, compiled: true, returnCaptured: false, jobId: "707-job" };
    run.scenarios.one!.jobs = [{ id: "707-job", status: "Queued", errors: 0, processed: 0, total: 2, done: false }];
    const html = renderToStaticMarkup(createElement(ActionEvidenceTable, { scenario, state: run.scenarios.one }));
    expect(html).toContain("처리 완료 대기"); expect(html).not.toContain("종료 상태 확인"); expect(html).toContain("등록한 Job ID");
  });
  it("shows actual empty, null, and missing fields independently in record comparison", () => {
    const run = sample(); const html = renderToStaticMarkup(createElement(RecordComparisonTable, { run, scenarioId: "one" }));
    expect(html).toContain("빈 문자열"); expect(html).toContain("값 없음 (null)"); expect(html).toContain("전송하지 않음"); expect(html).toContain("비교할 값 부족");
  });
});
