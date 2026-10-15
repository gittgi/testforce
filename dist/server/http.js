import Fastify from "fastify";
import staticFiles from "@fastify/static";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { publicError, WorkbenchError, fail } from "../core/errors.js";
import { safePath, atomicWrite } from "../core/store.js";
import { command } from "./commands.js";
import { createDemo } from "../cli/demo.js";
const equal = (a, b) => {
    const x = Buffer.from(a), y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
};
export async function startServer(engine, options = {}) {
    const app = Fastify({
        logger: false,
        bodyLimit: 16 * 1024 * 1024,
        requestTimeout: 30000,
    });
    const token = options.token ?? randomBytes(32).toString("hex");
    const sessions = new Map();
    let origin = "";
    app.addHook("onRequest", async (req, reply) => {
        reply
            .header("X-Content-Type-Options", "nosniff")
            .header("Referrer-Policy", "no-referrer")
            .header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        if (req.headers.host !== new URL(origin || "http://127.0.0.1").host)
            throw new WorkbenchError("HOST_DENIED", "허용하지 않은 Host입니다.", undefined, false, 403);
        if (req.headers.origin && req.headers.origin !== origin)
            throw new WorkbenchError("ORIGIN_DENIED", "다른 사이트에서 접근할 수 없습니다.", undefined, false, 403);
        if (req.headers["sec-fetch-site"] === "cross-site")
            throw new WorkbenchError("CROSS_SITE", "외부 사이트 요청을 차단했습니다.", undefined, false, 403);
        if (!req.url.startsWith("/api/") ||
            req.url === "/api/session" ||
            req.url === "/api/health")
            return;
        const sid = req.headers.cookie
            ?.split(";")
            .map((s) => s.trim())
            .find((s) => s.startsWith("wb-session="))
            ?.slice(11);
        const csrf = sid ? sessions.get(sid) : undefined;
        if (!csrf)
            throw new WorkbenchError("AUTH_REQUIRED", "로컬 접근 인증이 필요합니다.", "sftw open 명령으로 브라우저를 여세요.", false, 401);
        if (!["GET", "HEAD"].includes(req.method) &&
            (req.headers.origin !== origin ||
                !equal(String(req.headers["x-wb-csrf"] ?? ""), csrf)))
            throw new WorkbenchError("CSRF_DENIED", "유효하지 않은 변경 요청입니다.", undefined, false, 403);
    });
    app.setErrorHandler((err, _req, reply) => {
        const status = err instanceof WorkbenchError
            ? err.statusCode
            : err.name === "ZodError" || err.code
                ? 400
                : 500;
        reply
            .code(status)
            .send(err.name === "ZodError"
            ? {
                code: "SCHEMA",
                message: "입력 형식이 올바르지 않습니다.",
                retryable: false,
                action: "필드와 데이터 타입을 확인하세요.",
            }
            : publicError(err));
    });
    app.get("/api/health", async () => ({ healthy: true }));
    app.post("/api/session", async (req, reply) => {
        const body = req.body;
        if (req.headers.origin !== origin ||
            typeof body?.token !== "string" ||
            !equal(body.token, token))
            throw new WorkbenchError("AUTH_REQUIRED", "로컬 접근 토큰을 확인하세요.", undefined, false, 401);
        const sid = randomBytes(32).toString("hex"), csrf = randomBytes(32).toString("hex");
        sessions.set(sid, csrf);
        reply.header("Set-Cookie", `wb-session=${sid}; HttpOnly; SameSite=Strict; Path=/`);
        return { csrf };
    });
    app.get("/api/session", async (req) => {
        const sid = req.headers.cookie
            ?.split(";")
            .map((s) => s.trim())
            .find((s) => s.startsWith("wb-session="))
            ?.slice(11);
        return { csrf: sessions.get(sid) };
    });
    app.get("/api/runs", async () => ({ runs: await engine.store.list() }));
    app.post("/api/runs", async (req) => {
        const b = req.body;
        if (!["fake", "live"].includes(b.mode) || !b.target)
            fail("INPUT", "연결 방식과 명시적인 대상 Org가 필요합니다.");
        return engine.create(b.mode, b.target, b.sourceRoot ?? engine.store.workspace);
    });
    app.post("/api/demo", async () => createDemo(engine));
    app.get("/api/runs/:id", async (req) => engine.store.load(req.params.id));
    app.post("/api/runs/:id/command", async (req) => command(engine, req.params.id, req.body, "browser", true));
    app.get("/api/runs/:id/files/:name", async (req, reply) => {
        const { id, name } = req.params;
        if (![
            "test-plan.xlsx",
            "test-results.xlsx",
            "test-report.md",
            "plan.json",
            "record-mapping.json",
            "operations.json",
        ].includes(name))
            fail("FILE_DENIED", "다운로드 허용 목록에 없는 파일입니다.");
        const file = await safePath(engine.store.dir(id), name);
        reply.header("Content-Disposition", `attachment; filename="${name}"`);
        reply.type(name.endsWith(".xlsx")
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : name.endsWith(".json")
                ? "application/json"
                : "text/markdown; charset=utf-8");
        return fs.readFile(file);
    });
    app.get("/api/runs/:id/import/:bundle/:name", async (req, reply) => {
        const { id, bundle, name } = req.params;
        if (!/^bundle-[a-f0-9-]+$/.test(bundle) ||
            !/^[-\w.]+\.(csv|md|json|apex)$/.test(name))
            fail("FILE_DENIED", "허용하지 않은 Import 파일입니다.");
        const file = await safePath(engine.store.dir(id), `import/${bundle}/${name}`);
        reply.header("Content-Disposition", `attachment; filename="${name}"`);
        return fs.readFile(file);
    });
    const ui = options.uiRoot ?? path.resolve("web-dist");
    try {
        await fs.access(path.join(ui, "index.html"));
        await app.register(staticFiles, { root: ui, index: "index.html" });
    }
    catch {
        app.get("/", async (_r, reply) => reply
            .type("text/plain")
            .send("UI 빌드가 없습니다. npm run build 후 다시 실행하세요."));
    }
    const address = await app.listen({
        host: "127.0.0.1",
        port: options.port ?? 0,
    });
    origin = address;
    await engine.store.init();
    await atomicWrite(path.join(engine.store.root, "access.json"), {
        url: origin,
        token,
        pid: process.pid,
    });
    await atomicWrite(path.join(engine.store.root, "mod-status.json"), {
        status: "실행 선택 대기",
        approvalPending: false,
        failureCount: 0,
        browserUrl: origin,
    });
    return { app, url: origin, token, close: () => app.close() };
}
