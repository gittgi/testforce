import { cp, mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Install the bare /testforce command without changing Claude permissions.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "plugin", "skills", "testforce");
const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const target = join(config, "skills", "testforce");
for (const existing of [target, join(config, "commands", "testforce.md")]) {
  const stat = await lstat(existing).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (stat) throw new Error(`기존 /testforce 파일을 덮어쓰지 않습니다: ${existing}`);
}
const skill = (await readFile(join(source, "SKILL.md"), "utf8"))
  .replaceAll("${CLAUDE_PLUGIN_ROOT}", join(root, "plugin").replaceAll("\\", "/"))
  .replaceAll("/sandbox-workbench:testforce", "/testforce");
await mkdir(join(config, "skills"), { recursive: true });
await mkdir(target);
await cp(join(source, "references"), join(target, "references"), { recursive: true });
await writeFile(join(target, "SKILL.md"), skill, { flag: "wx" });
console.log(`설치 완료: ${target}\nClaude Code를 새로 시작한 뒤 /testforce를 호출하세요.`);
