import { describe, expect, it } from "vitest";
import { command } from "../../src/server/commands.js";
import { startServer } from "../../src/server/http.js";
import type { Run } from "../../src/core/model.js";
import { scenario, testEngine } from "../helpers.js";

describe("simple human approvals", () => {
  it("accepts a checkbox and click without approver/date input while ignoring forged identity", async () => {
    const t = await testEngine();
    const submitted = await t.submit();
    const server = await startServer(t.engine, { uiRoot: t.root });
    try {
      const auth = await fetch(`${server.url}/api/session`, {
        method: "POST",
        headers: { Origin: server.url, "Content-Type": "application/json" },
        body: JSON.stringify({ token: server.token }),
      });
      const { csrf } = (await auth.json()) as { csrf: string };
      const headers = {
        Origin: server.url,
        Cookie: auth.headers.get("set-cookie")!.split(";")[0]!,
        "X-WB-CSRF": csrf,
        "Content-Type": "application/json",
      };
      const approve = (extra: Record<string, unknown>) =>
        fetch(`${server.url}/api/runs/${t.id}/command`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            command: "approve",
            version: 1,
            hash: submitted.plan!.hash,
            scope: "execute",
            ...extra,
          }),
        });
      for (const reviewed of [undefined, false, "true"]) {
        const response = await approve({ reviewed, actor: "forged approver", approved: true });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "REVIEW_REQUIRED" });
      }
      expect((await t.store.load(t.id)).approvals).toEqual([]);
      const response = await approve({
        reviewed: true,
        actor: "forged approver",
        at: "2000-01-01T00:00:00.000Z",
      });
      expect(response.status).toBe(200);
      const { run } = (await response.json()) as { run: Run };
      expect(run.approvals[0]).toMatchObject({
        actor: "로컬 브라우저 사용자",
        channel: "browser",
        planVersion: 1,
        planHash: submitted.plan!.hash,
        username: submitted.plan!.org.username,
      });
      expect(run.approvals[0]!.at).not.toBe("2000-01-01T00:00:00.000Z");
      // Approval records the choice; it does not perform a Salesforce write.
      expect((await t.getAdapter().inspectState()).writes).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("keeps human action, plan version/hash, and reapproval protections", async () => {
    const t = await testEngine();
    const submitted = await t.submit();
    const input = {
      command: "approve",
      reviewed: true,
      version: 1,
      hash: submitted.plan!.hash,
      scope: "execute",
    };
    await expect(command(t.engine, t.id, input, "terminal", false))
      .rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
    await expect(command(t.engine, t.id, { ...input, version: 99 }, "browser", true))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(command(t.engine, t.id, { ...input, hash: "changed" }, "browser", true))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const result = await command(t.engine, t.id, input, "terminal", true);
    expect((result.run as Run).approvals[0]!.actor).toBe("로컬 터미널 사용자");
    const edited = structuredClone(submitted.plan!);
    edited.expectations[0]!.expected = "changed expectation";
    const revised = await t.engine.edit(t.id, 1, edited);
    expect(revised.approvals).toEqual([]);
    await expect(t.engine.prepare(t.id, revised.plan!.version))
      .rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  });

  it("uses no approver name for cleanup and still requires an explicit reviewed current preview", async () => {
    const t = await testEngine();
    await t.submit();
    await t.approve();
    await t.engine.prepare(t.id, 1);
    await t.engine.execute(t.id, 1);
    await t.engine.collect(t.id, 1);
    const { preview } = await t.engine.cleanupPreview(t.id);
    const input = { command: "cleanup-approve", version: 1, detailsHash: preview.detailsHash };
    await expect(command(t.engine, t.id, input, "browser", true))
      .rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    const response = await command(t.engine, t.id, { ...input, reviewed: true }, "browser", true);
    expect((response.run as Run).approvals.at(-1)).toMatchObject({
      scope: "cleanup", actor: "로컬 브라우저 사용자", detailsHash: preview.detailsHash,
    });
    const cleaned = await t.engine.cleanup(t.id, 1);
    expect(cleaned.cleanup.status).toBe("complete");
  });

  it("keeps manual Salesforce execution attribution separate from the local reviewer", async () => {
    const t = await testEngine();
    t.plan.scenarios = [scenario("scenario", { execution: "human-ui" })];
    await t.submit();
    await t.approve("prepare");
    await t.engine.prepare(t.id, 1);
    const response = await command(t.engine, t.id, {
      command: "human", version: 1, scenarioId: "scenario",
      actor: "actual.executor@example.invalid", path: "human-ui", notes: "사용자 실행 보고",
    }, "terminal", true);
    expect((response.run as Run).scenarios.scenario!.humanReport!.actor)
      .toBe("actual.executor@example.invalid");
    const reviewed = await command(t.engine, t.id, {
      command: "review", version: 1, verdict: "needs-review", notes: "실제 조회 확인 필요",
    }, "browser", true);
    expect((reviewed.run as Run).review!.actor).toBe("로컬 브라우저 사용자");
  });
});
