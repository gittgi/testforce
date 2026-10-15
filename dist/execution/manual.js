import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Key } from "../core/model.js";
import { generateApexScript, idPattern } from "../salesforce/index.js";
import { resolveFields } from "../core/plan.js";
import { fail } from "../core/errors.js";
import { canonical, contentHash } from "../core/hash.js";
import { atomicWrite, safePath } from "../core/store.js";
const ManifestSchema = z
    .object({
    schemaVersion: z.literal(1),
    runId: z.string(),
    planVersion: z.number().int(),
    planHash: z.string(),
    scenarioId: Key,
    generatedAt: z.string().datetime(),
    orgId: z.string(),
    username: z.string(),
    files: z.array(z
        .object({
        actionId: Key,
        kind: z.enum(["service", "batch", "anonymous"]),
        name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\.apex$/),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        correlationId: z.string().regex(/^manual-[a-f0-9-]+$/),
    })
        .strict()),
})
    .strict();
const LogsSchema = z.record(Key, z.string().regex(idPattern));
async function manualPreflight(engine, run, adapter, action) {
    if (!action.impact.bounded)
        fail("UNBOUNDED_ACTION", "사람 실행 스크립트의 영향 범위를 먼저 확정하세요.");
    if (action.impact.externalEffects.length && !action.impact.acknowledgement)
        fail("EXTERNAL_EFFECT", "이메일·Callout 등 외부 영향을 계획에서 확인하세요.");
    let existing = action.impact.existingRecordIds.length > 0 ||
        action.recordKeys.some((key) => run.bindings[key]?.ownership === "existing");
    if (action.kind === "batch") {
        if (!action.scopeQuery)
            fail("BATCH_SCOPE", "Batch 대상 조회 조건이 필요합니다.");
        const rows = await adapter.query(action.scopeQuery, engine.bindings(run));
        if (rows.length >= action.scopeQuery.limit)
            fail("BATCH_SCOPE_TRUNCATED", "Batch 대상 조회 제한에 도달했습니다. 범위를 확인한 뒤 재승인하세요.");
        const ids = rows.map((row) => String(row.Id)).sort(), approved = action.approvedScopeIds
            .map((id) => id.startsWith("ref:")
            ? (engine.bindings(run)[id.slice(4)] ?? id)
            : id)
            .sort();
        if (canonical(ids) !== canonical(approved))
            fail("BATCH_SCOPE_CHANGED", "사람 실행 Batch의 현재 대상과 승인 범위가 다릅니다.");
        for (const id of ids)
            if (!Object.values(run.bindings).some((b) => b.id === id && b.ownership === "created" && b.runId === run.run_id)) {
                if (!action.impact.existingRecordIds.includes(id))
                    fail("BATCH_EXISTING_SCOPE", "기존 Batch 대상 ID와 영향에 대한 확대 승인이 필요합니다.");
                existing = true;
            }
    }
    await engine.gate(run, adapter, "prepare", existing);
}
export async function manualInstructions(engine, id, version, scenarioId) {
    return engine.change(id, async (run, adapter) => {
        engine.expectVersion(run, version);
        await engine.gate(run, adapter, "prepare");
        await engine.sourceCheck(run, adapter);
        const scenario = run.plan.scenarios.find((s) => s.id === scenarioId && s.execution !== "tool");
        if (!scenario)
            fail("HUMAN_SCENARIO", "사람 실행 시나리오를 선택하세요.");
        if (run.scenarios[scenario.id].status !== "WAITING_HUMAN")
            fail("HUMAN_STATE", "준비와 Baseline 확인 후 안내를 생성하세요.");
        for (const action of scenario.actions)
            await manualPreflight(engine, run, adapter, action);
        const bundleId = "bundle-" + randomUUID(), relative = path.join("import", bundleId), dir = await safePath(engine.store.dir(id), relative, true);
        await fs.mkdir(dir, { recursive: true });
        const manifest = {
            schemaVersion: 1,
            runId: id,
            planVersion: version,
            planHash: run.plan.hash,
            scenarioId,
            generatedAt: new Date().toISOString(),
            orgId: run.plan.org.orgId,
            username: run.plan.org.username,
            files: [],
        };
        const lines = [
            `# ${scenario.title} 사람 실행 안내`,
            "",
            `모드: ${run.mode === "fake" ? "오프라인 시뮬레이션 (실제 Org에 사용 금지)" : "실제 Sandbox"}`,
            `Org: ${run.plan.org.name} / ${run.plan.org.orgId}`,
            `승인 사용자: ${run.plan.org.username}`,
            `계획: v${version} ${run.plan.hash}`,
            "",
            "먼저 준비 결과와 실행 직전 Baseline을 확인하세요. 이 안내 생성 자체는 실행 완료가 아닙니다. 실행 후 실제 사용자·시각·경로, Salesforce ID와 관찰 내용을 완료 보고에 입력하세요.",
        ];
        for (const action of scenario.actions) {
            lines.push("", `## ${action.id} / ${action.kind}`);
            if (action.kind === "dml") {
                lines.push(`작업: ${action.verb}. 오브젝트: ${action.object}. 요청 경계: ${action.transaction}, allOrNone=${action.allOrNone}.`);
                for (const key of action.recordKeys) {
                    const r = run.plan.records.find((r) => r.key === key);
                    lines.push(`- ${key}: 현재 ID ${run.bindings[key]?.id ?? "신규"}, 입력값 ${JSON.stringify(resolveFields(action.fieldOverrides[key] ?? r.fields, engine.bindings(run)))}`);
                }
                lines.push("화면의 필수 항목·페이지 입력 제약도 확인하고 저장하세요. Import 경로라면 별도의 Data Loader 묶음을 생성하세요.");
            }
            else {
                const correlationId = "manual-" + randomUUID(), script = action.kind === "anonymous"
                    ? action.script
                    : generateApexScript(action, correlationId, engine.bindings(run)), name = `${action.id}.apex`;
                await fs.writeFile(await safePath(dir, name, true), script, {
                    encoding: "utf8",
                    mode: 0o600,
                });
                manifest.files.push({
                    actionId: action.id,
                    kind: action.kind,
                    name,
                    sha256: contentHash(script),
                    correlationId,
                });
                lines.push(`승인한 스크립트: ${name}. 상관 ID ${correlationId}. 실제 대상 Org를 명시하여 sf apex run --target-org <승인 사용자> --file <스크립트 경로> --json 을 실행하세요.`, "컴파일·실행 오류와 출력 파일을 보관하세요. 단순 실행 완료 보고만으로 반환값 또는 Batch 완료를 확인하지 않습니다.");
                if (action.kind === "service" || action.kind === "batch")
                    lines.push(`기존 ApexLog ID가 있으면 manual-evidence --bundle ${bundleId} --file <로그 연결 JSON>으로 읽을 수 있습니다. JSON: {"logs":{"${action.id}":"<ApexLog ID>"}}. TraceFlag를 새로 만들거나 수정하지 않습니다. 로그가 없거나 잘리면 반환값·Job은 확인 불가입니다.`);
            }
        }
        lines.push("", "## 관찰할 기대 결과", ...run
            .plan.expectations.filter((e) => e.scenarioId === scenario.id)
            .map((e) => `- ${e.label}: ${e.operator} ${JSON.stringify(e.expected)}`));
        await fs.writeFile(await safePath(dir, "README.md", true), lines.join("\n"), "utf8");
        await atomicWrite(await safePath(dir, "manual-manifest.json", true), manifest);
        const evidenceRef = await engine.store.evidence(id, "manual-instructions", manifest);
        engine.event(run, "manual-instructions", `사람 실행 자료 ${bundleId} 생성. 계획 v${version}. 근거 ${evidenceRef}`);
        return {
            run,
            bundleId,
            bundle: {
                files: [
                    ...manifest.files,
                    { name: "README.md" },
                    { name: "manual-manifest.json" },
                ],
            },
        };
    });
}
/** Observes previous manual Service/Batch calls. Never reports completion or executes Apex/DML. */
export async function manualEvidence(engine, id, version, bundleId, logs) {
    return engine.change(id, async (run, adapter) => {
        engine.expectVersion(run, version);
        await engine.identityCheck(run, adapter);
        if (!/^bundle-[a-f0-9-]+$/.test(bundleId))
            fail("BUNDLE_ID", "사람 실행 자료 묶음 ID를 확인하세요.");
        const parsedLogs = LogsSchema.safeParse(logs);
        if (!parsedLogs.success || !Object.keys(parsedLogs.data).length)
            fail("MANUAL_LOGS", "동작 ID와 기존 ApexLog ID의 연결이 필요합니다.");
        if (new Set(Object.values(parsedLogs.data)).size !==
            Object.values(parsedLogs.data).length)
            fail("MANUAL_LOG_DUPLICATE", "서로 다른 승인 동작에 같은 로그를 중복 연결할 수 없습니다.");
        const manifestFile = await safePath(engine.store.dir(id), path.join("import", bundleId, "manual-manifest.json"));
        if ((await fs.stat(manifestFile)).size > 1024 * 1024)
            fail("MANUAL_MANIFEST", "사람 실행 manifest가 너무 큽니다.");
        const parsed = ManifestSchema.safeParse(JSON.parse(await fs.readFile(manifestFile, "utf8")));
        if (!parsed.success)
            fail("MANUAL_MANIFEST", "사람 실행 manifest 형식이 올바르지 않습니다.");
        const manifest = parsed.data, plan = run.plan;
        if (manifest.runId !== id ||
            manifest.planVersion !== version ||
            manifest.planHash !== plan.hash ||
            manifest.orgId !== plan.org.orgId ||
            manifest.username !== plan.org.username)
            fail("MANUAL_MANIFEST_SCOPE", "이 실행의 현재 승인 계획과 연결된 자료가 아닙니다.");
        if (!run.approvals.some((a) => ["prepare", "execute"].includes(a.scope) &&
            a.planVersion === version &&
            a.planHash === plan.hash &&
            a.orgId === plan.org.orgId &&
            a.username === plan.org.username))
            fail("APPROVAL_REQUIRED", "사람 실행 자료의 원래 계획 승인을 확인하지 못했습니다.");
        const scenario = plan.scenarios.find((s) => s.id === manifest.scenarioId && s.execution !== "tool"), state = run.scenarios[manifest.scenarioId];
        if (!scenario || !state)
            fail("HUMAN_SCENARIO", "사람 실행 시나리오가 아닙니다.");
        if (!adapter.recoverApex)
            fail("MANUAL_LOG_UNAVAILABLE", "이 어댑터에서 기존 ApexLog 증거를 읽을 수 없습니다.");
        if (new Set(manifest.files.map((f) => f.actionId)).size !==
            manifest.files.length)
            fail("MANUAL_MANIFEST", "동작별 스크립트가 중복되었습니다.");
        for (const [actionId, logId] of Object.entries(parsedLogs.data)) {
            const action = scenario.actions.find((a) => a.id === actionId), file = manifest.files.find((f) => f.actionId === actionId);
            if (!action ||
                !file ||
                !["service", "batch"].includes(action.kind) ||
                file.kind !== action.kind ||
                file.name !== `${action.id}.apex`)
                fail("MANUAL_ACTION", "생성된 Service·Batch 동작의 기존 로그만 연결할 수 있습니다.");
            const scriptFile = await safePath(engine.store.dir(id), path.join("import", bundleId, file.name));
            if ((await fs.stat(scriptFile)).size > 2 * 1024 * 1024)
                fail("MANUAL_SCRIPT", "사람 실행 스크립트가 너무 큽니다.");
            const script = await fs.readFile(scriptFile, "utf8");
            if (contentHash(script) !== file.sha256 ||
                script !==
                    generateApexScript(action, file.correlationId, engine.bindings(run)))
                fail("MANUAL_SCRIPT_CHANGED", "승인한 스크립트·바인딩 또는 생성 파일 내용이 바뀌었습니다.");
            const existing = state.actionResults[actionId];
            if (existing) {
                if (existing.manualEvidence?.bundleId === bundleId &&
                    existing.manualEvidence.logId === logId)
                    continue;
                fail("EVIDENCE_EXISTS", "이미 수집한 동작 증거를 다른 로그로 덮어쓸 수 없습니다. 새 실행을 만드세요.");
            }
            const recovered = await adapter.recoverApex(file.correlationId, logId), metadata = recovered.recoveryLog;
            const at = Date.parse(metadata?.startedAt ?? ""), earliest = Math.max(Date.parse(run.createdAt), Date.parse(manifest.generatedAt));
            if (!metadata ||
                metadata.id !== logId ||
                metadata.username !== plan.org.username ||
                !Number.isFinite(at) ||
                at < earliest ||
                at > Date.now() + 2000)
                fail("MANUAL_LOG_SCOPE", "기존 로그의 사용자·실행 시각이 이 실행 자료와 일치하지 않습니다.");
            if (!recovered.success ||
                !recovered.compiled ||
                recovered.unknown ||
                (action.kind === "batch" && !recovered.jobId) ||
                (action.kind === "service" &&
                    action.returns &&
                    !recovered.returnCaptured))
                fail("MANUAL_LOG_INCOMPLETE", "완전한 상관 로그와 필요한 반환값·Job ID를 확보하지 못했습니다. 확인 불가 상태를 유지합니다.");
            let job;
            if (recovered.jobId) {
                job = {
                    id: recovered.jobId,
                    status: "Submitted",
                    errors: 0,
                    processed: 0,
                    total: 0,
                    done: false,
                };
                try {
                    const observed = await adapter.job(recovered.jobId);
                    if (observed.id !== recovered.jobId)
                        fail("MANUAL_JOB_ID", "조회한 Job ID가 상관 로그와 다릅니다.");
                    job = observed;
                }
                catch (error) {
                    if (error.code === "MANUAL_JOB_ID")
                        throw error;
                }
            }
            const evidenceRef = await engine.store.evidence(id, "manual-apex", {
                bundleId,
                manifest,
                actionId,
                logId,
                recovered,
                job: job ?? null,
            });
            const { log: _log, ...result } = recovered;
            state.actionResults[actionId] = {
                ...result,
                manualEvidence: {
                    bundleId,
                    logId,
                    evidenceRef,
                    correlationId: file.correlationId,
                },
            };
            if (job)
                state.jobs = state.jobs.filter((j) => j.id !== job.id).concat(job);
            // A read is not the developer's completion report. Preserve WAITING_HUMAN.
            if (state.humanReport && state.jobs.some((j) => !j.done))
                state.status = "WAITING_ASYNC";
            engine.event(run, "manual-evidence", `기존 ApexLog ${logId}에서 ${actionId} 증거를 읽었습니다. 사람 완료 보고와 별개입니다. 근거 ${evidenceRef}`);
            await engine.store.save(run);
        }
        return { run };
    });
}
