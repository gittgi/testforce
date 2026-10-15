// Run with npm run verify:package after build + package:local. Never connects to Salesforce.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import yauzl from "yauzl";

const zipPath =
  process.argv[2] ?? "artifacts/salesforce-sandbox-workbench-0.1.0.zip";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "워크벤치 ZIP 검증 "));
const prefix = "salesforce-sandbox-workbench/";
const seen = new Set();
let bytes = 0,
  server;
try {
  await new Promise((resolve, reject) =>
    yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry) => {
        (async () => {
          const name = entry.fileName;
          if (
            !name.startsWith(prefix) ||
            name.includes("\\") ||
            name.split("/").includes("..") ||
            seen.has(name) ||
            /plugin\/mod\/(?:config\.json|tsconfig\.json|\.claude-plugin\/types(?:\/|$))/.test(name) ||
            name.endsWith("/.testforce-install.json") ||
            /(?:^|\/)(?:node_modules|\.workbench|\.sf|\.sfdx|\.env|test-results)(?:\/|$)/.test(
              name,
            )
          )
            throw Error("Unsafe package entry");
          seen.add(name);
          bytes += entry.uncompressedSize;
          if (bytes > 32 * 1024 * 1024)
            throw Error("Package exceeds size limit");
          const data = await new Promise((done, bad) =>
            zip.openReadStream(entry, (e, stream) => {
              if (e) return bad(e);
              const chunks = [];
              stream.on("data", (c) => chunks.push(c));
              stream.on("end", () => done(Buffer.concat(chunks)));
              stream.on("error", bad);
            }),
          );
          if (data.includes(Buffer.from(process.cwd() + path.sep)))
            throw Error("Build-machine absolute path leaked");
          const target = path.join(dir, name);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, data);
          zip.readEntry();
        })().catch((error) => {
          zip.close();
          reject(error);
        });
      });
      zip.readEntry();
    }),
  );
  const root = path.join(dir, "salesforce-sandbox-workbench");
  const entry = path.join(root, "dist/cli/main.js"),
    workspace = path.join(dir, "사용자 작업 공간");
  const npmEntry = process.env.npm_execpath;
  if (!npmEntry || !/\.(?:js|cjs)$/.test(npmEntry))
    throw Error("Use npm run verify:package to select npm without a shell");
  async function run(args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: root,
        stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
        env: options.env ? { ...process.env, ...options.env } : process.env,
        shell: false,
      });
      let output = "";
      if (options.input) child.stdin.end(options.input);
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (output += d));
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0
          ? resolve(output)
          : reject(Error("Isolated command failed: " + output.slice(-1000))),
      );
    });
  }
  await run([npmEntry, "ci", "--omit=dev", "--no-fund"]);
  await run([entry, "--help"]);
  await run([
    entry,
    "--workspace",
    workspace,
    "init",
    "--mode",
    "fake",
    "--target",
    "offline",
  ]);
  const demo = JSON.parse(await run([entry, "--workspace", workspace, "demo"]));
  if (demo.mode !== "fake") throw Error("Demo must remain offline");
  const modEntry = path.join(root, "dist", "mod", "main.js");
  const modView = JSON.parse(await run([modEntry, "view"], { input: JSON.stringify({ workspace, runId: demo.run_id }) }));
  if (!modView.ok || modView.view.run?.run_id !== demo.run_id || modView.view.run?.mode !== "fake")
    throw Error("Offline Mod bridge failed before HTTP server startup");
  const claudeConfig = path.join(dir, "별도 Claude 설정");
  await run([path.join(root, "scripts", "install-testforce.mjs")], { env: { CLAUDE_CONFIG_DIR: claudeConfig } });
  const modConfig = JSON.parse(await fs.readFile(path.join(claudeConfig, "skills", "testforce-panel", "config.json"), "utf8"));
  if (modConfig.bridgeEntry !== await fs.realpath(modEntry)) throw Error("Installed Mod engine path incorrect");
  const skill = await fs.readFile(path.join(claudeConfig, "skills", "testforce", "SKILL.md"), "utf8");
  if (!skill.includes("/testforce-ui") || skill.includes("${CLAUDE_PLUGIN_ROOT}")) throw Error("Installed Skill launcher unresolved");
  server = spawn(
    process.execPath,
    [entry, "--workspace", workspace, "serve", "--no-open"],
    { cwd: root, stdio: "ignore", shell: false },
  );
  let access;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      access = JSON.parse(
        await fs.readFile(
          path.join(workspace, ".workbench/access.json"),
          "utf8",
        ),
      );
      if (access.pid === server.pid) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!access || access.pid !== server.pid) throw Error("Server did not start");
  const ui = await fetch(access.url);
  if (ui.status !== 200 || !(await ui.text()).includes("root"))
    throw Error("Built UI missing");
  const auth = await fetch(access.url + "/api/session", {
    method: "POST",
    headers: { Origin: access.url, "Content-Type": "application/json" },
    body: JSON.stringify({ token: access.token }),
  });
  if (auth.status !== 200) throw Error("Session failed");
  const cookie = auth.headers.get("set-cookie").split(";")[0];
  const list = await fetch(access.url + "/api/runs", {
    headers: { Cookie: cookie },
  });
  if (list.status !== 200) throw Error("API failed");
  const { runs } = await list.json();
  if (!Array.isArray(runs) || !runs.some((r) => r.run_id === demo.run_id))
    throw Error("Run persistence failed");
  const result = {
    node: process.version,
    archiveFiles: seen.size,
    uncompressedBytes: bytes,
    sha256: createHash("sha256")
      .update(await fs.readFile(zipPath))
      .digest("hex"),
    freshProductionInstall: true,
    help: true,
    init: true,
    demo: true,
    serverlessModBridge: true,
    personalSkillAndModInstall: true,
    uiStatus: ui.status,
    apiStatus: list.status,
    liveOrgUsed: false,
  };
  await fs.writeFile(
    "artifacts/install-smoke.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} finally {
  if (server && server.exitCode === null)
    await new Promise((resolve) => {
      server.once("exit", resolve);
      server.kill("SIGTERM");
    });
  await fs.rm(dir, { recursive: true, force: true });
}
