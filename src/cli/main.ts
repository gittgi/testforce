#!/usr/bin/env node
import { Command } from "commander";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { Store, atomicWrite, safePath } from "../core/store.js";
import { Engine } from "../execution/engine.js";
import { defaultAdapter, createDemo } from "./demo.js";
import { startServer } from "../server/http.js";
import { command } from "../server/commands.js";
import { publicError, fail } from "../core/errors.js";
import { PlanSchema, DraftSchema } from "../core/model.js";
import { z } from "zod";
import { installOfflineFixture, OfflineFixtureSchema } from "./fake-config.js";
import { toolVersion } from "./doctor.js";
const program = new Command()
  .name("sftw")
  .description("Claude Code용 Salesforce Sandbox 테스트 워크벤치")
  .version("0.1.0");
program.option(
  "--workspace <path>",
  "데이터·소스를 보관할 작업 폴더",
  process.cwd(),
);
const engine = () => {
  const store = new Store(path.resolve(program.opts().workspace));
  return new Engine(store, (r) => defaultAdapter(r, store.root));
};
const output = (value: unknown): void => {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
};
async function userConfirm(summary: unknown) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    fail(
      "INTERACTIVE_REQUIRED",
      "승인·최종 판정은 브라우저 또는 실제 터미널 대화에서만 입력할 수 있습니다.",
    );
  output(summary);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      "표시된 범위를 검토했습니다. 계속하려면 승인 을 입력하세요: ",
    );
    if (answer.trim() !== "승인")
      fail("CANCELLED", "사용자가 작업을 취소했습니다.");
  } finally {
    rl.close();
  }
}
async function openBrowser(url: string) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.protocol !== "http:"
  )
    fail("URL", "로컬 브라우저 주소만 열 수 있습니다.");
  const executable =
    process.platform === "win32"
      ? "rundll32.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(executable, args, {
    shell: false,
    stdio: "ignore",
    detached: true,
  });
  child.on("error", () =>
    process.stderr.write(
      "브라우저를 자동으로 열지 못했습니다. .workbench/access.json의 로컬 URL과 토큰을 이용하세요.\n",
    ),
  );
  child.unref();
}
program
  .command("init")
  .description("작업 폴더와 로컬 데이터 저장소 초기화")
  .option("--mode <mode>", "fake 또는 live", "fake")
  .option("--target <alias>", "명시적인 SF 대상", "offline")
  .option("--fixture <file>", "workspace 내부의 명시적 오프라인 fixture JSON")
  .action(async (opts) => {
    if (!["fake", "live"].includes(opts.mode))
      fail("MODE", "fake 또는 live를 선택하세요.");
    if (opts.fixture && opts.mode !== "fake")
      fail(
        "FAKE_MODE_REQUIRED",
        "--fixture는 명시적 fake 모드에서만 사용할 수 있습니다.",
      );
    const e = engine();
    await e.store.init();
    const fixture = opts.fixture
      ? await installOfflineFixture(e.store, opts.fixture)
      : undefined;
    await atomicWrite(await safePath(e.store.root, "workspace.json", true), {
      schemaVersion: 1,
      workspace: e.store.workspace,
      mode: opts.mode,
      target: opts.target,
    });
    await fs.writeFile(await safePath(e.store.root, ".gitignore", true), "*\n");
    output({
      workspace: e.store.workspace,
      mode: opts.mode,
      target: opts.target,
      fixture,
      next: "Claude Code에서 /testforce 또는 /testforce-ui",
    });
  });
program
  .command("serve")
  .description("선택적 브라우저 UI 서버 실행 (Mod 사용 시 불필요)")
  .option("--port <port>", "0이면 비어 있는 포트 사용", "0")
  .option("--no-open", "브라우저 자동 열기 생략")
  .action(async (opts) => {
    const e = engine();
    const uiRoot = fileURLToPath(new URL("../../web-dist/", import.meta.url));
    let server;
    try {
      server = await startServer(e, { port: Number(opts.port), uiRoot });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      server = await startServer(e, { port: 0, uiRoot });
    }
    process.stdout.write(
      `워크벤치: ${server.url}\n종료: Ctrl+C. Org 비동기 작업은 자동 취소되지 않습니다.\n`,
    );
    if (opts.open) await openBrowser(`${server.url}/#token=${server.token}`);
    const stop = async () => {
      await server.close();
      process.exit(0);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
program
  .command("open")
  .description("인증된 로컬 브라우저 열기")
  .action(async () => {
    const e = engine();
    const access = JSON.parse(
      await fs.readFile(path.join(e.store.root, "access.json"), "utf8"),
    );
    await openBrowser(`${access.url}/#token=${access.token}`);
  });
program
  .command("doctor")
  .description("런타임·CLI·경로·Mod 호환 점검 (Org 쓰기 없음)")
  .action(async () => {
    const e = engine();
    await e.store.init();
    const checks: Record<string, unknown> = {
      node: process.version,
      node24: process.versions.node.startsWith("24."),
      platform: process.platform,
      workspace: e.store.workspace,
      writeable: true,
      liveOrgTested: false,
    };
    for (const cmd of ["sf", "claude"] as const) {
      try {
        checks[cmd] = await toolVersion(cmd, e.store.workspace);
      } catch {
        checks[cmd] = "찾지 못했거나 실행 실패";
      }
    }
    checks.modMinimum = "2.1.287";
    checks.modVerification =
      "현재 설치 환경의 실제 Mod 렌더링은 별도 확인이 필요합니다.";
    output(checks);
  });
program
  .command("new")
  .description("승인 없는 새 실행 생성")
  .option("--mode <mode>", "fake 또는 live", "fake")
  .requiredOption("--target <alias>", "명시적 대상")
  .option("--source <path>", "소스 하위 경로")
  .action(async (opts) => {
    if (!["fake", "live"].includes(opts.mode))
      fail("MODE", "모드를 확인하세요.");
    const e = engine();
    output(
      await e.create(
        opts.mode,
        opts.target,
        opts.source
          ? path.resolve(e.store.workspace, opts.source)
          : e.store.workspace,
      ),
    );
  });
program
  .command("demo")
  .description("명시적인 오프라인 예제 실행 계획 생성 (실제 Org 사용 안 함)")
  .action(async () => output(await createDemo(engine())));
program
  .command("list")
  .description("이전 실행 목록")
  .action(async () => output(await engine().store.list()));
program
  .command("schema")
  .description("AI 제출/계획/오프라인 fixture JSON Schema 출력")
  .option("--kind <kind>", "draft, plan 또는 fixture", "draft")
  .action((opts) => {
    if (!["draft", "plan", "fixture"].includes(opts.kind))
      fail("SCHEMA_KIND", "draft, plan 또는 fixture를 선택하세요.");
    output(
      z.toJSONSchema(
        opts.kind === "fixture"
          ? OfflineFixtureSchema
          : opts.kind === "plan"
            ? PlanSchema
            : DraftSchema,
      ),
    );
  });
program
  .command("status")
  .requiredOption("--run <id>", "실행 ID")
  .action(async (opts) => output(await engine().store.load(opts.run)));
program
  .command("plan")
  .requiredOption("--run <id>", "실행 ID")
  .action(async (opts) => output((await engine().store.load(opts.run)).plan));
program
  .command("context")
  .requiredOption("--run <id>", "실행 ID")
  .requiredOption("--selection <text>", "클래스/트리거/메서드/커밋/diff")
  .option("--paths <paths...>", "모호한 검색 결과에서 선택한 소스 경로")
  .option(
    "--objects <names...>",
    "Describe와 관련 규칙을 읽을 추가 오브젝트 API 이름",
  )
  .action(async (opts) =>
    output(
      await engine().analyze(
        opts.run,
        opts.selection,
        opts.paths,
        opts.objects,
      ),
    ),
  );
const commandNames = [
  "submit",
  "edit",
  "approve",
  "prepare",
  "execute",
  "human",
  "collect",
  "observe",
  "review",
  "reports",
  "pause",
  "resume",
  "rerun",
  "keep",
  "cleanup-preview",
  "cleanup-approve",
  "cleanup",
  "reconcile",
  "excel-export",
  "excel-import",
  "excel-apply",
  "import-generate",
  "import-results",
  "ai-note",
  "manual-instructions",
  "manual-evidence",
  "restore-preview",
  "restore-approve",
  "restore",
  "cancel-preview",
  "cancel-approve",
  "cancel-job",
  "confirm-ownership",
];
for (const name of commandNames) {
  program
    .command(name)
    .description(
      {
        submit: "Skill의 구조화 초안 제출",
        approve: "계획 범위를 터미널에서 검토·승인",
        prepare: "승인한 준비 레코드 생성",
        execute: "승인한 도구 동작 실행",
        human: "사람 실행 완료와 실제 ID 보고",
        collect: "실제 값 수집·선언적 비교",
        observe: "제한 시간 동안 비동기 관찰",
        reports: "MD·계획/결과 Excel 생성",
        "cleanup-preview": "현재 정리 범위·충돌 조회",
      }[name] ?? name,
    )
    .requiredOption("--run <id>", "실행 ID")
    .option("--version <number>", "검토한 계획 버전")
    .option("--hash <hash>", "검토한 계획 해시")
    .option("--file <path>", "workspace 내부 JSON/Excel/CSV 입력")
    .option("--scope <scope>", "prepare, execute, existing", "prepare")
    .option("--scenario <id>", "시나리오 ID")
    .option("--phase <phase>", "fixture 또는 action", "action")
    .option("--bundle <id>", "Import 묶음 ID")
    .option("--text <text>", "분석 메모")
    .option("--details-hash <hash>", "정리 미리보기 해시")
    .action(async (opts) => {
      const e = engine();
      await e.store.init();
      const run = await e.store.load(opts.run);
      let payload: Record<string, unknown> = {};
      if (opts.file) {
        const file = await safePath(
          e.store.workspace,
          path.relative(
            e.store.workspace,
            path.resolve(e.store.workspace, opts.file),
          ),
        );
        if (name === "excel-import")
          payload.base64 = (await fs.readFile(file)).toString("base64");
        else if (name === "import-results")
          payload.csv = await fs.readFile(file, "utf8");
        else {
          const json = JSON.parse(await fs.readFile(file, "utf8"));
          payload =
            name === "submit"
              ? { draft: json }
              : name === "edit"
                ? { plan: json }
                : json;
        }
      }
      const input: Record<string, unknown> = {
        ...payload,
        command: name,
        version: opts.version ? Number(opts.version) : run.plan?.version,
        hash: opts.hash ?? run.plan?.hash,
        scope: opts.scope,
        scenarioId: opts.scenario ?? payload.scenarioId,
        phase: opts.phase,
        bundleId: opts.bundle ?? payload.bundleId,
        text: opts.text ?? payload.text,
        detailsHash: opts.detailsHash ?? payload.detailsHash,
      };
      let human = false;
      if (
        [
          "approve",
          "cleanup-approve",
          "human",
          "review",
          "reconcile",
          "restore-approve",
          "cancel-approve",
          "confirm-ownership",
        ].includes(name)
      ) {
        await userConfirm({
          action: name,
          run_id: run.run_id,
          plan: run.plan,
          input,
        });
        input.reviewed = true;
        human = true;
      }
      output(await command(e, opts.run, input, "terminal", human));
    });
}
program.parseAsync().catch((error) => {
  output(publicError(error));
  process.exitCode = 1;
});
