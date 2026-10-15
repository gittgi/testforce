import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PlanSchema } from "./model.js";
import { WorkbenchError, fail, redact } from "./errors.js";
import { hash } from "./hash.js";
export async function atomicWrite(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = file + "." + randomUUID() + ".tmp";
    const h = await fs.open(tmp, "wx", 0o600);
    try {
        await h.writeFile(JSON.stringify(data, null, 2) + "\n", "utf8");
        await h.sync();
    }
    finally {
        await h.close();
    }
    try {
        for (let i = 0;; i++) {
            try {
                await fs.rename(tmp, file);
                break;
            }
            catch (e) {
                if (i >= 5 ||
                    !["EPERM", "EBUSY", "EACCES"].includes(e.code ?? ""))
                    throw e;
                await new Promise((r) => setTimeout(r, 30 * (i + 1)));
            }
        }
    }
    finally {
        await fs.rm(tmp, { force: true });
    }
}
export async function safePath(root, relative, allowMissing = false) {
    if (path.isAbsolute(relative) ||
        relative.includes("\0") ||
        relative.split(/[\\/]/).includes(".."))
        fail("PATH_DENIED", "허용한 작업 폴더 밖의 경로입니다.");
    const base = await fs.realpath(root);
    const target = path.resolve(base, relative);
    if (target !== base && !target.startsWith(base + path.sep))
        fail("PATH_DENIED", "허용하지 않은 경로입니다.");
    let walk = base;
    for (const part of path
        .relative(base, target)
        .split(path.sep)
        .filter(Boolean)) {
        walk = path.join(walk, part);
        try {
            const st = await fs.lstat(walk);
            if (st.isSymbolicLink())
                fail("SYMLINK_DENIED", "심볼릭 링크 경로는 사용할 수 없습니다.");
        }
        catch (e) {
            if (e.code === "ENOENT" && allowMissing)
                break;
            throw e;
        }
    }
    return target;
}
export class Store {
    workspace;
    root;
    constructor(workspace) {
        this.workspace = workspace;
        this.root = path.join(path.resolve(workspace), ".workbench");
    }
    async init() {
        await fs.mkdir(this.workspace, { recursive: true });
        await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
        await safePath(this.workspace, ".workbench");
        await safePath(this.root, "runs", true);
        await fs.mkdir(path.join(this.root, "runs"), {
            recursive: true,
            mode: 0o700,
        });
    }
    dir(id) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(id))
            fail("RUN_ID", "올바르지 않은 실행 ID입니다.");
        return path.join(this.root, "runs", id);
    }
    async load(id) {
        const file = await safePath(this.root, path.join("runs", id, "state.json"));
        const st = await fs.stat(file);
        if (st.size > 32 * 1024 * 1024)
            fail("STATE_SIZE", "상태 파일 크기를 초과했습니다.");
        const r = JSON.parse(await fs.readFile(file, "utf8"));
        if (r.schemaVersion !== 1 ||
            r.run_id !== id ||
            !Array.isArray(r.operations) ||
            !Array.isArray(r.approvals))
            fail("STATE_SCHEMA", "실행 상태 형식이 올바르지 않습니다.");
        if (r.plan)
            PlanSchema.parse(r.plan);
        return r;
    }
    async save(run) {
        run.updatedAt = new Date().toISOString();
        await safePath(this.root, path.join("runs", run.run_id), true);
        await atomicWrite(path.join(this.dir(run.run_id), "state.json"), run);
        if (run.plan)
            await atomicWrite(path.join(this.dir(run.run_id), "plan.json"), run.plan);
        await atomicWrite(path.join(this.dir(run.run_id), "record-mapping.json"), run.bindings);
        await atomicWrite(path.join(this.dir(run.run_id), "operations.json"), run.operations);
        let browserUrl;
        try {
            browserUrl = JSON.parse(await fs.readFile(path.join(this.root, "access.json"), "utf8")).url;
        }
        catch { }
        await atomicWrite(path.join(this.root, "mod-status.json"), {
            run_id: run.run_id,
            status: run.status,
            approvalPending: !run.approvals.some((a) => a.planHash === run.plan?.hash),
            failureCount: Object.values(run.scenarios).filter((s) => ["PREPARE_FAILED", "ERROR", "UNKNOWN"].includes(s.status)).length,
            browserUrl,
        });
    }
    async list() {
        await this.init();
        const names = await fs.readdir(path.join(this.root, "runs"));
        const runs = [];
        for (const name of names) {
            try {
                runs.push(await this.load(name));
            }
            catch { }
        }
        return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    async lock(id, fn) {
        await this.init();
        await safePath(this.root, path.join("runs", id), true);
        await fs.mkdir(this.dir(id), { recursive: true, mode: 0o700 });
        await safePath(this.root, path.join("runs", id));
        const lock = await safePath(this.root, path.join("runs", id, "lock"), true);
        let handle;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                handle = await fs.open(lock, "wx", 0o600);
                await handle.writeFile(JSON.stringify({ pid: process.pid, nonce: randomUUID() }));
                break;
            }
            catch (e) {
                if (e.code !== "EEXIST")
                    throw e;
                let alive = true;
                try {
                    const v = JSON.parse(await fs.readFile(lock, "utf8"));
                    try {
                        process.kill(v.pid, 0);
                    }
                    catch (err) {
                        if (err.code === "ESRCH")
                            alive = false;
                    }
                }
                catch { }
                if (alive)
                    throw new WorkbenchError("RUN_BUSY", "이 실행을 다른 작업이 처리 중입니다.", "현재 작업이 끝난 뒤 다시 시도하세요.", true, 409);
                await fs.rm(lock, { force: true });
            }
        }
        if (!handle)
            fail("RUN_BUSY", "실행 잠금을 얻지 못했습니다.");
        try {
            return await fn();
        }
        finally {
            await handle.close();
            await fs.rm(lock, { force: true });
        }
    }
    async evidence(id, kind, data) {
        const name = `${kind}-${randomUUID()}.json`;
        const body = {
            at: new Date().toISOString(),
            mode: (await this.load(id)).mode,
            data: JSON.parse(redact(JSON.stringify(data))),
        };
        const target = await safePath(this.root, path.join("runs", id, "evidence", name), true);
        await safePath(this.root, path.join("runs", id, "evidence-index.jsonl"), true);
        await atomicWrite(target, body);
        await fs.appendFile(path.join(this.dir(id), "evidence-index.jsonl"), JSON.stringify({ file: name, hash: hash(body) }) + "\n", { mode: 0o600 });
        return `evidence/${name}`;
    }
}
