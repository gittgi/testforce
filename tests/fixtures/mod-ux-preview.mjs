// Manual terminal-layout fixture. Explicitly local Fake mode; no live Org,
// fabricated approval, company source, or Salesforce deployment is involved.
// Run after build: node tests/fixtures/mod-ux-preview.mjs
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../../dist/core/store.js";
import { Engine } from "../../dist/execution/engine.js";
import { createDemo, defaultAdapter } from "../../dist/cli/demo.js";
const workspace = await realpath(await mkdtemp(path.join(tmpdir(), "Testforce 간단 화면 ")));
const store = new Store(workspace);
await store.init();
const engine = new Engine(store, (r) => defaultAdapter(r, store.root));
let run = await createDemo(engine);
const base = structuredClone(run.plan);
const definitions = [
  { title: "신규 레코드의 상태 자동 설정", purpose: "상태를 입력하지 않고 저장해도 Status__c가 Ready로 설정되는지 확인합니다.", field: "Status__c", expected: "Ready" },
  { title: "입력한 상태가 자동화로 바뀌는 경우", purpose: "Status__c를 Draft로 보내면 저장 과정에서 Ready로 바뀌는지 확인합니다.", field: "Status__c", expected: "Ready", status: "Draft" },
  { title: "기대값과 실제값이 다른 경우", purpose: "비교 화면의 불일치 설명을 확인하는 UI fixture입니다. 실제 Ready와 다른 기대값 Complete를 명시적으로 설정했습니다.", field: "Status__c", expected: "Complete" },
  { title: "한글과 공백을 포함한 입력 보존", purpose: "이름에 포함된 한글과 공백이 저장 후에도 그대로 유지되는지 확인합니다.", field: "Name", expected: "한글 입력 보존", name: "한글 입력 보존" },
  { title: "기호를 포함한 이름의 저장", purpose: "이름의 기호가 코드로 해석되지 않고 원래 문자열로 저장되는지 확인합니다.", field: "Name", expected: "자료 & 비교 (테스트)", name: "자료 & 비교 (테스트)" },
];
const plan = {
  ...base,
  scenarios: definitions.map((item, i) => ({ ...structuredClone(base.scenarios[0]), id: `scenario-${i + 1}`, title: item.title, purpose: item.purpose, actions: [{ ...structuredClone(base.scenarios[0].actions[0]), id: `insert-${i + 1}`, recordKeys: [`record-${i + 1}`] }] })),
  records: definitions.map((item, i) => ({ ...structuredClone(base.records[0]), key: `record-${i + 1}`, scenarioId: `scenario-${i + 1}`, fields: { Name: { kind: "value", value: item.name ?? `화면 검증 ${i + 1}` }, ...(item.status ? { Status__c: { kind: "value", value: item.status } } : {}) } })),
  expectations: definitions.map((item, i) => ({ ...structuredClone(base.expectations[0]), id: `check-${i + 1}`, scenarioId: `scenario-${i + 1}`, label: item.field === "Name" ? "입력한 이름 보존" : "저장된 상태", subject: { kind: "record", key: `record-${i + 1}`, field: item.field }, expected: item.expected })),
};
run = await engine.edit(run.run_id, run.plan.version, plan);
console.log(JSON.stringify({ workspace, runId: run.run_id, mode: run.mode, version: run.plan.version, selectedScenarios: definitions.length, approved: run.approvals.length > 0 }, null, 2));
