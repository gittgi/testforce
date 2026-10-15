import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ModBridge, modRequest } from "../../src/mod/bridge.js";
import { Engine } from "../../src/execution/engine.js";
import { Store } from "../../src/core/store.js";
import { contentHash } from "../../src/core/hash.js";
import { ActionSchema, type SalesforceAdapter } from "../../src/core/model.js";
import { testEngine, scenario, inputRecord, fixtureRecord, assertion } from "../helpers.js";

type Screen = Awaited<ReturnType<ModBridge["view"]>>;
function actionInput(screen: Screen, action: string, extra: Record<string, unknown> = {}) {
  const run = screen.view.run!;
  return {
    workspace: screen.view.workspace, runId: run.run_id,
    version: run.plan!.version, hash: run.plan!.hash,
    capability: screen.capability, action, ...extra,
  };
}
async function setup() {
  const t = await testEngine();
  await t.submit();
  return { ...t, bridge: new ModBridge(t.engine) };
}

describe("serverless Mod bridge", () => {
  it("shows actual persisted state without contacting an Org or starting HTTP", async () => {
    const t = await setup();
    const bridge = new ModBridge(new Engine(t.store, () => { throw Error("view must not contact adapter"); }));
    const screen = await bridge.view();
    expect(screen.view.run?.run_id).toBe(t.id);
    expect(screen.view.run?.plan?.scenarios[0]?.title).toBe("scenario");
    expect(screen.capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(screen.view.runs).toEqual([expect.objectContaining({ run_id: t.id, mode: "fake", planVersion: 1 })]);
    const disk = await fs.readFile(path.join(t.store.root, "mod-actions", `${contentHash(screen.capability!)}.json`), "utf8");
    expect(disk).not.toContain(screen.capability);
    expect(await fs.readFile(path.join(t.store.dir(t.id), "state.json"), "utf8")).not.toContain(screen.capability);
  });

  it("does not initialize an arbitrary source workspace just by opening its panel", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "Mod 빈 폴더 "));
    const bridge = new ModBridge(new Engine(new Store(root), () => { throw Error("no adapter"); }));
    expect(await bridge.view()).toEqual({ ok: true, view: { workspace: await fs.realpath(root), initialized: false, run: null, runs: [] } });
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("requires the checkbox and records the Mod actor without an approver name/date", async () => {
    const t = await setup();
    let screen = await t.bridge.view();
    for (const reviewed of [undefined, false]) {
      await expect(t.bridge.action(actionInput(screen, "approve", { reviewed })))
        .rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    }
    expect((await t.store.load(t.id)).approvals).toEqual([]);
    screen = await t.bridge.action(actionInput(screen, "approve", { reviewed: true }));
    expect(screen.view.run!.approvals[0]).toMatchObject({ actor: "로컬 Mod 사용자", channel: "mod", scope: "execute" });
    expect((await t.getAdapter().inspectState()).writes).toBe(0);
  });

  it("runs prepare/execute/collect/review/reports/keep with the same engine and evidence", async () => {
    const t = await setup();
    let screen = await t.bridge.view();
    screen = await t.bridge.action(actionInput(screen, "approve", { reviewed: true }));
    for (const action of ["prepare", "execute", "collect"]) screen = await t.bridge.action(actionInput(screen, action));
    expect(screen.view.run!.assertions[0]).toMatchObject({ status: "MATCH", expected: "after", actual: "after" });
    expect(screen.view.run!.bindings.input!.after!.Text__c).toBe("after");
    expect(screen.view.run!.mode).toBe("fake");
    screen = await t.bridge.action(actionInput(screen, "review", { verdict: "accepted", notes: "표 비교 확인" }));
    expect(screen.view.run!.review).toMatchObject({ verdict: "accepted", actor: "로컬 Mod 사용자" });
    screen = await t.bridge.action(actionInput(screen, "reports"));
    expect(screen.view.files).toContain("test-report.md");
    expect(await fs.readFile(path.join(t.store.dir(t.id), "test-report.md"), "utf8")).toContain("오프라인 시뮬레이션");
    expect(screen.view.run!.cleanup.decision).toBe("pending");
    screen = await t.bridge.action(actionInput(screen, "keep"));
    expect(screen.view.run!.cleanup.status).toBe("kept");
    expect((await t.getAdapter().inspectState()).writes).toBe(1);
  });

  it("starts and compares approved tool tests with one explicit run-tests action", async () => {
    const t = await setup();
    let screen = await t.bridge.view();
    screen = await t.bridge.action(actionInput(screen, "approve", { reviewed: true }));
    const request = actionInput(screen, "run-tests");
    screen = await t.bridge.action(request);
    expect(screen.view.run!.scenarios.scenario!.status).toBe("EXECUTED");
    expect(screen.view.run!.assertions[0]).toMatchObject({ status: "MATCH", actual: "after" });
    expect(screen.view.run!.operations).toHaveLength(1);
    expect(screen.view.run!.cleanup.decision).toBe("pending");
    await expect(t.bridge.action(request)).rejects.toMatchObject({ code: "MOD_ACTION_EXPIRED" });
    await expect(t.bridge.action(actionInput(screen, "run-tests"))).rejects.toMatchObject({ code: "ALREADY_EXECUTED" });
    expect((await t.getAdapter().inspectState()).writes).toBe(1);
  });

  it("requires execution approval before even preparing fixtures for the combined button", async () => {
    const t = await testEngine();
    t.plan.records.push(fixtureRecord());
    await t.submit();
    const bridge = new ModBridge(t.engine);
    let screen = await bridge.view();
    await expect(bridge.action(actionInput(screen, "run-tests"))).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await t.approve("prepare");
    screen = await bridge.view();
    await expect(bridge.action(actionInput(screen, "run-tests"))).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect((await t.getAdapter().inspectState()).writes).toBe(0);
  });

  it.each(["identity", "source"] as const)("revalidates changed %s before combined preparation or execution", async changed => {
    const t = await testEngine();
    t.plan.records.push(fixtureRecord());
    await t.submit(); await t.approve();
    const bridge = new ModBridge(t.engine);
    const screen = await bridge.view();
    if (changed === "identity") t.setIdentity({ username: "another-user@example.invalid" });
    else await fs.appendFile(path.join(t.root, "force-app", "ProbeService.cls"), "\n// local source changed");
    await expect(bridge.action(actionInput(screen, "run-tests")))
      .rejects.toMatchObject({ code: changed === "identity" ? "ORG_CHANGED" : "SOURCE_CHANGED" });
    expect((await t.getAdapter().inspectState()).writes).toBe(0);
    expect((await t.store.load(t.id)).operations).toEqual([]);
  });

  it("prepares mixed-plan fixtures but never sends human Insert actions", async () => {
    const t = await testEngine();
    t.plan.scenarios.push(scenario("manual", { execution: "human-ui" }));
    t.plan.records.push(fixtureRecord("manualParent", "manual"), inputRecord("manualInput", "manual"));
    t.plan.expectations.push(assertion("manual", "manualInput"));
    await t.submit(); await t.approve();
    const bridge = new ModBridge(t.engine);
    const screen = await bridge.action(actionInput(await bridge.view(), "run-tests"));
    expect(screen.view.run!.scenarios.scenario!.status).toBe("EXECUTED");
    expect(screen.view.run!.scenarios.manual!.status).toBe("WAITING_HUMAN");
    expect(screen.view.run!.bindings.manualParent).toBeDefined();
    expect(screen.view.run!.bindings.manualInput).toBeUndefined();
    expect(screen.view.run!.operations.filter((op) => op.scenarioId === "manual").map((op) => op.phase)).toEqual(["prepare"]);
    expect(screen.view.run!.assertions.find((r) => r.scenarioId === "manual")!.status).toBe("NOT_EXECUTED");
    expect((await t.getAdapter().inspectState()).writes).toBe(2);
  });

  it("keeps preparation failures and blocked dependencies while running independent scenarios", async () => {
    const t = await testEngine({ failRows: row => row.key === "badFixture" ? { code: "VALIDATION_ERROR", message: "fixture rejected" } : undefined });
    t.plan.scenarios = [scenario("bad"), scenario("dependent", { dependsOn: ["bad"] }), scenario("independent")];
    t.plan.records = [fixtureRecord("badFixture", "bad"), ...["bad", "dependent", "independent"].map(id => inputRecord(`${id}Input`, id))];
    t.plan.expectations = ["bad", "dependent", "independent"].map(id => assertion(id, `${id}Input`));
    await t.submit(); await t.approve();
    const bridge = new ModBridge(t.engine);
    const screen = await bridge.action(actionInput(await bridge.view(), "run-tests"));
    expect(screen.view.run!.scenarios.bad!.status).toBe("PREPARE_FAILED");
    expect(screen.view.run!.scenarios.dependent!.status).toBe("BLOCKED");
    expect(screen.view.run!.scenarios.independent!.status).toBe("EXECUTED");
    expect(screen.view.run!.assertions.map(r => [r.scenarioId, r.status])).toEqual([
      ["bad", "NOT_EXECUTED"], ["dependent", "NOT_EXECUTED"], ["independent", "MATCH"],
    ]);
    const writes = (await t.getAdapter().inspectState()).writes;
    await expect(bridge.action(actionInput(screen, "run-tests"))).rejects.toMatchObject({ code: "RUN_REVIEW_REQUIRED" });
    expect((await t.getAdapter().inspectState()).writes).toBe(writes);
  });

  it("registers a Batch once without polling or reporting unfinished work as a match", async () => {
    let started = 0;
    const jobId = "707000000000001AAA";
    const t = await testEngine({ apexHandler: (_script, _correlation, state) => {
      started++;
      state.jobs[jobId] = { id: jobId, status: "Processing", errors: 0, processed: 0, total: 1, done: false };
      return { success: true, compiled: true, returnCaptured: false, jobId };
    } });
    t.plan.records = [];
    t.plan.scenarios = [scenario("scenario", { actions: [ActionSchema.parse({
      id: "batch", kind: "batch", className: "ProbeService",
      scopeQuery: { object: "Probe__c", fields: ["Id"], where: [], limit: 100 }, approvedScopeIds: [],
      impact: { description: "오프라인 empty batch scope", bounded: true },
    })] })];
    t.plan.expectations = [assertion("scenario", jobId, { subject: { kind: "job", key: jobId, field: "status" }, expected: "Completed" })];
    await t.submit(); await t.approve();
    let jobReads = 0;
    const engine = new Engine(t.store, run => {
      const adapter = t.engine.adapterFor(run), original = adapter.job.bind(adapter);
      adapter.job = async id => { jobReads++; return original(id); };
      return adapter;
    });
    const bridge = new ModBridge(engine);
    const screen = await bridge.action(actionInput(await bridge.view(), "run-tests"));
    expect(started).toBe(1);
    expect(jobReads).toBe(2); // registration evidence + one collection, no observe loop
    expect(screen.view.run!.scenarios.scenario!.status).toBe("WAITING_ASYNC");
    expect(screen.view.run!.scenarios.scenario!.jobs[0]).toMatchObject({ id: jobId, status: "Processing", done: false });
    expect(screen.view.run!.assertions[0]!.status).toBe("UNVERIFIABLE");
    await expect(bridge.action(actionInput(screen, "run-tests"))).rejects.toMatchObject({ code: "RUN_OBSERVATION_REQUIRED" });
    expect(started).toBe(1);
  });

  it("does not re-send completed scenarios when continuing other prepared tool work", async () => {
    const t = await testEngine();
    t.plan.scenarios.push(scenario("second"));
    t.plan.records.push(inputRecord("secondInput", "second"));
    t.plan.expectations.push(assertion("second", "secondInput"));
    await t.submit(); await t.approve();
    await t.engine.prepare(t.id, 1);
    // Complete exactly the first scenario as an explicitly local recovery fixture.
    await t.engine.change(t.id, async (run, adapter) => {
      const first = run.plan!.scenarios[0]!;
      await t.engine.executeAction(run, adapter, first, first.actions[0]!);
      run.scenarios.scenario!.status = "EXECUTED";
    });
    const bridge = new ModBridge(t.engine);
    const screen = await bridge.action(actionInput(await bridge.view(), "run-tests"));
    expect(screen.view.run!.scenarios.second!.status).toBe("EXECUTED");
    expect(screen.view.run!.operations.filter((op) => op.scenarioId === "scenario")).toHaveLength(1);
    expect((await t.getAdapter().inspectState()).writes).toBe(2);
  });

  it("stops the combined workflow from sending further writes after an unknown acknowledgement", async () => {
    const t = await setup();
    await t.approve();
    const interrupted = new Engine(t.store, run => {
      const adapter = t.engine.adapterFor(run), original = adapter.mutate.bind(adapter);
      adapter.mutate = async request => { await original(request); throw Error("lost acknowledgement"); };
      return adapter;
    });
    const bridge = new ModBridge(interrupted);
    const screen = await bridge.action(actionInput(await bridge.view(), "run-tests"));
    expect(screen.view.run!.operations[0]!.state).toBe("UNKNOWN");
    expect(screen.view.run!.assertions[0]!.status).toBe("UNVERIFIABLE");
    await expect(bridge.action(actionInput(screen, "run-tests"))).rejects.toMatchObject({ code: "UNKNOWN_WRITE" });
    expect((await t.getAdapter().inspectState()).writes).toBe(1);
  });

  it("blocks approval-less writes, replay and concurrent double-clicks", async () => {
    const t = await setup();
    let screen = await t.bridge.view();
    await expect(t.bridge.action(actionInput(screen, "prepare"))).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await expect(t.bridge.action(actionInput(screen, "prepare"))).rejects.toMatchObject({ code: "MOD_ACTION_EXPIRED" });
    screen = await t.bridge.view();
    const request = actionInput(screen, "approve", { reviewed: true });
    const responses = await Promise.allSettled([t.bridge.action(request), t.bridge.action(request)]);
    expect(responses.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await t.store.load(t.id)).approvals).toHaveLength(1);
    expect((await t.getAdapter().inspectState()).writes).toBe(0);
  });

  it("invalidates a displayed capability after plan selection or another state change", async () => {
    const t = await setup();
    const old = await t.bridge.view();
    const selected = await t.bridge.action(actionInput(old, "select", { scenarioIds: [] }));
    expect(selected.view.run!.plan!.version).toBe(2);
    expect(selected.view.run!.plan!.scenarios[0]!.selected).toBe(false);
    expect(selected.view.run!.approvals).toEqual([]);
    await expect(t.bridge.action({ ...actionInput(selected, "approve", { reviewed: true }), version: 1 }))
      .rejects.toMatchObject({ code: "MOD_ACTION_EXPIRED" });
    await t.engine.pause(t.id);
    await expect(t.bridge.action(actionInput(selected, "approve", { reviewed: true })))
      .rejects.toMatchObject({ code: "MOD_VIEW_CHANGED" });
  });

  it("expires capabilities and rejects plan contents changed without resealing", async () => {
    const t = await setup();
    let now = Date.now();
    const bridge = new ModBridge(t.engine, () => now);
    const screen = await bridge.view();
    now += 5 * 60 * 1000;
    await expect(bridge.action(actionInput(screen, "approve", { reviewed: true })))
      .rejects.toMatchObject({ code: "MOD_ACTION_EXPIRED" });
    const fresh = await t.bridge.view();
    const run = await t.store.load(t.id);
    run.plan!.expectations[0]!.expected = "tampered";
    await t.store.save(run);
    await expect(t.bridge.action(actionInput(fresh, "approve", { reviewed: true })))
      .rejects.toMatchObject({ code: "PLAN_TAMPERED" });
  });

  it("only approves cleanup of the exact preview the user reviewed", async () => {
    const t = await setup();
    let screen = await t.bridge.view();
    screen = await t.bridge.action(actionInput(screen, "approve", { reviewed: true }));
    for (const action of ["prepare", "execute", "collect"]) screen = await t.bridge.action(actionInput(screen, action));
    await expect(t.bridge.action(actionInput(screen, "cleanup", { reviewed: true })))
      .rejects.toMatchObject({ code: "CLEANUP_PREVIEW_REQUIRED" });
    screen = await t.bridge.action(actionInput(screen, "cleanup-preview"));
    expect(screen.view.cleanupPreview!.records).toHaveLength(1);
    await expect(t.bridge.action(actionInput(screen, "cleanup"))).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    screen = await t.bridge.action(actionInput(screen, "cleanup", { reviewed: true }));
    expect(screen.view.run!.cleanup.status).toBe("complete");
    expect(screen.view.run!.approvals.at(-1)).toMatchObject({ scope: "cleanup", channel: "mod" });
  });

  it("does not clean records changed after the preview", async () => {
    const t = await setup();
    let screen = await t.bridge.view();
    screen = await t.bridge.action(actionInput(screen, "approve", { reviewed: true }));
    for (const action of ["prepare", "execute", "collect", "cleanup-preview"]) screen = await t.bridge.action(actionInput(screen, action));
    await t.getAdapter().mutate({ object: "Probe__c", verb: "update", allOrNone: true,
      records: [{ key: "input", id: screen.view.run!.bindings.input!.id, fields: { Text__c: "another user changed it" } }] });
    await expect(t.bridge.action(actionInput(screen, "cleanup", { reviewed: true })))
      .rejects.toMatchObject({ code: "CLEANUP_CHANGED" });
    expect((await t.store.load(t.id)).cleanup.status).toBe("pending");
  });

  it("keeps source and identity checks at the execution boundary", async () => {
    const t = await setup();
    let screen = await t.bridge.view();
    screen = await t.bridge.action(actionInput(screen, "approve", { reviewed: true }));
    t.setIdentity({ username: "changed@example.invalid" });
    await expect(t.bridge.action(actionInput(screen, "prepare"))).rejects.toMatchObject({ code: "ORG_CHANGED" });
    expect((await t.getAdapter().inspectState()).writes).toBe(0);
    t.setIdentity({ username: "offline@example.invalid" });
    screen = await t.bridge.view();
    await fs.appendFile(path.join(t.root, "force-app", "ProbeService.cls"), "\n// changed source");
    await expect(t.bridge.action(actionInput(screen, "prepare"))).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
  });

  it("preserves the production gate using only an offline adapter stub", async () => {
    const t = await testEngine({}, fake => new Proxy(fake, { get(target, prop) {
      if (prop === "mode") return "live";
      if (prop === "identity") return async () => ({ ...await fake.identity(), mode: "live", isSandbox: false, organizationType: "Enterprise Edition" });
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    } }) as SalesforceAdapter);
    await t.submit();
    const bridge = new ModBridge(t.engine);
    const screen = await bridge.view();
    await expect(bridge.action(actionInput(screen, "approve", { reviewed: true }))).rejects.toMatchObject({ code: "NON_PRODUCTION_REQUIRED" });
    expect((await t.getAdapter().inspectState()).writes).toBe(0);
  });

  it("preserves unknown writes and never automatically retries them after restart", async () => {
    const t = await setup();
    let screen = await t.bridge.view();
    screen = await t.bridge.action(actionInput(screen, "approve", { reviewed: true }));
    screen = await t.bridge.action(actionInput(screen, "prepare"));
    const interrupted = new ModBridge(new Engine(t.store, run => {
      const adapter = t.engine.adapterFor(run);
      const original = adapter.mutate.bind(adapter);
      adapter.mutate = async request => { await original(request); throw Error("acknowledgement lost"); };
      return adapter;
    }));
    screen = await interrupted.action(actionInput(screen, "execute"));
    expect(screen.view.run!.operations[0]!.state).toBe("UNKNOWN");
    const restarted = new ModBridge(new Engine(t.store, t.engine.adapterFor));
    screen = await restarted.view(t.id);
    await expect(restarted.action(actionInput(screen, "execute"))).rejects.toMatchObject({ code: "UNKNOWN_WRITE" });
    expect((await t.store.load(t.id)).operations[0]!.state).toBe("UNKNOWN");
    expect((await t.getAdapter().inspectState()).writes).toBe(1);
  });

  it("pause/resume and rerun preserve history while giving a fresh execution identity", async () => {
    const t = await setup();
    let screen = await t.bridge.view();
    screen = await t.bridge.action(actionInput(screen, "pause"));
    expect(screen.view.run!.paused).toBe(true);
    screen = await t.bridge.action(actionInput(screen, "resume"));
    expect(screen.view.run!.paused).toBe(false);
    screen = await t.bridge.action(actionInput(screen, "rerun"));
    expect(screen.view.run!.run_id).not.toBe(t.id);
    expect(screen.view.run!.parent_run_id).toBe(t.id);
    expect(screen.view.run!.approvals).toEqual([]);
    expect(screen.view.runs).toHaveLength(2);
  });

  it("rejects arbitrary commands, forged approval fields and traversal without exposing capability", async () => {
    const t = await setup();
    const screen = await t.bridge.view();
    for (const extra of [{ action: "exec" }, { approved: true }, { actor: "forged" }, { at: "2000-01-01" }, { runId: "../outside" }]) {
      const response = await modRequest("action", { ...actionInput(screen, "approve", { reviewed: true }), ...extra }, () => t.engine);
      expect(response.ok).toBe(false);
      expect(JSON.stringify(response)).not.toContain(screen.capability);
    }
    expect((await t.store.load(t.id)).approvals).toEqual([]);
    expect(await modRequest("shell", {}, () => t.engine)).toMatchObject({ ok: false, error: { code: "MOD_COMMAND" } });
  });

  it("guards capability paths against symlink escapes", async () => {
    const t = await setup();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "Mod outside "));
    await fs.symlink(outside, path.join(t.store.root, "mod-actions"), "dir");
    await expect(t.bridge.view()).rejects.toMatchObject({ code: "SYMLINK_DENIED" });
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it("redacts credentials from the display without changing stored business data", async () => {
    const t = await setup();
    const run = await t.store.load(t.id);
    run.aiNotes.push({ at: new Date().toISOString(), text: "Bearer DO_NOT_SHOW", evidenceRefs: [] });
    await t.store.save(run);
    const screen = await t.bridge.view();
    expect(JSON.stringify(screen)).not.toContain("DO_NOT_SHOW");
    expect((await t.store.load(t.id)).aiNotes[0]!.text).toContain("DO_NOT_SHOW");
  });

  it("uses bounded stdin JSON through the real CLI process with Korean/space paths", async () => {
    const t = await setup();
    const entry = fileURLToPath(new URL("../../src/mod/main.ts", import.meta.url));
    const launch = (args: string[], stdin: string) => new Promise<{ code: number | null; out: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", entry, ...args], { shell: false, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", chunk => out += chunk);
      child.on("error", reject);
      child.on("close", code => resolve({ code, out }));
      child.stdin.end(stdin);
    });
    const response = await launch(["view"], JSON.stringify({ workspace: t.root }));
    expect(response.code).toBe(0);
    expect(JSON.parse(response.out)).toMatchObject({ ok: true, view: { run: { run_id: t.id } } });
    const invalid = await launch(["action"], '{"capability":"DO_NOT_LEAK"');
    expect(invalid.code).toBe(1);
    expect(invalid.out).not.toContain("DO_NOT_LEAK");
    expect(JSON.parse(invalid.out)).toMatchObject({ ok: false, error: { code: "MOD_PROTOCOL" } });
    expect((await launch(["action", "argument-secret"], "")).code).toBe(1);
  });
});
