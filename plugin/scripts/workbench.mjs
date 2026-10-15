#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
// The shipped plugin is one directory below the engine installation. Execution data
// always follows --workspace, never this installation/cache directory.
const root =
  process.env.SFTW_ENGINE_ROOT ||
  resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const entry = resolve(root, "dist/cli/main.js");
if (!existsSync(entry)) {
  process.stderr.write(
    "실행 엔진을 찾을 수 없습니다. 배포 파일을 다시 내려받아 dist 폴더를 복원하거나 SFTW_ENGINE_ROOT를 지정하세요.\n",
  );
  process.exit(1);
}
const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  shell: false,
  stdio: "inherit",
  windowsHide: false,
});
child.on("error", (error) => {
  process.stderr.write(
    `실행 엔진을 시작하지 못했습니다: ${error.code ?? error.message}\n`,
  );
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
