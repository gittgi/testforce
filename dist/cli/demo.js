/** Explicit offline demonstration fixtures. Never used by the live adapter. */
import { promises as fs } from "node:fs";
import { realpathSync } from "node:fs";
import path from "node:path";
import { PlanSchema } from "../core/model.js";
import { FakeAdapter, SfCliAdapter } from "../salesforce/index.js";
import { offlineOptions } from "./fake-config.js";
export const demoSchema = {
    name: "Example__c",
    createable: true,
    updateable: true,
    deletable: true,
    fields: [
        {
            name: "Id",
            type: "id",
            nillable: false,
            defaultedOnCreate: true,
            createable: false,
            updateable: false,
        },
        {
            name: "Name",
            type: "string",
            length: 80,
            nillable: false,
            defaultedOnCreate: false,
            createable: true,
            updateable: true,
        },
        {
            name: "Status__c",
            type: "string",
            length: 40,
            nillable: true,
            defaultedOnCreate: false,
            createable: true,
            updateable: true,
        },
        {
            name: "LastModifiedDate",
            type: "datetime",
            nillable: false,
            defaultedOnCreate: true,
            createable: false,
            updateable: false,
        },
    ],
};
export function defaultAdapter(run, stateRoot) {
    if (run.mode === "live")
        return new SfCliAdapter(run.target, run.sourceRoot);
    let demo = false;
    try {
        demo = run.sourceRoot === realpathSync(path.join(stateRoot, "demo-source"));
    }
    catch { }
    if (!demo)
        return new FakeAdapter(offlineOptions(run, stateRoot));
    return new FakeAdapter({
        statePath: path.join(stateRoot, "runs", run.run_id, "fake-org.json"),
        identity: { alias: run.target },
        sourceFiles: run.source?.files,
        schemas: [demoSchema],
        mutationHook(request, state) {
            if (request.verb === "insert" && request.object === "Example__c")
                for (const row of Object.values(state.records.Example__c ?? {}))
                    row.Status__c = "Ready";
        },
    });
}
export async function createDemo(engine) {
    const dir = path.join(engine.store.root, "demo-source");
    await fs.mkdir(path.join(dir, "force-app/main/default/triggers"), {
        recursive: true,
    });
    await fs.writeFile(path.join(dir, "sfdx-project.json"), JSON.stringify({
        packageDirectories: [{ path: "force-app", default: true }],
        sourceApiVersion: "66.0",
    }));
    await fs.writeFile(path.join(dir, "force-app/main/default/triggers/ExampleTrigger.trigger"), "trigger ExampleTrigger on Example__c (before insert) {\n    for (Example__c row : Trigger.new) row.Status__c = 'Ready';\n}\n");
    await fs.writeFile(path.join(dir, "force-app/main/default/triggers/ExampleTrigger.trigger-meta.xml"), "<ApexTrigger><apiVersion>66.0</apiVersion><status>Active</status></ApexTrigger>");
    const run = await engine.create("fake", "offline", dir);
    await engine.analyze(run.run_id, "ExampleTrigger");
    const analyzed = await engine.store.load(run.run_id);
    const org = await engine.adapterFor(analyzed).identity();
    const plan = PlanSchema.parse({
        schemaVersion: 1,
        plan_id: "offline-plan",
        version: 1,
        hash: "",
        org,
        source: analyzed.source,
        scenarios: [
            {
                id: "insert-example",
                title: "오프라인 Insert 흐름",
                purpose: "준비와 실행 분리 및 결과 비교를 확인합니다.",
                rationale: "명시적인 로컬 가상 코드와 Fake Adapter 동작입니다. 실제 Salesforce 검증이 아닙니다.",
                sourceRefs: [
                    {
                        path: "force-app/main/default/triggers/ExampleTrigger.trigger",
                        symbol: "ExampleTrigger",
                        line: 1,
                    },
                ],
                selected: true,
                execution: "tool",
                actions: [
                    {
                        id: "insert",
                        kind: "dml",
                        verb: "insert",
                        object: "Example__c",
                        recordKeys: ["row-1"],
                        allOrNone: true,
                        impact: {
                            description: "오프라인 신규 레코드 한 개",
                            bounded: true,
                        },
                    },
                ],
                observation: { pollMs: 100, timeoutMs: 1000 },
            },
        ],
        records: [
            {
                key: "row-1",
                scenarioId: "insert-example",
                object: "Example__c",
                stage: "action",
                ownership: "created",
                fields: { Name: { kind: "value", value: "오프라인 예제" } },
            },
        ],
        expectations: [
            {
                id: "ready",
                scenarioId: "insert-example",
                label: "실행 후 Status__c",
                subject: { kind: "record", key: "row-1", field: "Status__c" },
                operator: "eq",
                expected: "Ready",
            },
        ],
        policies: { existingMutation: false, notes: "명시적 오프라인 시뮬레이션" },
        constraints: [],
    });
    return engine.submit(run.run_id, {
        run_id: run.run_id,
        request_id: analyzed.analysisRequest.request_id,
        source_snapshot_hash: analyzed.source.hash,
        plan_version: 0,
        plan,
    });
}
