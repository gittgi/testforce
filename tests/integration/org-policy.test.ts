import { describe, it, expect } from "vitest";
import { testEngine } from "../helpers.js";
import { isNonProductionOrg, orgEnvironmentLabel } from "../../src/core/org-policy.js";
import type { OrgIdentity, SalesforceAdapter } from "../../src/core/model.js";
import { SfCliAdapter } from "../../src/salesforce/cli-adapter.js";

const orgId = "00D000000000001AAA";
const base: OrgIdentity = {mode: "live", alias: "not-proof", orgId,
  username: "fixture@example.invalid", isSandbox: false, name: "Fixture"};

describe("non-production policy", () => {
  it.each([
    [{isSandbox: true, organizationType: "Enterprise Edition"}, true],
    [{organizationType: "Developer Edition"}, true],
    [{organizationType: "Enterprise Edition", verifiedScratchOrgId: orgId}, true],
    [{organizationType: "Enterprise Edition"}, false],
    [{organizationType: "Unlimited Edition"}, false],
    [{organizationType: "Unknown"}, false],
    [{organizationType: "developer edition"}, false],
    [{alias: "sandbox", name: "Developer Edition"}, false],
    [{verifiedScratchOrgId: "00D000000000002AAA"}, false],
    [{}, false],
  ])("classifies authoritative identity %j => %s", (details, expected) => {
    expect(isNonProductionOrg({...base, ...details})).toBe(expected);
  });

  it("shows Developer Edition without calling it a Sandbox", () => {
    expect(orgEnvironmentLabel({...base, organizationType: "Developer Edition"})).toBe("Developer Edition");
    expect(orgEnvironmentLabel({...base, organizationType: "Enterprise Edition"})).toContain("쓰기 금지");
  });

  it.each(["Developer Edition", "Enterprise Edition"])("engine gates %s before writes", async organizationType => {
    const t = await testEngine({}, fake => new Proxy(fake, {get(target, prop) {
      if (prop === "mode") return "live";
      if (prop === "identity") return async () => ({...await fake.identity(), mode: "live", isSandbox: false, organizationType});
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    }}) as SalesforceAdapter);
    await t.submit();
    await expect(t.engine.execute(t.id, 1)).rejects.toThrow();
    expect((await t.getAdapter().inspectState()).writes).toBe(0);
    if (organizationType === "Enterprise Edition") {
      await expect(t.approve()).rejects.toMatchObject({code: "NON_PRODUCTION_REQUIRED"});
    } else {
      await t.approve();
      await t.engine.prepare(t.id, 1);
      await t.engine.execute(t.id, 1);
      expect((await t.getAdapter().inspectState()).writes).toBe(1);
    }
  });

  it("rejects changed environment evidence even if both types are allowed", async () => {
    let organizationType = "Developer Edition";
    const t = await testEngine({}, fake => new Proxy(fake, {get(target, prop) {
      if (prop === "mode") return "live";
      if (prop === "identity") return async () => ({...await fake.identity(), mode: "live", organizationType});
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    }}) as SalesforceAdapter);
    await t.submit(); await t.approve();
    organizationType = "Enterprise Edition";
    await expect(t.engine.prepare(t.id, 1)).rejects.toMatchObject({code: "ORG_CHANGED"});
    expect((await t.getAdapter().inspectState()).writes).toBe(0);
  });
});

function adapterFixture(edition: string, scratch?: "valid" | "expired" | "different" | "unavailable") {
  const calls: string[][] = [];
  const methods: string[] = [];
  const adapter = new SfCliAdapter("explicit-target", undefined, {
    runner: async args => {
      calls.push(args);
      if (args[0] === "data") {
        if (scratch === "unavailable") throw Error("Dev Hub not reachable");
        return {stdout: JSON.stringify({status: 0, result: {done: true, records: [{
          ScratchOrg: scratch === "different" ? "00D000000000002" : orgId.slice(0, 15),
          ExpirationDate: scratch === "expired" ? "2000-01-01" : "2099-01-01",
        }]}}), stderr: "", exitCode: 0};
      }
      return {stdout: JSON.stringify({status: 0, result: args[0] === "apex"
        ? {success: true, compiled: true}
        : {accessToken: "test-secret", instanceUrl: "https://fixture.salesforce.com", username: base.username,
          id: orgId, apiVersion: "66.0", ...(scratch ? {devHubId: "hub@example.invalid"} : {})}}), stderr: "", exitCode: 0};
    },
    fetcher: async (input, init) => {
      const url = new URL(String(input)); methods.push(init?.method ?? "GET");
      if (url.pathname === "/services/data/") return Response.json([{version: "66.0"}]);
      if (url.searchParams.get("q")?.includes("FROM Organization")) return Response.json({done: true,
        records: [{Id: orgId, Name: "Fixture", IsSandbox: false, OrganizationType: edition}]});
      if (url.pathname.endsWith("/describe")) return Response.json({name: "Account", createable: true,
        updateable: true, deletable: true, fields: [{name: "Name", type: "string", createable: true, updateable: true, nillable: false, length: 255}]});
      return Response.json([{id: "001000000000001AAA", success: true, errors: []}]);
    },
  });
  return {adapter, calls, methods};
}

describe("adapter-level gates cannot be bypassed", () => {
  it.each(["Developer Edition", "Enterprise Edition"])("checks DML and Apex separately for %s", async edition => {
    const t = adapterFixture(edition);
    const mutation = {object: "Account", verb: "insert" as const, allOrNone: true, records: [{key: "one", fields: {Name: "Fixture"}}]};
    if (edition === "Developer Edition") {
      expect((await t.adapter.mutate(mutation)).results[0]?.success).toBe(true);
      expect((await t.adapter.executeApex("Integer n = 1;", "test")).success).toBe(true);
    } else {
      await expect(t.adapter.mutate(mutation)).rejects.toMatchObject({code: "NON_PRODUCTION_REQUIRED"});
      await expect(t.adapter.executeApex("Integer n = 1;", "test")).rejects.toMatchObject({code: "NON_PRODUCTION_REQUIRED"});
      expect(t.methods.every(m => m === "GET")).toBe(true);
      expect(t.calls.some(a => a[0] === "apex")).toBe(false);
    }
  });
  it.each(["valid", "expired", "different", "unavailable"] as const)("verifies scratch evidence: %s", async scratch => {
    const t = adapterFixture("Enterprise Edition", scratch);
    const identity = await t.adapter.identity();
    expect(isNonProductionOrg(identity)).toBe(scratch === "valid");
    expect(t.calls.find(a => a[0] === "data")).toContain("hub@example.invalid");
    if (scratch !== "valid") {
      await expect(t.adapter.executeApex("Integer n = 1;", "test")).rejects.toMatchObject({code: "NON_PRODUCTION_REQUIRED"});
    }
  });
});
