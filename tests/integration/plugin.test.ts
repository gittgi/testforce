import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
const root = new URL("../../plugin/", import.meta.url);
describe("Claude Code plugin and interactive Mod contracts", () => {
  it("ships a manual-invocation skill with staged references and engine-only writes", async () => {
    const skill = await readFile(
      new URL("skills/testforce/SKILL.md", root),
      "utf8",
    );
    expect(skill).toContain("disable-model-invocation: true");
    expect(skill).toContain("엔진의 승인 진입점을 우회하지 않는다");
    for (const name of [
      "analysis",
      "planning",
      "execution",
      "files",
      "results",
    ]) {
      expect(skill).toContain(`references/${name}.md`);
      expect(
        (
          await readFile(
            new URL(`skills/testforce/references/${name}.md`, root),
            "utf8",
          )
        ).length,
      ).toBeGreaterThan(300);
    }
    const manifest = JSON.parse(
      await readFile(new URL(".claude-plugin/plugin.json", root), "utf8"),
    );
    expect(manifest.name).toBe("sandbox-workbench");
    expect(manifest.mcpServers).toBeUndefined();
  });
  it("uses only installed engine config, passes other panes, and never acts during render", async () => {
    const harness = await modHarness();
    await harness.call("session.start", { session: "test" });
    expect(harness.registered).toEqual([{ name: "testforce-ui", description: "Testforce 계획·실행·전후 비교·정리 패널" }]);
    await harness.call("command.run", {});
    expect(harness.opened).toHaveLength(1);
    expect(harness.calls.map((c: any) => c.operation)).toEqual(["view"]);
    expect(await harness.call("ui.render", { requestId: "other" })).toEqual({ passed: { requestId: "other" } });
    await harness.render(); await harness.render();
    expect(harness.calls).toHaveLength(1);
    expect(harness.configReads).toEqual(["/installed/testforce-panel/config.json"]);
    const source = await readFile(new URL("mod/hooks/register.js", root), "utf8");
    expect(source).not.toMatch(/\$\.(model|http|settings|prompt|mcp|tool)\./);
    expect(source).not.toMatch(/tool\.check|fs\.write|store\.set|eval\(/);
    expect(source).toContain("stdin: JSON.stringify");
  });
  it("double clicks dispatch once and approval requires the actual checkbox callback", async () => {
    const harness = await modHarness();
    await harness.call("command.run", {});
    let tree = await harness.render();
    expect(findKey(tree, "approve")).toBeUndefined();
    await findKey(tree, "review-check").props.onPress();
    tree = await harness.render();
    let release!: () => void;
    harness.delay = new Promise<void>((resolve) => { release = resolve; });
    const callback = findKey(tree, "approve").props.onPress;
    const first = callback();
    await callback();
    release(); await first;
    const actions = harness.calls.filter((c: any) => c.operation === "action");
    expect(actions).toHaveLength(1);
    expect(actions[0].payload).toMatchObject({ action: "approve", reviewed: true, version: 1, hash: "hash-v1" });
  });
  it("stale callbacks, unknown writes, and truncated process output cannot trigger more writes", async () => {
    const harness = await modHarness();
    await harness.call("command.run", {});
    const oldTree = await harness.render();
    const oldSelect = findKey(oldTree, "select-scenario-one").props.onPress;
    harness.data.view.run.plan.version = 2; harness.data.view.run.plan.hash = "hash-v2";
    await findKey(oldTree, "refresh").props.onPress();
    await oldSelect();
    expect(harness.calls.filter((c: any) => c.operation === "action")).toHaveLength(0);
    harness.data.view.run.operations = [{ state: "UNKNOWN" }];
    await findKey(await harness.render(), "refresh").props.onPress();
    expect(findKey(await harness.render(), "review-check")).toBeUndefined();
    harness.truncated = true;
    await findKey(await harness.render(), "refresh").props.onPress();
    expect(JSON.stringify(await harness.render())).toContain("엔진 응답이 너무 큽니다");
    expect(findKey(await harness.render(), "review-check")).toBeUndefined();
  });
  it("renders full approval details on demand and compact comparison columns at 70 characters", async () => {
    const harness = await modHarness();
    harness.data.view.run.plan.scenarios[0].actions[0].script = "String value = '매우 긴 값';\nSystem.debug(value);";
    harness.data.view.run.scenarios = { "scenario-one": { status: "EXECUTED", baseline: {}, after: {}, jobs: [] } };
    harness.data.view.run.assertions = [{ assertionId: "amount", scenarioId: "scenario-one", status: "MISMATCH", before: 9, actual: 10, expected: 11, message: "기대와 다릅니다" }];
    await harness.call("command.run", {});
    let tree = await harness.render();
    expect(JSON.stringify(tree)).not.toContain("String value");
    await findKey(tree, "scenario-scenario-one").props.onPress();
    await findKey(await harness.render(), "plan-detail").props.onPress();
    expect(JSON.stringify(await harness.render())).toContain("System.debug(value)");
    await findKey(await harness.render(), "tab-results").props.onPress();
    await findKey(await harness.render(), "scenario-scenario-one").props.onPress();
    tree = await harness.render(70);
    const rendered = JSON.stringify(tree);
    expect(rendered).toContain("실행 전"); expect(rendered).toContain("실행 후"); expect(rendered).toContain("기대 결과");
    expect(rendered).toContain("≠ 불일치"); expect(rendered).not.toContain('"actual":10');
  });
});

function findKey(node: any, key: string): any {
  if (!node || typeof node !== "object") return undefined;
  if (node.props?.key === key) return node;
  for (const child of node.props?.children ?? []) { const found = findKey(child, key); if (found) return found; }
  return undefined;
}
async function modHarness() {
  vi.resetModules();
  const { response } = await import("../../plugin/mod/tests/fixture");
  const { register } = await import("../../plugin/mod/hooks/register.js");
  const handlers: any[] = [];
  register((name: string, filter: any, fn?: Function) => handlers.push({ name, filter: typeof filter === "object" ? filter : {}, fn: fn ?? filter }));
  const h: any = { data: response(), calls: [], registered: [], opened: [], configReads: [], delay: undefined, truncated: false };
  const next = async (e: unknown) => ({ passed: e });
  const $ = {
    plugin: { root: "/installed/testforce-panel" },
    fs: { read: async (path: string) => { h.configReads.push(path); return JSON.stringify({ bridgeEntry: "/engine/dist/mod/main.js", nodeExecutable: "/runtime/node" }); } },
    session: { cwd: async () => "/workspace 한글" },
    process: { run: async (argv: string[], init: any) => {
      expect(argv).toHaveLength(3);
      expect(argv).toEqual(["/runtime/node", "/engine/dist/mod/main.js", argv[2]]);
      const payload = JSON.parse(init.stdin); h.calls.push({ operation: argv[2], payload });
      if (argv[2] === "action" && h.delay) await h.delay;
      return { exitCode: 0, stdout: JSON.stringify(h.data), stderr: "", isStdoutTruncated: h.truncated };
    } },
    command: { register: async (v: any) => h.registered.push(v) },
    ui: {
      open: async (v: any) => h.opened.push(v), invalidate: () => {},
      resolve: () => Object.fromEntries(["Box", "Text", "Button", "Input", "Select"].map((type) => [type, (props: any) => ({ type, props })])),
    },
  };
  h.call = (name: string, event: any) => handlers.find((x) => x.name === name).fn($, event, next);
  h.render = (columns = 100) => h.call("ui.render", { requestId: "testforce", props: { bodyColumns: columns } });
  return h;
}
