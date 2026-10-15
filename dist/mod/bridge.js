/**
 * Short-lived, local Mod bridge. This is deliberately not a public approval
 * command, HTTP service, or Salesforce adapter. The trusted Mod keeps a view
 * capability in memory and sends it only from a direct user button callback.
 * Capabilities prevent stale screens/replays, not arbitrary code running as
 * the same OS user. All Salesforce gates remain in Engine.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { Store, atomicWrite, safePath } from "../core/store.js";
import { hash, contentHash, planHash } from "../core/hash.js";
import { fail, publicError, redact } from "../core/errors.js";
import { Engine } from "../execution/engine.js";
import { defaultAdapter } from "../cli/demo.js";
import { command } from "../server/commands.js";
const RunId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/);
export const ModViewRequest = z.strictObject({
    workspace: z.string().min(1).max(4096),
    runId: RunId.optional(),
});
export const ModActionRequest = z.strictObject({
    workspace: z.string().min(1).max(4096),
    runId: RunId,
    version: z.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    capability: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
    action: z.enum([
        "select", "approve", "run-tests", "prepare", "execute", "collect", "observe",
        "pause", "resume", "review", "reports", "keep", "cleanup-preview",
        "cleanup", "rerun",
    ]),
    reviewed: z.boolean().optional(),
    scenarioIds: z.array(z.string().min(1).max(100)).max(1000).optional(),
    verdict: z.enum(["accepted", "rejected", "needs-review"]).optional(),
    notes: z.string().max(10000).optional(),
});
const CapabilitySchema = z.strictObject({
    schemaVersion: z.literal(1),
    workspace: z.string(),
    runId: RunId,
    version: z.number().int(),
    planHash: z.string(),
    stateHash: z.string(),
    digest: z.string(),
    expiresAt: z.number(),
    cleanupDetailsHash: z.string().optional(),
});
const TTL_MS = 5 * 60 * 1000;
// Run never stores CLI authentication responses. Still redact known secrets
// defensively before this local presentation boundary; never mutate evidence.
function present(input) {
    const scrub = (value) => {
        if (typeof value === "string")
            return redact(value);
        if (Array.isArray(value))
            return value.map(scrub);
        if (value && typeof value === "object")
            return Object.fromEntries(Object.entries(value).map(([key, v]) => [
                key,
                /^(access_?token|refresh_?token|password|client_?secret|sessionId)$/i.test(key)
                    ? "[REDACTED]"
                    : scrub(v),
            ]));
        return value;
    };
    return scrub(input);
}
export class ModBridge {
    engine;
    clock;
    constructor(engine, clock = () => Date.now()) {
        this.engine = engine;
        this.clock = clock;
    }
    async capabilityDirectory() {
        const root = await safePath(this.engine.store.root, "mod-actions", true);
        await fs.mkdir(root, { recursive: true, mode: 0o700 });
        return safePath(this.engine.store.root, "mod-actions");
    }
    async issue(run, cleanupPreview) {
        if (!run.plan)
            return undefined;
        const root = await this.capabilityDirectory();
        // Bound stale capabilities without touching any run data or approvals.
        for (const name of (await fs.readdir(root)).slice(0, 1000)) {
            if (!/^[a-f0-9]{64}\.json$/.test(name))
                continue;
            const file = await safePath(root, name);
            const stat = await fs.stat(file);
            if (stat.mtimeMs < this.clock() - TTL_MS)
                await fs.rm(file, { force: true });
        }
        const capability = randomBytes(32).toString("base64url");
        const digest = contentHash(capability);
        await atomicWrite(await safePath(root, `${digest}.json`, true), {
            schemaVersion: 1,
            workspace: await fs.realpath(this.engine.store.workspace),
            runId: run.run_id,
            version: run.plan.version,
            planHash: run.plan.hash,
            stateHash: hash(run),
            digest,
            expiresAt: this.clock() + TTL_MS,
            cleanupDetailsHash: cleanupPreview?.detailsHash,
        });
        return capability;
    }
    async view(runId, extra = {}) {
        const workspace = await fs.realpath(this.engine.store.workspace);
        try {
            await safePath(workspace, ".workbench");
            await fs.stat(this.engine.store.root);
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
            return { ok: true, view: { workspace, initialized: false, run: null, runs: [] } };
        }
        const runs = await this.engine.store.list();
        const run = runId ? await this.engine.store.load(runId) : runs[0] ?? null;
        const capability = run ? await this.issue(run, extra.cleanupPreview) : undefined;
        return {
            ok: true,
            view: present({
                workspace,
                initialized: true,
                run,
                runs: runs.map((r) => ({
                    run_id: r.run_id, status: r.status, mode: r.mode,
                    createdAt: r.createdAt, planVersion: r.plan?.version,
                })),
                ...extra,
            }),
            capability,
        };
    }
    async consume(input) {
        const root = await this.capabilityDirectory();
        const digest = contentHash(input.capability);
        const file = await safePath(root, `${digest}.json`, true);
        let cap;
        try {
            cap = CapabilitySchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
        }
        catch {
            fail("MOD_ACTION_EXPIRED", "화면의 선택이 만료되었거나 이미 처리되었습니다. 새로고침 후 확인하세요.");
        }
        if (cap.digest !== digest || cap.expiresAt <= this.clock() ||
            cap.workspace !== await fs.realpath(this.engine.store.workspace) ||
            cap.runId !== input.runId || cap.version !== input.version ||
            cap.planHash !== input.hash)
            fail("MOD_ACTION_EXPIRED", "다른 실행 또는 오래된 화면의 선택입니다. 새로고침 후 확인하세요.");
        const run = await this.engine.store.load(input.runId);
        if (!run.plan || run.plan.version !== input.version || run.plan.hash !== input.hash)
            fail("VERSION_CONFLICT", "계획이 바뀌었습니다. 현재 계획을 다시 검토하세요.");
        if (run.plan.hash !== planHash(run.plan))
            fail("PLAN_TAMPERED", "계획 내용과 해시가 다릅니다. 계획을 다시 제출하세요.");
        if (hash(run) !== cap.stateHash)
            fail("MOD_VIEW_CHANGED", "실행 상태가 바뀌었습니다. 새로고침 후 현재 상태에서 선택하세요.");
        if (["approve", "cleanup"].includes(input.action) && input.reviewed !== true)
            fail("REVIEW_REQUIRED", "내용을 검토한 뒤 ‘확인했습니다’를 선택하세요.");
        if (input.action === "cleanup" && !cap.cleanupDetailsHash)
            fail("CLEANUP_PREVIEW_REQUIRED", "정리 대상을 먼저 열고 확인하세요.");
        // Atomic rename claims this exact view token once across processes. A
        // timeout/failure must lead to refresh/reconciliation, never automatic retry.
        const claimed = await safePath(root, `${digest}.${randomUUID()}.used`, true);
        try {
            await fs.rename(file, claimed);
        }
        catch {
            fail("MOD_ACTION_EXPIRED", "이미 처리 중이거나 사용한 선택입니다. 상태를 새로고침하세요.");
        }
        await fs.rm(claimed, { force: true });
        return { run, cap };
    }
    /** One explicit click starts the approved workflow, never a retry policy. */
    async runTests(run, version) {
        const selected = run.plan.scenarios.filter((scenario) => scenario.selected);
        const tools = selected.filter((scenario) => scenario.execution === "tool");
        if (!tools.length)
            fail("NO_TOOL_SCENARIOS", "선택한 도구 실행 시나리오가 없습니다. 사람 실행은 준비 후 안내에 따라 진행하세요.");
        if (!run.approvals.some((approval) => approval.planVersion === version && approval.planHash === run.plan.hash && approval.scope === "execute"))
            fail("APPROVAL_REQUIRED", "현재 계획의 준비와 도구 실행을 먼저 승인하세요.");
        if (run.operations.some((operation) => ["SENDING", "UNKNOWN"].includes(operation.state)))
            fail("UNKNOWN_WRITE", "결과 불명 작업을 먼저 확인하세요. 테스트 시작 버튼은 쓰기를 다시 보내지 않습니다.");
        if (run.paused)
            fail("PAUSED", "중단 상태입니다. 상세 도구에서 상태를 확인하고 재개하세요.");
        if (selected.some((scenario) => ["PREPARE_FAILED", "ERROR", "UNKNOWN", "BLOCKED"].includes(run.scenarios[scenario.id].status)))
            fail("RUN_REVIEW_REQUIRED", "실패하거나 막힌 시나리오를 먼저 확인하세요. 계획 수정 또는 상세 도구의 재개 절차가 필요합니다.");
        if (selected.some((scenario) => ["PREPARING", "RUNNING"].includes(run.scenarios[scenario.id].status)))
            fail("RUN_IN_PROGRESS", "진행 중이거나 중단된 작업이 있습니다. 현재 기록을 확인한 후 상세 도구에서 재개하세요.");
        if (selected.some((scenario) => run.scenarios[scenario.id].status === "WAITING_ASYNC"))
            fail("RUN_OBSERVATION_REQUIRED", "이미 시작된 비동기 작업의 완료를 확인하세요. 테스트를 다시 시작하지 않습니다.");
        if (tools.every((scenario) => run.scenarios[scenario.id].status === "EXECUTED"))
            fail("ALREADY_EXECUTED", "선택한 도구 테스트는 이미 실행했습니다. 결과 비교 또는 새 실행을 선택하세요.");
        // prepare only creates approved fixtures. In mixed plans, human action
        // records remain untouched; execute itself filters to selected tool work.
        // Calling each engine phase retains its version, identity, source, approval,
        // lock and operation journal checks at every write boundary.
        let current = await this.engine.prepare(run.run_id, version);
        if (current.paused)
            return current;
        if (!current.operations.some((operation) => ["SENDING", "UNKNOWN"].includes(operation.state)))
            current = await this.engine.execute(run.run_id, version);
        if (current.paused)
            return current;
        // One read-only evidence pass also records independent failures. Pending
        // human/async work remains NOT_EXECUTED/UNVERIFIABLE; never auto-observe,
        // retry a write, or infer completion from successful job registration.
        return this.engine.collect(run.run_id, version);
    }
    async action(raw) {
        const input = ModActionRequest.parse(raw);
        const workspace = await fs.realpath(input.workspace);
        if (workspace !== await fs.realpath(this.engine.store.workspace))
            fail("WORKSPACE_MISMATCH", "표시한 작업 폴더와 다릅니다.");
        const { run, cap } = await this.consume(input);
        let result;
        const base = { version: input.version, hash: input.hash };
        if (input.action === "run-tests") {
            result = { run: await this.runTests(run, input.version) };
        }
        else if (input.action === "select") {
            if (!input.scenarioIds || new Set(input.scenarioIds).size !== input.scenarioIds.length)
                fail("SCENARIO_SELECTION", "중복 없이 선택할 시나리오를 지정하세요.");
            const ids = new Set(input.scenarioIds);
            if (input.scenarioIds.some((id) => !run.plan.scenarios.some((s) => s.id === id)))
                fail("SCENARIO_SELECTION", "현재 계획에 없는 시나리오입니다.");
            const plan = structuredClone(run.plan);
            for (const scenario of plan.scenarios)
                scenario.selected = ids.has(scenario.id);
            result = await command(this.engine, input.runId, { ...base, command: "edit", plan }, "mod");
        }
        else if (input.action === "cleanup") {
            await command(this.engine, input.runId, {
                ...base, command: "cleanup-approve", reviewed: true,
                detailsHash: cap.cleanupDetailsHash,
            }, "mod", true);
            result = await command(this.engine, input.runId, { ...base, command: "cleanup" }, "mod");
        }
        else {
            if (input.action === "review" && !input.verdict)
                fail("VERDICT", "최종 판정을 선택하세요.");
            result = await command(this.engine, input.runId, {
                ...base,
                command: input.action,
                ...(input.action === "approve" ? { scope: "execute", reviewed: input.reviewed } : {}),
                ...(input.action === "review" ? { verdict: input.verdict, notes: input.notes ?? "" } : {}),
            }, "mod", ["approve", "review"].includes(input.action));
        }
        const nextRun = result.run;
        return this.view(nextRun?.run_id ?? input.runId, {
            ...(input.action === "cleanup-preview" ? { cleanupPreview: result.preview } : {}),
            ...(input.action === "reports" ? { files: result.files } : {}),
        });
    }
}
export async function modRequest(operation, payload, makeEngine = (workspace) => {
    const store = new Store(workspace);
    return new Engine(store, (run) => defaultAdapter(run, store.root));
}) {
    try {
        if (operation !== "view" && operation !== "action")
            fail("MOD_COMMAND", "Mod는 화면 조회와 정해진 사용자 선택만 지원합니다.");
        const input = (operation === "view" ? ModViewRequest : ModActionRequest).parse(payload);
        const engine = makeEngine(path.resolve(input.workspace));
        const bridge = new ModBridge(engine);
        return operation === "view"
            ? await bridge.view(input.runId)
            : await bridge.action(input);
    }
    catch (error) {
        return { ok: false, error: present(publicError(error)) };
    }
}
