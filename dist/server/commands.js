import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWrite, safePath } from "../core/store.js";
import { fail } from "../core/errors.js";
import { exportPlanWorkbook, importPlanWorkbook, resolveWorkbookImport, } from "../workbook/index.js";
import { createImportBundle, mapImportResults, } from "../imports/index.js";
import { generateReports } from "../reports/index.js";
import { restorePreview, restoreApprove, restore, cancelPreview, cancelApprove, cancelJob, confirmOwnership, } from "../cleanup/extended.js";
import { manualInstructions, manualEvidence } from "../execution/manual.js";
import { verifyImportMapping } from "../imports/index.js";
export async function command(engine, id, input, channel, human = false) {
    const str = (key) => {
        if (typeof input[key] !== "string")
            fail("INPUT", `${key} 입력이 필요합니다.`);
        return input[key];
    };
    const version = Number(input.version), name = str("command");
    // This describes the local human action; it is not a verified Salesforce
    // identity. Request bodies cannot assign an approver or approval timestamp.
    const actor = channel === "browser"
        ? "로컬 브라우저 사용자"
        : channel === "mod"
            ? "로컬 Mod 사용자"
            : "로컬 터미널 사용자";
    if ([
        "approve",
        "cleanup-approve",
        "review",
        "human",
        "reconcile",
        "restore-approve",
        "cancel-approve",
        "confirm-ownership",
    ].includes(name) &&
        !human)
        fail("USER_ACTION_REQUIRED", "이 작업은 실제 Mod·브라우저 선택 또는 터미널 대화로 수행하세요.");
    if ([
        "approve",
        "cleanup-approve",
        "restore-approve",
        "cancel-approve",
        "confirm-ownership",
    ].includes(name) &&
        input.reviewed !== true)
        fail("REVIEW_REQUIRED", "내용을 검토한 뒤 ‘확인했습니다’를 선택하세요.");
    let run;
    switch (name) {
        case "analyze":
            run = await engine.analyze(id, str("selection"), input.selectedPaths, input.objects);
            break;
        case "submit":
            run = await engine.submit(id, input.draft);
            break;
        case "edit":
            run = await engine.edit(id, version, input.plan);
            break;
        case "approve": {
            const scope = str("scope");
            if (!["prepare", "execute", "existing"].includes(scope))
                fail("SCOPE", "지원하지 않는 승인 범위입니다.");
            run = await engine.approve(id, version, str("hash"), scope, actor, channel);
            break;
        }
        case "manual-instructions":
            return manualInstructions(engine, id, version, str("scenarioId"));
        case "manual-evidence":
            return manualEvidence(engine, id, version, str("bundleId"), input.logs);
        case "restore-preview":
            return restorePreview(engine, id);
        case "restore-approve":
            run = await restoreApprove(engine, id, version, str("detailsHash"), actor, channel);
            break;
        case "restore":
            run = await restore(engine, id, version);
            break;
        case "cancel-preview":
            return cancelPreview(engine, id, str("jobId"));
        case "cancel-approve":
            run = await cancelApprove(engine, id, version, str("jobId"), str("detailsHash"), actor, channel);
            break;
        case "cancel-job":
            run = await cancelJob(engine, id, version, str("jobId"));
            break;
        case "confirm-ownership":
            run = await confirmOwnership(engine, id, version, input.keys, actor, channel);
            break;
        case "prepare":
            run = await engine.prepare(id, version);
            break;
        case "execute":
            run = await engine.execute(id, version);
            break;
        case "human":
            run = await engine.human(id, version, {
                scenarioId: str("scenarioId"),
                // Manual execution attribution is separate from local approval. Keep
                // the actual Salesforce executor supplied in the user's report.
                actor: str("actor"),
                path: str("path"),
                notes: str("notes"),
                executedAt: input.executedAt,
                bindings: input.bindings,
                observations: input.observations,
            });
            break;
        case "collect":
            run = await engine.collect(id, version);
            break;
        case "observe":
            run = await engine.observe(id, version);
            break;
        case "review": {
            const verdict = str("verdict");
            if (!["accepted", "rejected", "needs-review"].includes(verdict))
                fail("VERDICT", "판정을 확인하세요.");
            run = await engine.review(id, version, verdict, str("notes"), actor);
            break;
        }
        case "pause":
            run = await engine.pause(id);
            break;
        case "resume":
            run = await engine.resume(id);
            break;
        case "rerun":
            run = await engine.rerun(id);
            break;
        case "keep":
            run = await engine.keep(id);
            break;
        case "cleanup-preview":
            return engine.cleanupPreview(id);
        case "cleanup-approve":
            run = await engine.approveCleanup(id, version, str("detailsHash"), actor, channel);
            break;
        case "cleanup":
            run = await engine.cleanup(id, version);
            break;
        case "reconcile":
            run = await engine.reconcile(id, version, str("opId"), input.bindings ?? [], str("notes"), channel, input.logId);
            break;
        case "ai-note":
            run = await engine.aiNote(id, str("text"), input.evidenceRefs ?? []);
            break;
        case "reports":
            run = await engine.store.load(id);
            for (const name of [
                "test-plan.xlsx",
                "test-results.xlsx",
                "test-report.md",
                "plan.json",
                "evidence/report-details.json",
            ])
                await safePath(engine.store.dir(id), name, true);
            await generateReports(run, engine.store.dir(id));
            return {
                run,
                files: ["test-plan.xlsx", "test-results.xlsx", "test-report.md"],
            };
        case "excel-export":
            run = await engine.store.load(id);
            if (!run.plan)
                fail("NO_PLAN", "계획이 없습니다.");
            await exportPlanWorkbook(run.plan, await safePath(engine.store.dir(id), "test-plan.xlsx", true));
            return { run, files: ["test-plan.xlsx"] };
        case "excel-import": {
            run = await engine.store.load(id);
            engine.expectVersion(run, version);
            const bytes = Buffer.from(str("base64"), "base64");
            if (bytes.length > 10 * 1024 * 1024)
                fail("FILE_SIZE", "Excel 파일 크기가 너무 큽니다.");
            const file = path.join(engine.store.dir(id), "incoming-" + randomUUID() + ".xlsx");
            await fs.writeFile(file, bytes, { mode: 0o600 });
            try {
                const preview = await importPlanWorkbook(run.plan, file);
                await atomicWrite(path.join(engine.store.dir(id), "excel-preview.json"), { version, preview });
                return { run, preview };
            }
            finally {
                await fs.rm(file, { force: true });
            }
        }
        case "excel-apply": {
            run = await engine.store.load(id);
            engine.expectVersion(run, version);
            const saved = JSON.parse(await fs.readFile(await safePath(engine.store.dir(id), "excel-preview.json"), "utf8"));
            if (saved.version !== version)
                fail("STALE_EXCEL", "이전 계획의 Excel 변경 제안입니다.");
            const plan = resolveWorkbookImport(run.plan, saved.preview, input.resolutions ?? {});
            run = await engine.edit(id, version, plan);
            break;
        }
        case "import-generate":
            return engine.change(id, async (run, adapter) => {
                engine.expectVersion(run, version);
                await engine.gate(run, adapter, input.phase === "fixture" ? "prepare" : "execute");
                await engine.sourceCheck(run, adapter);
                const bundleId = "bundle-" + randomUUID();
                const phase = input.phase === "fixture" ? "fixture" : "action";
                const bundle = await createImportBundle(run.plan, run.bindings, phase, path.join(engine.store.dir(id), "import", bundleId), input.scenarioId);
                await atomicWrite(path.join(engine.store.dir(id), "import", bundleId, "bundle.json"), bundle);
                return { run, bundleId, bundle };
            });
        case "import-results": {
            run = await engine.store.load(id);
            engine.expectVersion(run, version);
            const bundleId = str("bundleId");
            if (!/^bundle-[a-f0-9-]+$/.test(bundleId))
                fail("BUNDLE_ID", "Import 묶음 ID가 올바르지 않습니다.");
            const bundle = JSON.parse(await fs.readFile(await safePath(engine.store.dir(id), `import/${bundleId}/bundle.json`), "utf8"));
            const csvFile = path.join(engine.store.dir(id), "result-" + randomUUID() + ".csv");
            await fs.writeFile(csvFile, str("csv"), { mode: 0o600 });
            let mapped;
            try {
                mapped = await mapImportResults(run.plan, bundle, csvFile, input.mappings);
            }
            finally {
                await fs.rm(csvFile, { force: true });
            }
            await engine.change(id, async (r, a) => {
                engine.expectVersion(r, version);
                await engine.identityCheck(r, a);
                for (const m of mapped.mappings) {
                    const d = await a.describe(m.object);
                    if (m.operation === "delete") {
                        const existing = r.bindings[m.key];
                        if (!existing || existing.id !== m.id)
                            fail("IMPORT_DELETE_ID", "승인한 삭제 ID와 다릅니다.");
                        const rows = await a.read(m.object, [m.id], ["Id"]);
                        if (rows.length)
                            fail("IMPORT_DELETE_PENDING", "삭제 대상이 아직 조회됩니다.");
                        engine.event(r, "manual-delete", "사용자가 삭제 성공 CSV를 제출했습니다. 별도 삭제 증거 확인 전 소유 상태는 유지합니다.");
                        continue;
                    }
                    const rows = await a.read(m.object, [m.id], ["Id", ...Object.keys(m.fields)]);
                    const verified = verifyImportMapping(m, rows[0], d);
                    if (!verified.matches)
                        fail("IMPORT_VERIFY", "실제 데이터가 Import 입력과 다릅니다.", verified);
                    await engine.link(r, a, m.key, m.id, `수동 Import ${m.proof}, ${bundleId}: 실제 조회 연결`);
                }
                engine.event(r, "import-results", `${mapped.mappings.length}개 ID 조회 연결, 미해결 ${mapped.unresolved.length}개`);
                await engine.store.evidence(id, "import-results", mapped);
            });
            run = await engine.store.load(id);
            return { run, mapping: mapped };
        }
        default:
            fail("COMMAND", "지원하지 않는 명령입니다.");
    }
    if (run &&
        ["collect", "review", "cleanup", "restore", "keep"].includes(name)) {
        for (const file of [
            "test-plan.xlsx",
            "test-results.xlsx",
            "test-report.md",
            "evidence/report-details.json",
        ])
            await safePath(engine.store.dir(id), file, true);
        await generateReports(run, engine.store.dir(id));
    }
    return { run };
}
