export function response() {
  return {
    ok: true,
    capability: "private-capability",
    view: {
      workspace: "/workspace 한글",
      runs: [{ run_id: "run-ui", status: "검토 대기", mode: "fake", createdAt: "2026-10-16", planVersion: 1 }],
      run: {
        run_id: "run-ui", mode: "fake", target: "offline", status: "검토 대기", paused: false,
        approvals: [], operations: [], bindings: {}, assertions: [], aiNotes: [], scenarios: {},
        cleanup: { decision: "pending", status: "pending", results: [] },
        plan: {
          version: 1, hash: "hash-v1", org: { name: "가상 Org", username: "offline@example.invalid", orgId: "offline-org", organizationType: "Fake" },
          source: { hash: "source-hash", warnings: [] },
          scenarios: [{
            id: "scenario-one", title: "레코드 값 증가", purpose: "서비스가 레코드 값을 변경하는지 확인", rationale: "서비스 분기", selected: true, execution: "tool",
            sourceRefs: [{ path: "force-app/main/default/classes/Example.cls", symbol: "updateValue", line: 10 }],
            preconditions: [], dependsOn: [], observation: { pollMs: 1000, timeoutMs: 60000, completionAssertions: [] },
            actions: [{ id: "change-one", kind: "dml", verb: "update", object: "Example__c", recordKeys: ["record-one"], transaction: "single", allOrNone: true,
              fieldOverrides: { "record-one": { Amount__c: { kind: "value", value: 10 } } }, args: [], constructorArgs: [], script: "",
              impact: { description: "이번 실행 레코드 1개", bounded: true, existingRecordIds: [], existingFields: [], externalEffects: [] } }],
          }],
          records: [{ key: "record-one", scenarioId: "scenario-one", stage: "fixture", object: "Example__c", ownership: "created", fields: { Amount__c: { kind: "value", value: 9 } } }],
          expectations: [{ id: "amount", scenarioId: "scenario-one", label: "수량", subject: { kind: "record", key: "record-one", field: "Amount__c" }, operator: "eq", expected: 11, tolerance: 0 }],
        },
      },
    },
  };
}
export const PANE = {
  plugin: "testforce-panel", component: "Pane", requestId: "testforce", surface: "terminal",
  viewport: { columns: 140, rows: 40 },
  props: { title: "Testforce", isFocused: true, bodyColumns: 100, placement: "inline", scroll: { offset: 0, bodyRows: 24 }, view: {} },
} as const;
