import { expect, test } from "claude-code/testing";
import { response, PANE } from "./fixture";

// These mounted tests use the actual installed Claude Code Mod runtime.
// The process adapter is stubbed: no Salesforce connection or approval is performed.
test("plan checkbox approves exactly the displayed version through stdin only", async ($, on) => {
  const data: any = response();
  const actions: any[] = [];
  on("fs.read", () => ({ value: JSON.stringify({ bridgeEntry: "/engine/dist/mod/main.js", nodeExecutable: "/runtime/node" }) }));
  on("session.cwd", () => ({ value: "/workspace 한글" }));
  on("ui.open", () => ({ value: undefined }));
  on("process.run", ($, e) => {
    expect(e.argv.length).toBe(3);
    expect(e.argv.join(" ")).not.toContain("private-capability");
    const request = JSON.parse(e.init.stdin);
    if (e.argv[2] === "action") {
      actions.push(request);
      if (request.action === "approve") data.view.run.approvals.push({ scope: "execute", planVersion: 1, planHash: "hash-v1" });
    }
    return { value: { exitCode: 0, stdout: JSON.stringify(data), stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
  });
  await $.command.run({ command: "testforce-ui", args: "" });
  const ui = await $.ui.mount(PANE);
  expect(await ui.find({ key: "approve" })).toBeUndefined();
  expect(actions).toEqual([]);
  await ui.press({ key: "review-check" });
  await ui.press({ key: "approve" });
  expect(actions.length).toBe(1);
  expect(actions[0]).toMatchObject({ action: "approve", reviewed: true, version: 1, hash: "hash-v1", runId: "run-ui", workspace: "/workspace 한글" });
  expect(await ui.find({ key: "approve" })).toBeUndefined();
  expect(await ui.find({ key: "run-tests" })).toBeDefined();
  await ui.unmount();
});

test("refresh invalidates checked old plans and scenario changes use the engine", async ($, on) => {
  const data: any = response();
  const actions: any[] = [];
  on("fs.read", () => ({ value: JSON.stringify({ bridgeEntry: "/engine/dist/mod/main.js", nodeExecutable: "/runtime/node" }) }));
  on("session.cwd", () => ({ value: "/workspace" }));
  on("ui.open", () => ({ value: undefined }));
  on("process.run", ($, e) => {
    if (e.argv[2] === "action") {
      const request = JSON.parse(e.init.stdin); actions.push(request);
      data.view.run.plan.version++;
      data.view.run.plan.hash = "hash-v3";
      data.view.run.plan.scenarios[0].selected = false;
    }
    return { value: { exitCode: 0, stdout: JSON.stringify(data), stderr: "" } };
  });
  await $.command.run({ command: "testforce-ui", args: "" });
  const ui = await $.ui.mount(PANE);
  await ui.press({ key: "review-check" });
  data.view.run.plan.version = 2; data.view.run.plan.hash = "hash-v2";
  await ui.press({ key: "refresh" });
  expect(await ui.find({ key: "approve" })).toBeUndefined();
  await ui.press({ key: "select-scenario-one" });
  expect(actions[0]).toMatchObject({ action: "select", scenarioIds: [], version: 2, hash: "hash-v2" });
  expect(await ui.find({ key: "approve" })).toBeUndefined();
  await ui.unmount();
});

test("before after expected and mismatch are separate visible values on both surfaces", async ($, on) => {
  const data: any = response();
  data.view.run.scenarios["scenario-one"] = { status: "EXECUTED", baseline: { "record-one": { Amount__c: 9 } }, after: { "record-one": { Amount__c: 10 } }, jobs: [], actionResults: {} };
  data.view.run.assertions = [{ assertionId: "amount", scenarioId: "scenario-one", status: "MISMATCH", expected: 11, actual: 10, before: 9, message: "기대값과 다릅니다." }];
  on("fs.read", () => ({ value: JSON.stringify({ bridgeEntry: "/engine/dist/mod/main.js", nodeExecutable: "/runtime/node" }) }));
  on("session.cwd", () => ({ value: "/workspace" }));
  on("ui.open", () => ({ value: undefined }));
  on("process.run", () => ({ value: { exitCode: 0, stdout: JSON.stringify(data), stderr: "" } }));
  await $.command.run({ command: "testforce-ui", args: "" });
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    await ui.press({ key: "tab-results" });
    await ui.press({ key: "scenario-scenario-one" });
    expect(await ui.find({ type: "Text", text: "실행 전" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "9" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "10" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "같음 · 11" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "수량 · ≠ 불일치" })).toBeDefined();
    await ui.unmount();
  }
});

test("cleanup needs preview and a separate explicit checkbox and button", async ($, on) => {
  const data: any = response();
  const actions: any[] = [];
  on("fs.read", () => ({ value: JSON.stringify({ bridgeEntry: "/engine/dist/mod/main.js", nodeExecutable: "/runtime/node" }) }));
  on("session.cwd", () => ({ value: "/workspace" }));
  on("ui.open", () => ({ value: undefined }));
  on("process.run", ($, e) => {
    if (e.argv[2] === "action") {
      const request = JSON.parse(e.init.stdin); actions.push(request);
      if (request.action === "cleanup-preview") data.view.cleanupPreview = { detailsHash: "cleanup-hash", records: [{ key: "record-one", object: "Example__c", id: "fake-record" }], conflicts: [] };
      if (request.action === "cleanup") { delete data.view.cleanupPreview; data.view.run.cleanup.status = "complete"; }
    }
    return { value: { exitCode: 0, stdout: JSON.stringify(data), stderr: "" } };
  });
  await $.command.run({ command: "testforce-ui", args: "" });
  const ui = await $.ui.mount(PANE);
  await ui.press({ key: "tab-finish" });
  expect(await ui.find({ key: "cleanup" })).toBeUndefined();
  await ui.press({ key: "cleanup-preview" });
  expect(actions.map((a) => a.action)).toEqual(["cleanup-preview"]);
  expect(await ui.find({ key: "cleanup" })).toBeUndefined();
  await ui.press({ key: "cleanup-check" });
  await ui.press({ key: "cleanup" });
  expect(actions.map((a) => a.action)).toEqual(["cleanup-preview", "cleanup"]);
  expect(actions[1].reviewed).toBe(true);
  await ui.unmount();
});

test("uncertain process failure reads status and never automatically resends the action", async ($, on) => {
  const data: any = response(); let actionCount = 0, reads = 0;
  on("fs.read", () => ({ value: JSON.stringify({ bridgeEntry: "/engine/dist/mod/main.js", nodeExecutable: "/runtime/node" }) }));
  on("session.cwd", () => ({ value: "/workspace" }));
  on("ui.open", () => ({ value: undefined }));
  on("process.run", ($, e) => {
    if (e.argv[2] === "action") { actionCount++; return { deny: "결과를 받지 못했습니다." }; }
    reads++; return { value: { exitCode: 0, stdout: JSON.stringify(data), stderr: "" } };
  });
  await $.command.run({ command: "testforce-ui", args: "" });
  const ui = await $.ui.mount(PANE);
  await ui.press({ key: "review-check" });
  await ui.press({ key: "approve" });
  expect(actionCount).toBe(1); expect(reads).toBe(2);
  expect(await ui.find({ key: "approve" })).toBeUndefined();
  await ui.unmount();
});

test("explicit testforce skill keeps its prompt and opens a read-only view after the turn", async ($, on) => {
  const data: any = response(); let opens = 0; const operations: string[] = [];
  on("fs.read", () => ({ value: JSON.stringify({ bridgeEntry: "/engine/dist/mod/main.js", nodeExecutable: "/runtime/node" }) }));
  on("session.cwd", () => ({ value: "/workspace" }));
  on("ui.open", () => { opens++; return { value: undefined }; });
  on("skill.prompt", ($, e) => ({ text: e.text }));
  on("turn.complete", () => ({ text: "" }));
  on("process.run", ($, e) => { operations.push(e.argv[2]); return { value: { exitCode: 0, stdout: JSON.stringify(data), stderr: "" } }; });
  for (const skill of ["testforce", "sandbox-workbench:testforce"]) {
    const prompt = await $.skill.prompt({ skill, text: "원래 스킬 지침" });
    expect(prompt.text).toBe("원래 스킬 지침");
    await $.turn.complete({ turnId: "t", answer: "계획을 제출했습니다.", durationMs: 1, isAborted: false, usage: null });
  }
  expect(opens).toBe(2); expect(operations).toEqual(["view", "view"]);
});

test("narrow terminal keeps three comparison columns and unknown writes have no execution button", async ($, on) => {
  const data: any = response();
  data.view.run.operations = [{ state: "UNKNOWN" }];
  data.view.run.approvals = [{ scope: "execute", planVersion: 1, planHash: "hash-v1" }];
  data.view.run.scenarios["scenario-one"] = { status: "UNKNOWN", baseline: {}, after: {}, jobs: [], actionResults: {} };
  data.view.run.assertions = [{ assertionId: "amount", scenarioId: "scenario-one", status: "UNVERIFIABLE", before: 9, message: "결과 불명" }];
  on("fs.read", () => ({ value: JSON.stringify({ bridgeEntry: "/engine/dist/mod/main.js", nodeExecutable: "/runtime/node" }) }));
  on("session.cwd", () => ({ value: "/workspace" }));
  on("ui.open", () => ({ value: undefined }));
  on("process.run", () => ({ value: { exitCode: 0, stdout: JSON.stringify(data), stderr: "" } }));
  await $.command.run({ command: "testforce-ui", args: "" });
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 70 } });
  await ui.press({ key: "tab-results" });
    await ui.press({ key: "scenario-scenario-one" });
  expect(await ui.find({ type: "Text", text: "실행 전" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "실행 후" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "기대 결과" })).toBeDefined();
  expect(await ui.find({ key: "run-tests" })).toBeUndefined();
  await ui.press({ key: "advanced" });
  expect(await ui.find({ key: "execute" })).toBeUndefined();
  expect(await ui.find({ key: "prepare" })).toBeUndefined();
  await ui.unmount();
});

test("record nested baselines are shown and never reused as service return baselines", async ($, on) => {
  const data: any = response();
  data.view.run.scenarios["scenario-one"] = { status: "EXECUTED", baseline: { "record-one": { Amount__c: 9, Parent: { Name: "이전 부모" } } }, after: {}, jobs: [], actionResults: {} };
  data.view.run.plan.expectations = [
    { id: "parent", scenarioId: "scenario-one", label: "부모", subject: { kind: "record", key: "record-one", field: "Parent.Name" }, operator: "eq", expected: "변경 부모" },
    { id: "return", scenarioId: "scenario-one", label: "반환값", subject: { kind: "return", key: "record-one", field: "Amount__c" }, operator: "eq", expected: 10 },
  ];
  on("fs.read", () => ({ value: JSON.stringify({ bridgeEntry: "/engine/dist/mod/main.js", nodeExecutable: "/runtime/node" }) }));
  on("session.cwd", () => ({ value: "/workspace" }));
  on("ui.open", () => ({ value: undefined }));
  on("process.run", () => ({ value: { exitCode: 0, stdout: JSON.stringify(data), stderr: "" } }));
  await $.command.run({ command: "testforce-ui", args: "" });
  const ui = await $.ui.mount(PANE);
  await ui.press({ key: "tab-results" });
    await ui.press({ key: "scenario-scenario-one" });
  expect(await ui.find({ type: "Text", text: "이전 부모" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /^9$/ })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: "수집 안 됨" })).toBeDefined();
  await ui.unmount();
});

test("five scenarios stay as a compact list and clicking a title explains without selecting it", async ($, on) => {
  const data: any = response(); const actions: any[] = [];
  const original = data.view.run.plan.scenarios[0];
  data.view.run.plan.scenarios = Array.from({ length: 5 }, (_, i) => ({ ...original, id: `s-${i}`, title: `시나리오 ${i + 1}`, purpose: `목적 ${i + 1}`, rationale: `분기 ${i + 1}`, selected: i !== 2 }));
  data.view.run.plan.records[0].scenarioId = "s-2";
  data.view.run.plan.expectations[0].scenarioId = "s-2";
  on("fs.read", () => ({ value: JSON.stringify({ bridgeEntry: "/engine/dist/mod/main.js", nodeExecutable: "/runtime/node" }) }));
  on("session.cwd", () => ({ value: "/workspace" }));
  on("ui.open", () => ({ value: undefined }));
  on("process.run", ($, e) => { if (e.argv[2] === "action") actions.push(JSON.parse(e.init.stdin)); return { value: { exitCode: 0, stdout: JSON.stringify(data), stderr: "" } }; });
  await $.command.run({ command: "testforce-ui", args: "" });
  const ui = await $.ui.mount({ ...PANE, viewport: { columns: 80, rows: 24 }, props: { ...PANE.props, bodyColumns: 74 } });
  for (let i = 0; i < 5; i++) expect(await ui.find({ key: `scenario-s-${i}` })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "왜 테스트하나요?" })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: "실행 전" })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: /실행 사용자:/ })).toBeUndefined();
  await ui.press({ key: "scenario-s-2" });
  expect(actions).toEqual([]);
  expect(data.view.run.plan.scenarios[2].selected).toBe(false);
  for (const title of ["왜 테스트하나요?", "준비하는 데이터", "실제로 하는 동작", "기대하는 결과"]) expect(await ui.find({ type: "Text", text: title })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "목적 3" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "분기 3" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /Amount__c: 9 → 10/ })).toBeDefined();
  await ui.press({ key: "scenario-back" });
  expect(await ui.find({ type: "Text", text: "왜 테스트하나요?" })).toBeUndefined();
  await ui.press({ key: "select-s-2" });
  expect(actions.length).toBe(1);
  expect(actions[0]).toMatchObject({ action: "select", scenarioIds: ["s-0", "s-1", "s-2", "s-3", "s-4"] });
  await ui.unmount();
});

test("approved tests have a direct primary engine action scoped to all selected scenarios", async ($, on) => {
  const data: any = response(); const actions: any[] = [];
  data.view.run.approvals = [{ scope: "execute", planVersion: 1, planHash: "hash-v1" }];
  on("fs.read", () => ({ value: JSON.stringify({ bridgeEntry: "/engine/dist/mod/main.js", nodeExecutable: "/runtime/node" }) }));
  on("session.cwd", () => ({ value: "/workspace" }));
  on("ui.open", () => ({ value: undefined }));
  on("process.run", ($, e) => {
    if (e.argv[2] === "action") {
      const payload = JSON.parse(e.init.stdin); actions.push(payload);
      data.view.run.scenarios["scenario-one"] = { status: "EXECUTED", baseline: {}, after: {}, jobs: [] };
      data.view.run.assertions = [{ assertionId: "amount", scenarioId: "scenario-one", status: "MATCH", actual: 11, expected: 11, message: "일치" }];
    }
    return { value: { exitCode: 0, stdout: JSON.stringify(data), stderr: "" } };
  });
  await $.command.run({ command: "testforce-ui", args: "" });
  const ui = await $.ui.mount(PANE);
  const start = await ui.find({ key: "run-tests" });
  expect(start?.props.label).toBe("▶ 테스트 시작 (선택 1개)");
  expect(await ui.find({ key: "prepare" })).toBeUndefined();
  expect(await ui.find({ key: "execute" })).toBeUndefined();
  await ui.press({ key: "run-tests" });
  expect(actions.length).toBe(1);
  expect(actions[0]).toMatchObject({ action: "run-tests", version: 1, hash: "hash-v1", runId: "run-ui" });
  expect(actions[0].scenarioId).toBeUndefined();
  expect(await ui.find({ key: "run-tests" })).toBeUndefined();
  expect(await ui.find({ key: "rerun-primary" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "실행 전" })).toBeUndefined();
  await ui.press({ key: "scenario-scenario-one" });
  expect(await ui.find({ type: "Text", text: "수량 · ✓ 일치" })).toBeDefined();
  await ui.unmount();
});

test("human-only plans offer preparation rather than a tool execution request", async ($, on) => {
  const data: any = response(); const actions: any[] = [];
  data.view.run.approvals = [{ scope: "execute", planVersion: 1, planHash: "hash-v1" }];
  data.view.run.plan.scenarios[0].execution = "human-ui";
  on("fs.read", () => ({ value: JSON.stringify({ bridgeEntry: "/engine/dist/mod/main.js", nodeExecutable: "/runtime/node" }) }));
  on("session.cwd", () => ({ value: "/workspace" }));
  on("ui.open", () => ({ value: undefined }));
  on("process.run", ($, e) => {
    if (e.argv[2] === "action") {
      actions.push(JSON.parse(e.init.stdin));
      data.view.run.scenarios["scenario-one"] = { status: "WAITING_HUMAN", baseline: {}, after: {}, jobs: [] };
    }
    return { value: { exitCode: 0, stdout: JSON.stringify(data), stderr: "" } };
  });
  await $.command.run({ command: "testforce-ui", args: "" });
  const ui = await $.ui.mount(PANE);
  expect(await ui.find({ key: "run-tests" })).toBeUndefined();
  await ui.press({ key: "prepare-human" });
  expect(actions.length).toBe(1);
  expect(actions[0].action).toBe("prepare");
  expect(await ui.find({ key: "prepare-human" })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: /사람 실행 대기/ })).toBeDefined();
  await ui.unmount();
});

test("six-row inline pane immediately offers a scenario and pages its explanation", async ($, on) => {
  const data: any = response(); const original = data.view.run.plan.scenarios[0];
  for (let i = 2; i <= 5; i++) data.view.run.plan.scenarios.push({ ...original, id: `s-${i}`, title: `시나리오 ${i}` });
  for (const scenario of data.view.run.plan.scenarios) data.view.run.scenarios[scenario.id] = { status: "EXECUTED", baseline: {}, after: {}, jobs: [] };
  data.view.run.assertions = [{ assertionId: "amount", scenarioId: "scenario-one", status: "MATCH", actual: 11, expected: 11, message: "일치" }];
  on("fs.read", () => ({ value: JSON.stringify({ bridgeEntry: "/engine/dist/mod/main.js", nodeExecutable: "/runtime/node" }) }));
  on("session.cwd", () => ({ value: "/workspace" }));
  on("ui.open", () => ({ value: undefined }));
  on("process.run", () => ({ value: { exitCode: 0, stdout: JSON.stringify(data), stderr: "" } }));
  await $.command.run({ command: "testforce-ui", args: "" });
  const ui = await $.ui.mount({ ...PANE, viewport: { columns: 80, rows: 24 }, props: { ...PANE.props, bodyColumns: 74, scroll: { offset: 0, bodyRows: 6 } } });
  expect(await ui.find({ type: "Text", text: /^오프라인$/ })).toBeDefined();
  expect(await ui.find({ key: "rerun-primary" })).toBeDefined();
  expect(await ui.find({ key: "scenario-scenario-one" })).toBeDefined();
  expect(await ui.find({ key: "scenario-s-2" })).toBeUndefined();
  expect(await ui.find({ key: "list-next" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /✓ 일치 1/ })).toBeUndefined();
  await ui.press({ key: "scenario-scenario-one" });
  expect(await ui.find({ type: "Text", text: "왜 테스트하나요?" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "서비스가 레코드 값을 변경하는지 확인" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "준비하는 데이터" })).toBeUndefined();
  await ui.press({ key: "story-next" });
  expect(await ui.find({ type: "Text", text: "준비하는 데이터" })).toBeDefined();
  await ui.press({ key: "story-results" });
  expect(await ui.find({ type: "Text", text: "실행 전" })).toBeDefined();
  await ui.press({ key: "story-next" });
  expect(await ui.find({ type: "Text", text: "왜 테스트하나요?" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "실행 전" })).toBeUndefined();
  await ui.press({ key: "scenario-back" });
  await ui.press({ key: "list-next" });
  expect(await ui.find({ key: "scenario-s-2" })).toBeDefined();
  await ui.unmount();
});

test("insert action explanations use exact action overrides rather than preparation defaults", async ($, on) => {
  const data: any = response();
  data.view.run.plan.records[0].stage = "action";
  data.view.run.plan.records[0].fields = { Text__c: { kind: "value", value: "default-plan-value" } };
  const action = data.view.run.plan.scenarios[0].actions[0];
  action.verb = "insert";
  action.fieldOverrides = { "record-one": { Text__c: { kind: "value", value: "actual-action-value" } } };
  on("fs.read", () => ({ value: JSON.stringify({ bridgeEntry: "/engine/dist/mod/main.js", nodeExecutable: "/runtime/node" }) }));
  on("session.cwd", () => ({ value: "/workspace" }));
  on("ui.open", () => ({ value: undefined }));
  on("process.run", () => ({ value: { exitCode: 0, stdout: JSON.stringify(data), stderr: "" } }));
  await $.command.run({ command: "testforce-ui", args: "" });
  const ui = await $.ui.mount(PANE);
  await ui.press({ key: "scenario-scenario-one" });
  expect(await ui.find({ type: "Text", text: /Text__c: actual-action-value/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /default-plan-value/ })).toBeUndefined();
  await ui.unmount();
});
