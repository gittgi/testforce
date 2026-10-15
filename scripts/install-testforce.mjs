import { cp, mkdir, readFile, writeFile, lstat, realpath, rename, rm, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// Personal Skill + official skills-directory Mod. Never changes permissions,
// company policy, org authentication, or workspace state.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configRoot = resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"));
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("node scripts/install-testforce.mjs [--update]\n/testforce Skill과 /testforce-ui Mod를 개인 Claude 폴더에 설치합니다. --update는 소유 확인된 설치를 백업 후 갱신합니다. Node.js 24 LTS 필요.");
  process.exit(0);
}
if (args.some((x) => x !== "--update")) throw new Error("지원하는 옵션: --update, --help");
if (Number(process.versions.node.split(".")[0]) !== 24)
  throw new Error("Node.js 24 LTS로 실행하세요. node --version을 확인하세요.");
const updating = args.includes("--update");
const bridgeEntry = await realpath(join(root, "dist", "mod", "main.js"));
await readFile(bridgeEntry);
const launcher = join(root, "plugin", "scripts", "workbench.mjs").replaceAll("\\", "/");
const skillsRoot = join(configRoot, "skills");
const exists = async (p) => lstat(p).catch((e) => { if (e.code === "ENOENT") return null; throw e; });
for (const p of [configRoot, skillsRoot]) {
  if ((await exists(p))?.isSymbolicLink()) throw new Error(`심볼릭 링크 설치 위치는 사용할 수 없습니다: ${p}`);
}
if (await exists(join(configRoot, "commands", "testforce.md")))
  throw new Error("기존 commands/testforce.md와 충돌합니다. 해당 명령은 보존했습니다.");
const sourceSkill = join(root, "plugin", "skills", "testforce");
const sourceMod = join(root, "plugin", "mod");
const names = ["testforce", "testforce-panel"];
for (const name of names) {
  const target = join(skillsRoot, name);
  const st = await exists(target);
  if (!st) continue;
  if (!updating || !st.isDirectory() || st.isSymbolicLink())
    throw new Error(`기존 설치를 덮어쓰지 않습니다: ${target}. 이 도구의 설치라면 --update를 사용하세요.`);
  const marker = await readFile(join(target, ".testforce-install.json"), "utf8").then(JSON.parse).catch(() => null);
  let owned = marker?.product === "testforce";
  if (!owned && name === "testforce") {
    const legacy = await readFile(join(target, "SKILL.md"), "utf8").catch(() => "");
    owned = legacy.includes("name: testforce") && legacy.includes(launcher) && legacy.includes("엔진의 승인 진입점을 우회하지 않는다");
  }
  if (!owned) throw new Error(`이 도구가 설치한 폴더인지 확인되지 않아 보존합니다: ${target}`);
}
await mkdir(skillsRoot, { recursive: true });
const staging = join(configRoot, ".testforce-stage-" + randomUUID());
const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8);
const backup = join(configRoot, "testforce-backups", stamp);
async function copyRegular(source, target) {
  const st = await lstat(source);
  if (st.isSymbolicLink()) throw new Error(`심볼릭 링크 파일은 설치하지 않습니다: ${source}`);
  if (st.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const name of await readdir(source)) await copyRegular(join(source, name), join(target, name));
  } else if (st.isFile()) await cp(source, target, { errorOnExist: true, force: false });
  else throw new Error(`일반 파일이 아닙니다: ${source}`);
}
const swapped = [];
try {
  await mkdir(staging);
  await copyRegular(sourceSkill, join(staging, "testforce"));
  const skill = (await readFile(join(sourceSkill, "SKILL.md"), "utf8"))
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", join(root, "plugin").replaceAll("\\", "/"))
    .replaceAll("/sandbox-workbench:testforce", "/testforce");
  await writeFile(join(staging, "testforce", "SKILL.md"), skill);
  const mod = join(staging, "testforce-panel");
  await mkdir(join(mod, ".claude-plugin"), { recursive: true });
  await copyRegular(join(sourceMod, ".claude-plugin", "plugin.json"), join(mod, ".claude-plugin", "plugin.json"));
  await copyRegular(join(sourceMod, "hooks"), join(mod, "hooks"));
  await writeFile(join(mod, "config.json"), JSON.stringify({ schemaVersion: 1, bridgeEntry, nodeExecutable: process.execPath }, null, 2) + "\n", { mode: 0o600 });
  for (const name of names) {
    await writeFile(join(staging, name, ".testforce-install.json"), JSON.stringify({ product: "testforce", schemaVersion: 1, engineRoot: root, installedAt: new Date().toISOString() }, null, 2) + "\n", { mode: 0o600 });
  }
  for (const name of names) {
    const target = join(skillsRoot, name);
    const existed = Boolean(await exists(target));
    if (existed) {
      await mkdir(backup, { recursive: true });
      await rename(target, join(backup, name));
    }
    swapped.push({ name, existed, installed: false });
    await rename(join(staging, name), target);
    swapped[swapped.length - 1].installed = true;
  }
} catch (e) {
  for (const item of swapped.reverse()) {
    if (item.installed) await rm(join(skillsRoot, item.name), { recursive: true, force: true });
    if (item.existed) await rename(join(backup, item.name), join(skillsRoot, item.name));
  }
  throw e;
} finally {
  await rm(staging, { recursive: true, force: true });
}
console.log(`설치 완료: ${skillsRoot}\n실제 Salesforce 소스 폴더에서 Claude Code를 새로 열고 /testforce를 호출하세요. 패널 열기: /testforce-ui\n브라우저 서버는 필요하지 않습니다.`);
if (await exists(backup)) console.log(`기존 설치 백업: ${backup}`);
