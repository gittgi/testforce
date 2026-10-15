import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../../src/core/store.js";
import { Engine } from "../../src/execution/engine.js";
import { PlanSchema, type Run } from "../../src/core/model.js";
import { defaultAdapter } from "../../src/cli/demo.js";
import { installOfflineFixture } from "../../src/cli/fake-config.js";

/** Only builds an unapproved, explicitly offline plan. All DML happens through UI approval. */
async function comparisonFixture(manual = false) {
  const workspace = path.resolve(".e2e-workspace");
  const source = path.join(workspace, "test-fixtures", randomUUID());
  await mkdir(path.join(source, "force-app"), { recursive: true });
  await writeFile(path.join(source, "sfdx-project.json"), JSON.stringify({
    packageDirectories: [{ path: "force-app" }], sourceApiVersion: "66.0",
  }));
  await writeFile(path.join(source, "force-app", "UiComparison.cls"),
    "public class UiComparison { public static Integer nextValue(Integer current) { return current + 1; } }\n");
  const fixtureFile = path.join(source, "offline-fixture.json");
  await writeFile(fixtureFile, JSON.stringify({ schemaVersion: 1, schemas: [{
    name: "ComparisonRecord__c", createable: true, updateable: true, deletable: true,
    fields: [
      { name: "Id", type: "id", nillable: false, defaultedOnCreate: true, createable: false, updateable: false },
      { name: "Name", type: "string", length: 80, nillable: false, defaultedOnCreate: false, createable: true, updateable: true },
      { name: "Count__c", type: "int", nillable: false, defaultedOnCreate: false, createable: true, updateable: true },
    ],
  }] }));
  const store = new Store(workspace);
  await installOfflineFixture(store, fixtureFile);
  const engine = new Engine(store, (run) => defaultAdapter(run, store.root));
  const created = await engine.create("fake", "offline-ui-comparison", source);
  await engine.analyze(created.run_id, "UiComparison");
  const analyzed = await store.load(created.run_id);
  const plan = PlanSchema.parse({
    schemaVersion: 1, plan_id: "ui-comparison", version: 1, hash: "",
    org: await engine.adapterFor(analyzed).identity(), source: analyzed.source,
    scenarios: [{
      id: "update-comparison", title: manual ? "수동 Anonymous 안내" : "수량을 9에서 10으로 변경",
      purpose: "실제 Fake 저장소의 준비·변경·비교·화면 표시를 확인합니다.",
      rationale: "로컬 가상 소스와 스키마를 사용한 도구 자체 테스트입니다.",
      sourceRefs: [{ path: "force-app/UiComparison.cls", symbol: "UiComparison" }],
      selected: true, execution: manual ? "human-apex" : "tool",
      actions: [manual ? {
        id: "manual-debug", kind: "anonymous", script: "System.debug('승인된 오프라인 안내');\n",
        impact: { description: "오프라인 수동 안내 파일 생성만 확인", bounded: true },
      } : {
        id: "change-count", kind: "dml", verb: "update", object: "ComparisonRecord__c",
        recordKeys: ["sample"], fieldOverrides: { sample: { Count__c: { kind: "value", value: 10 } } },
        allOrNone: true, impact: { description: "이번 실행에서 생성한 단일 레코드의 수량 변경", bounded: true },
      }],
      observation: { pollMs: 100, timeoutMs: 1000 },
    }],
    records: manual ? [] : [{
      key: "sample", scenarioId: "update-comparison", object: "ComparisonRecord__c",
      stage: "fixture", ownership: "created",
      fields: { Name: { kind: "value", value: "표 비교용 레코드" }, Count__c: { kind: "value", value: 9 } },
    }],
    expectations: manual ? [] : [
      { id: "count-expected", scenarioId: "update-comparison", label: "수량 변경 결과", subject: { kind: "record", key: "sample", field: "Count__c" }, operator: "eq", expected: 11 },
      { id: "name-expected", scenarioId: "update-comparison", label: "이름 유지 결과", subject: { kind: "record", key: "sample", field: "Name" }, operator: "eq", expected: "표 비교용 레코드" },
    ],
    policies: { existingMutation: false, notes: "명시적 오프라인 E2E fixture" },
  });
  const run = await engine.submit(created.run_id, {
    run_id: created.run_id, request_id: analyzed.analysisRequest!.request_id,
    source_snapshot_hash: analyzed.source!.hash, plan_version: 0, plan,
  });
  expect(run.mode).toBe("fake");
  expect(run.approvals).toEqual([]);
  expect(run.operations).toEqual([]);
  return run;
}

async function selectedRun(page: Page): Promise<Run> {
  return page.evaluate(async () => {
    const id = sessionStorage.getItem("sftw-run");
    return (await fetch(`/api/runs/${id}`)).json();
  });
}

async function executeAndCompare(page: Page) {
  await page.getByRole("button", { name: "03 실행 결과", exact: true }).click();
  await page.getByRole("button", { name: "데이터 준비", exact: true }).click();
  await expect(page.getByRole("button", { name: "테스트 실행", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "테스트 실행", exact: true }).click();
  await expect(page.getByRole("button", { name: "결과 비교", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "결과 비교", exact: true }).click();
  await expect(page.getByRole("button", { name: "최종 판정 남기기 ↓" })).toBeVisible();
}

async function connect(page: Page) {
  const access = JSON.parse(
    await readFile(
      path.resolve(".e2e-workspace/.workbench/access.json"),
      "utf8",
    ),
  );
  await page.goto(`${access.url}/#token=${access.token}`);
  await expect(
    page.getByRole("heading", { name: "무엇을 테스트할까요?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "오프라인 예제 열기" }).first(),
  ).toBeEnabled();
}
async function demo(page: Page) {
  await connect(page);
  await page
    .getByRole("button", { name: "오프라인 예제 열기" })
    .first()
    .click();
  await expect(
    page.getByText(
      "명시적인 오프라인 예제입니다. 실제 Salesforce Org에 연결하지 않습니다.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "insert-example 제목" }),
  ).toHaveValue("오프라인 Insert 흐름");
}
async function approve(page: Page) {
  await expect(page.getByRole("textbox", { name: /승인자|검토자/ })).toHaveCount(0);
  await expect(page.getByLabel("승인 범위", { exact: true })).toHaveValue("execute");
  await page.getByRole("checkbox", { name: "계획과 변경 범위를 확인했습니다." }).check();
  await page.getByRole("button", { name: "이 계획 승인", exact: true }).click();
  await expect(
    page.getByText("계획 승인 요청이 처리되었습니다.", { exact: true }),
  ).toBeVisible();
}

test("오프라인 검토 → 승인 → 준비 → 실제 엔진 실행 → 비교 → 판정 → 보고서 → 보존", async ({
  page,
}) => {
  await demo(page);
  await page.getByRole("button", { name: "03 실행 결과" }).click();
  await page.getByText("단계별 실행 · 새로 수집 · 중단", { exact: true }).click();
  await expect(page.getByRole("button", { name: "1. 데이터 준비" })).toBeDisabled();
  await page.getByRole("button", { name: "01 테스트 계획" }).click();
  await approve(page);
  await page.getByRole("button", { name: "03 실행 결과" }).click();
  await page.getByRole("button", { name: "데이터 준비", exact: true }).click();
  await expect(
    page.getByText("데이터 준비 요청이 처리되었습니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "테스트 실행", exact: true }).click();
  await expect(
    page.getByText("승인된 도구 실행 요청이 처리되었습니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "결과 비교", exact: true }).click();
  await expect(page.getByRole("table", { name: "기대 결과와 실제 결과 비교" }).getByText("✓ 일치", { exact: true })).toBeVisible();
  await page.getByLabel("판정", { exact: true }).selectOption("accepted");
  await page
    .getByLabel("판정 메모", { exact: true })
    .fill("오프라인 증거를 확인했습니다.");
  await page.getByRole("button", { name: "개발자 판정 저장" }).click();
  await expect(
    page.getByText("개발자 판정 저장 요청이 처리되었습니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "04 보고서 · 정리" }).click();
  await page.getByRole("button", { name: "MD·Excel 보고서 생성" }).click();
  await expect(
    page.getByText("MD·Excel 보고서 생성 요청이 처리되었습니다.", {
      exact: true,
    }),
  ).toBeVisible();
  const reportLink = page
    .getByRole("link")
    .filter({ hasText: "한국어 사실 보고서" });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    reportLink.click(),
  ]);
  expect(download.suggestedFilename()).toBe("test-report.md");
  await page.getByRole("button", { name: "데이터 보존", exact: true }).click();
  await expect(
    page.getByText("데이터 보존 요청이 처리되었습니다.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "04 보고서 · 정리" }).click();
  await expect(page.getByText("보존됨", { exact: false })).toBeVisible();
  await page.screenshot({
    path: "test-results/workbench-review.png",
    fullPage: true,
  });
});

test("계획 직접 편집은 재승인을 요구하며 새로고침 후 유지된다", async ({
  page,
}) => {
  await demo(page);
  await approve(page);
  await page.getByRole("button", { name: "02 데이터 편집" }).click();
  const field = page.getByRole("textbox", { name: "row-1.Name", exact: true });
  await field.focus();
  await field.blur();
  await expect(page.getByText("✓ 승인됨", { exact: true })).toBeVisible();
  const polled = page.waitForResponse(
    (response) =>
      /\/api\/runs\/run-/.test(response.url()) &&
      response.request().method() === "GET",
  );
  await field.fill("한글 경로와 편집 값");
  await polled;
  await expect(field).toHaveValue("한글 경로와 편집 값");
  await field.blur();
  await expect(
    page.getByText("편집 중 · 재승인 필요", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(
    page.getByText("계획 변경 저장 요청이 처리되었습니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "03 실행 결과" }).click();
  await page.getByText("단계별 실행 · 새로 수집 · 중단", { exact: true }).click();
  await expect(page.getByRole("button", { name: "1. 데이터 준비" })).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "02 데이터 편집" }).click();
  await expect(
    page.getByRole("textbox", { name: "row-1.Name", exact: true }),
  ).toHaveValue("한글 경로와 편집 값");
});

test("실제 사용자 정리 승인 후 이번 실행의 오프라인 레코드만 삭제한다", async ({
  page,
}) => {
  await demo(page);
  await approve(page);
  await page.getByRole("button", { name: "03 실행 결과" }).click();
  await page.getByRole("button", { name: "데이터 준비", exact: true }).click();
  await expect(
    page.getByText("데이터 준비 요청이 처리되었습니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "테스트 실행", exact: true }).click();
  await expect(
    page.getByText("승인된 도구 실행 요청이 처리되었습니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "결과 비교", exact: true }).click();
  await expect(page.getByRole("table", { name: "기대 결과와 실제 결과 비교" }).getByText("✓ 일치", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "04 보고서 · 정리" }).click();
  await page
    .getByRole("button", { name: "정리 대상 확인", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "삭제 대상과 충돌 검토" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: /정리 승인자|검토자/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "확인한 데이터 삭제" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "삭제할 테스트 데이터를 확인했습니다." }).check();
  await page.getByRole("button", { name: "확인한 데이터 삭제" }).click();
  await expect(page.getByText("삭제 확인", { exact: true })).toBeVisible();
});

test("세션 인증·Origin·CSRF 경계를 브라우저 요청에서 검사한다", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/runs")).status()).toBe(401);
  await connect(page);
  const denied = await page.evaluate(async () => {
    const response = await fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return response.status;
  });
  expect(denied).toBe(403);
  expect(
    (
      await request.post("/api/session", {
        headers: { Origin: "https://malicious.example" },
        data: { token: "wrong" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get("/api/health", { headers: { Host: "evil.example" } })
    ).status(),
  ).toBe(403);
});

test("계획 Excel을 내려받아 편집·재불러오기한 변경은 재승인을 요구한다", async ({
  page,
}) => {
  const { default: ExcelJS } = await import("exceljs");
  await demo(page);
  await approve(page);
  await page.getByRole("button", { name: "02 데이터 편집" }).click();
  await page
    .getByRole("button", { name: "계획 Excel 생성", exact: true })
    .click();
  await expect(
    page.getByText("계획 Excel 생성 요청이 처리되었습니다.", { exact: true }),
  ).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "test-plan.xlsx 다운로드" }).click(),
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await download.path())!);
  const sheet = workbook.getWorksheet("입력_1")!;
  const headers = sheet.getRow(1).values as unknown[];
  sheet.getRow(2).getCell(headers.indexOf("Name")).value =
    "Excel로 수정한 이름";
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  await page.getByLabel("수정 Excel 불러오기", { exact: true }).setInputFiles({
    name: "수정 계획.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: bytes,
  });
  await expect(
    page.getByRole("heading", { name: "Excel 변경 검토" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "검증 후 새 계획으로 저장" }).click();
  await expect(
    page.getByRole("textbox", { name: "row-1.Name", exact: true }),
  ).toHaveValue("Excel로 수정한 이름");
  await page.getByRole("button", { name: "03 실행 결과" }).click();
  await page.getByText("단계별 실행 · 새로 수집 · 중단", { exact: true }).click();
  await expect(page.getByRole("button", { name: "1. 데이터 준비" })).toBeDisabled();
});

test("사람 Insert는 준비 중 실행되지 않고 승인된 실제 Import 파일을 제공한다", async ({
  page,
}) => {
  await demo(page);
  await page
    .getByRole("combobox", { name: "insert-example 실행 방식" })
    .selectOption("human-import");
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(
    page.getByText("계획 변경 저장 요청이 처리되었습니다.", { exact: true }),
  ).toBeVisible();
  await approve(page);
  await page.getByRole("button", { name: "03 실행 결과" }).click();
  await page.getByRole("button", { name: "데이터 준비", exact: true }).click();
  await expect(
    page.getByText("데이터 준비 요청이 처리되었습니다.", { exact: true }),
  ).toBeVisible();
  const count = await page.evaluate(async () => {
    const list = await (await fetch("/api/runs")).json();
    const run = await (await fetch("/api/runs/" + list.runs[0].run_id)).json();
    return Object.keys(run.bindings).length;
  });
  expect(count).toBe(0);
  await page.getByLabel("파일 단계", { exact: false }).selectOption("action");
  await page.getByRole("button", { name: "승인 데이터로 파일 생성" }).click();
  await expect(
    page.getByRole("heading", { name: "생성된 Import 파일" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "README.md ↓", exact: true }),
  ).toBeVisible();
  const csv = page.getByRole("link", {
    name: /^action_001_Example__c_insert.csv ↓$/,
  });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    csv.click(),
  ]);
  expect(download.suggestedFilename()).toBe("action_001_Example__c_insert.csv");
  const content = await readFile((await download.path())!, "utf8");
  expect(content).toContain("Name");
  expect(content).toContain("오프라인 예제");
  expect(content).not.toContain("row-1");
});

test("소스 검색 후보와 오버로드는 실제 후보를 표시하고 명시적 선택을 받는다", async ({page}) => {
  await demo(page);
  const classes = path.resolve('.e2e-workspace/.workbench/demo-source/force-app/main/default/classes');
  await mkdir(classes, {recursive:true});
  await writeFile(path.join(classes,'ExampleHelper.cls'), "public class ExampleHelper { public static String run(String input) { return input; } public static Integer run(Integer input) { return input; } }\n");
  await writeFile(path.join(classes,'ExampleHelper.cls-meta.xml'), '<ApexClass><apiVersion>66.0</apiVersion><status>Active</status></ApexClass>');
  await page.getByText('분석 대상 · 소스 확인', {exact:false}).click();
  await page.getByRole('textbox',{name:'분석 대상'}).fill('example');
  await page.getByRole('button',{name:'컨텍스트 준비',exact:true}).click();
  await expect(page.getByRole('heading',{name:'분석 대상 후보를 선택하세요'})).toBeVisible();
  await page.getByRole('checkbox',{name:/classes\/ExampleHelper.cls/}).check();
  await page.getByRole('button',{name:'선택한 소스로 컨텍스트 준비'}).click();
  await expect(page.getByText('소스 후보 선택 요청이 처리되었습니다.',{exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'분석 대상'}).fill('ExampleHelper.run');
  await page.getByRole('button',{name:'컨텍스트 준비',exact:true}).click();
  await expect(page.getByRole('button',{name:'run(String input) 선택',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'run(Integer input) 선택',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'run(String input) 선택',exact:true}).click();
  await expect(page.getByText('메서드 시그니처 선택 요청이 처리되었습니다.',{exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'분석 대상'})).toHaveValue('ExampleHelper.run(String input)');
});

test("한 번 승인한 Update의 입력·실제 전후 값과 불일치를 표로 읽고 새로고침해도 보존한다", async ({ page }) => {
  const created = await comparisonFixture();
  await connect(page);
  await page.getByLabel("현재 테스트", { exact: true }).selectOption(created.run_id);
  await expect(page.getByRole("textbox", { name: "update-comparison 제목" })).toHaveValue("수량을 9에서 10으로 변경");
  await approve(page);
  await executeAndCompare(page);

  const table = page.getByRole("table", { name: "기대 결과와 실제 결과 비교", exact: true });
  await expect(table.getByRole("columnheader")).toHaveText([
    "확인할 항목", "실행 전", "실행 후 실제값", "기대 결과", "비교 결과 · 차이",
  ]);
  const count = table.getByRole("row").filter({ hasText: "수량 변경 결과" });
  await expect(count.getByRole("cell").nth(0)).toHaveText("9");
  await expect(count.getByRole("cell").nth(1)).toHaveText("10");
  await expect(count.getByRole("cell").nth(2)).toContainText("11");
  await expect(count.getByRole("cell").nth(3)).toContainText("≠ 불일치");
  await expect(table.getByRole("row").filter({ hasText: "이름 유지 결과" })).toContainText("✓ 일치");
  await expect(page.getByRole("heading", { name: "사람 실행 완료 보고" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Data Loader 수동 Import" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /승인자|검토자|실제 실행 사용자/ })).toHaveCount(0);
  await expect(page.locator("pre:visible")).toHaveCount(0);
  await page.getByText("레코드별 입력과 전후 값 자세히 보기", { exact: true }).click();
  const records = page.getByRole("region", { name: "sample 레코드 값 비교", exact: true });
  await expect(records.getByRole("columnheader")).toHaveText([
    "필드", "준비 입력", "테스트 동작 입력", "실행 전 실제값", "실행 후 실제값", "변화",
  ]);
  const numericRow = records.getByRole("row").filter({ hasText: "Count__c" });
  await expect(numericRow.getByRole("cell")).toHaveText(["9", "10", "9", "10", "↔ 변경됨"]);
  const persisted = await selectedRun(page);
  expect(persisted.mode).toBe("fake");
  expect(persisted.approvals).toHaveLength(1);
  expect(persisted.approvals[0]).toMatchObject({ scope: "execute", actor: "로컬 브라우저 사용자" });
  expect(persisted.operations.filter((operation) => operation.state === "SUCCEEDED")).toHaveLength(2);
  expect(persisted.scenarios["update-comparison"]!.baseline.sample!.Count__c).toBe(9);
  expect(persisted.scenarios["update-comparison"]!.after.sample!.Count__c).toBe(10);
  expect(persisted.review).toBeUndefined();
  await page.reload();
  await expect(table).toBeVisible();
  await expect(count.getByRole("cell").nth(0)).toHaveText("9");
  await expect(count.getByRole("cell").nth(1)).toHaveText("10");
  await expect(count.getByRole("cell").nth(3)).toContainText("≠ 불일치");
  await expect(page.locator("pre:visible")).toHaveCount(0);
  await page.screenshot({ path: "test-results/workbench-table-comparison.png", fullPage: true });
});

test("검토 체크 이후 계획을 편집하면 체크를 해제하고 새 계획을 다시 확인한다", async ({ page }) => {
  await demo(page);
  const checkbox = page.getByRole("checkbox", { name: "계획과 변경 범위를 확인했습니다." });
  const button = page.getByRole("button", { name: "이 계획 승인", exact: true });
  await checkbox.check();
  await expect(button).toBeEnabled();
  await page.getByRole("textbox", { name: "insert-example 제목" }).fill("수정한 테스트 목적");
  await expect(checkbox).not.toBeChecked();
  await expect(button).toBeDisabled();
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(page.getByText("계획 변경 저장 요청이 처리되었습니다.", { exact: true })).toBeVisible();
  await expect(checkbox).toBeEnabled();
  await expect(checkbox).not.toBeChecked();
  await expect(button).toBeDisabled();
  expect((await selectedRun(page)).approvals).toEqual([]);
  await approve(page);
  expect((await selectedRun(page)).approvals[0]!.planVersion).toBe(2);
});

test("모바일 화면에서도 단계 이름과 비교 표에 접근하고 문서 전체는 가로로 넘치지 않는다", async ({ page }) => {
  await demo(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "작업 단계" });
  for (const name of ["01 테스트 계획", "02 데이터 편집", "03 실행 결과", "04 보고서 · 정리"]) {
    await expect(nav.getByRole("button", { name, exact: true })).toBeVisible();
  }
  const assertNoDocumentOverflow = async () => {
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  };
  await assertNoDocumentOverflow();
  await approve(page);
  await executeAndCompare(page);
  await assertNoDocumentOverflow();
  const region = page.getByRole("region", { name: "기대 결과와 실제 결과 비교", exact: true });
  await expect(region).toBeVisible();
  await expect(region).toHaveAttribute("tabindex", "0");
  await region.focus();
  await expect(region).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await assertNoDocumentOverflow();
  await page.screenshot({ path: "test-results/workbench-mobile.png", fullPage: true });
});

test("사람 Anonymous 실행은 승인 후 스크립트와 안내서 다운로드를 제공한다", async ({ page }) => {
  const created = await comparisonFixture(true);
  await connect(page);
  await page.getByLabel("현재 테스트", { exact: true }).selectOption(created.run_id);
  await approve(page);
  await page.getByRole("button", { name: "03 실행 결과", exact: true }).click();
  await page.getByRole("button", { name: "데이터 준비", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Salesforce에서 직접 실행할 차례예요" })).toBeVisible();
  await page.getByRole("button", { name: "승인 스크립트·안내서 생성", exact: true }).click();
  const script = page.getByRole("link", { name: "manual-debug.apex ↓", exact: true });
  await expect(script).toBeVisible();
  await expect(page.getByRole("link", { name: "README.md ↓", exact: true })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), script.click()]);
  expect(await readFile((await download.path())!, "utf8")).toBe("System.debug('승인된 오프라인 안내');\n");
  await expect(page.getByRole("heading", { name: "사람 실행 완료 보고" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data Loader 수동 Import" })).toHaveCount(0);
  const run = await selectedRun(page);
  expect(run.mode).toBe("fake");
  expect(run.operations).toEqual([]);
  expect(run.scenarios["update-comparison"]!.status).toBe("WAITING_HUMAN");
});

test("실행 전 미리 수집한 결과가 있어도 준비·실행 뒤 새 비교를 안내한다", async ({ page }) => {
  await demo(page);
  await page.getByRole("button", { name: "03 실행 결과", exact: true }).click();
  await page.getByText("단계별 실행 · 새로 수집 · 중단", { exact: true }).click();
  await page.getByRole("button", { name: "3. 결과 수집·비교", exact: true }).click();
  await expect(page.getByText("실제 결과 수집·비교 요청이 처리되었습니다.", { exact: true })).toBeVisible();
  const before = await selectedRun(page);
  expect(before.operations).toEqual([]);
  expect(before.assertions[0]!.status).toBe("NOT_EXECUTED");
  await page.getByRole("button", { name: "01 테스트 계획", exact: true }).click();
  await approve(page);
  await executeAndCompare(page);
  await expect(page.getByRole("table", { name: "기대 결과와 실제 결과 비교" }).getByText("✓ 일치", { exact: true })).toBeVisible();
  const after = await selectedRun(page);
  expect(after.approvals).toHaveLength(1);
  expect(after.assertions[0]!.status).toBe("MATCH");
  expect(after.operations.filter((operation) => operation.phase === "action")).toHaveLength(1);
});
