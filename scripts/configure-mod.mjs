import { writeFile, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Local installation paths are deliberately excluded from the distributable ZIP.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (Number(process.versions.node.split(".")[0]) !== 24)
  throw new Error("Node.js 24 LTS로 실행하세요. node --version을 확인하세요.");
const bridgeEntry = await realpath(join(root, "dist", "mod", "main.js"));
await readFile(bridgeEntry);
const config = { schemaVersion: 1, bridgeEntry, nodeExecutable: process.execPath };
await writeFile(join(root, "plugin", "mod", "config.json"), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
console.log("Mod 연결 완료. 실제 Salesforce 소스 폴더에서 다음 명령으로 여세요:\nclaude --plugin-dir " + JSON.stringify(join(root, "plugin", "mod")));
