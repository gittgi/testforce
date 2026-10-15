import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, cp, readdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

describe("personal Testforce installer", () => {
  it("installs from Korean/spaced paths, preserves owned edits in backup and refuses unowned collisions", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "테스트 Mod 설치 ")));
    try {
      const engine = path.join(root, "도구 경로"), config = path.join(root, "Claude 설정");
      await mkdir(path.join(engine, "scripts"), { recursive: true });
      await mkdir(path.join(engine, "dist", "mod"), { recursive: true });
      await writeFile(path.join(engine, "dist", "mod", "main.js"), "// installer fixture; never executed\n");
      await cp(new URL("../../scripts/install-testforce.mjs", import.meta.url), path.join(engine, "scripts", "install-testforce.mjs"));
      await cp(new URL("../../plugin", import.meta.url), path.join(engine, "plugin"), { recursive: true, filter: (source) => !source.includes("/.claude-plugin/types") });
      const invoke = (...args: string[]) => exec(process.execPath, [path.join(engine, "scripts", "install-testforce.mjs"), ...args], { env: { ...process.env, CLAUDE_CONFIG_DIR: config } });
      await invoke();
      const installed = path.join(config, "skills");
      const runtime = JSON.parse(await readFile(path.join(installed, "testforce-panel", "config.json"), "utf8"));
      expect(runtime.bridgeEntry).toBe(path.join(engine, "dist", "mod", "main.js"));
      expect(runtime.nodeExecutable).toBe(process.execPath);
      expect(await readFile(path.join(installed, "testforce", "SKILL.md"), "utf8")).toContain(path.join(engine, "plugin"));
      await writeFile(path.join(installed, "testforce", "user-note.md"), "보존해야 하는 개인 메모");
      await expect(invoke()).rejects.toThrow();
      await invoke("--update");
      const backups = await readdir(path.join(config, "testforce-backups"));
      expect(await readFile(path.join(config, "testforce-backups", backups[0], "testforce", "user-note.md"), "utf8")).toBe("보존해야 하는 개인 메모");
      await expect(readFile(path.join(config, "settings.json"))).rejects.toThrow();
      await rm(path.join(installed, "testforce-panel", ".testforce-install.json"));
      await writeFile(path.join(installed, "testforce-panel", "keep.txt"), "another plugin");
      await expect(invoke("--update")).rejects.toThrow();
      expect(await readFile(path.join(installed, "testforce-panel", "keep.txt"), "utf8")).toBe("another plugin");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
