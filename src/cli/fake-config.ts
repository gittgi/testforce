/** Local, declarative offline fixtures. This module never constructs a live adapter. */
import {
  readFileSync,
  lstatSync,
  realpathSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Identifier, JsonValue, OrgSchema, type Run } from "../core/model.js";
import { atomicWrite, safePath, type Store } from "../core/store.js";
import { fail } from "../core/errors.js";
import { fieldValueErrors, type FakeOptions } from "../salesforce/index.js";

const MAX_BYTES = 5 * 1024 * 1024;
const Id = z.string().regex(/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/);
const Name = Identifier.refine(
  (v) => !["__proto__", "constructor", "prototype"].includes(v),
  "예약된 관리 키입니다.",
);
const Field = z
  .object({
    name: Name,
    type: z.string().min(1).max(60),
    length: z.number().int().nonnegative().optional(),
    precision: z.number().int().nonnegative().optional(),
    scale: z.number().int().nonnegative().optional(),
    nillable: z.boolean(),
    defaultedOnCreate: z.boolean(),
    createable: z.boolean(),
    updateable: z.boolean(),
    referenceTo: z.array(Name).optional(),
    picklistValues: z.array(z.string()).optional(),
    restrictedPicklist: z.boolean().optional(),
    defaultValue: JsonValue.optional(),
    defaultValueFormula: z.string().optional(),
    dependentPicklist: z.boolean().optional(),
    controllerName: Name.optional(),
    calculated: z.boolean().optional(),
  })
  .strict();
const ObjectSchema = z
  .object({
    name: Name,
    createable: z.boolean(),
    updateable: z.boolean(),
    deletable: z.boolean(),
    fields: z.array(Field).min(1).max(2000),
    childRelationships: z
      .array(
        z
          .object({
            childSObject: Name,
            field: Name,
            cascadeDelete: z.boolean(),
          })
          .strict(),
      )
      .optional(),
    recordTypes: z
      .array(
        z.object({ id: Id, name: z.string(), available: z.boolean() }).strict(),
      )
      .optional(),
  })
  .strict();
const Job = z
  .object({
    id: Id,
    status: z.enum([
      "Holding",
      "Queued",
      "Preparing",
      "Processing",
      "Aborted",
      "Completed",
      "Failed",
    ]),
    errors: z.number().int().nonnegative(),
    processed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    parentJobId: Id.optional(),
    done: z.boolean(),
    extendedStatus: z.string().optional(),
  })
  .strict();
export const OfflineFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    schemas: z.array(ObjectSchema).max(200).default([]),
    identity: OrgSchema.omit({ mode: true, alias: true }).partial().optional(),
    records: z
      .record(Name, z.record(Id, z.record(Name, JsonValue)))
      .default({}),
    jobs: z.record(Id, Job).default({}),
    constraints: z
      .array(
        z
          .object({
            object: Name,
            category: z.string(),
            detail: z.string().max(50000),
            source: z.string(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type OfflineFixture = z.infer<typeof OfflineFixtureSchema>;

export function parseOfflineFixture(text: string): OfflineFixture {
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES)
    fail("FAKE_FIXTURE_SIZE", "오프라인 fixture는 5 MiB 이하여야 합니다.");
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    fail("FAKE_FIXTURE_JSON", "오프라인 fixture JSON을 읽을 수 없습니다.");
  }
  // Bound nested JSON before recursive schema validation; no imported code/functions.
  const stack: { value: unknown; depth: number }[] = [
    { value: json, depth: 0 },
  ];
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (depth > 30)
      fail("FAKE_FIXTURE_DEPTH", "오프라인 fixture 중첩 깊이가 너무 큽니다.");
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        if (["__proto__", "constructor", "prototype"].includes(key))
          fail(
            "FAKE_FIXTURE_KEY",
            "예약된 관리 키를 fixture에 사용할 수 없습니다.",
          );
        stack.push({ value: child, depth: depth + 1 });
      }
  }
  const parsed = OfflineFixtureSchema.safeParse(json);
  if (!parsed.success)
    fail(
      "FAKE_FIXTURE_SCHEMA",
      "오프라인 fixture 형식을 확인하세요. schema --kind fixture로 계약을 확인할 수 있습니다.",
      parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    );
  const fixture = parsed.data;
  const schemas = new Map(fixture.schemas.map((s) => [s.name, s]));
  if (schemas.size !== fixture.schemas.length)
    fail("FAKE_FIXTURE_DUPLICATE", "오프라인 오브젝트 이름이 중복되었습니다.");
  for (const schema of fixture.schemas) {
    if (new Set(schema.fields.map((f) => f.name)).size !== schema.fields.length)
      fail(
        "FAKE_FIXTURE_DUPLICATE",
        `${schema.name}의 필드 이름이 중복되었습니다.`,
      );
    if (!schema.fields.some((f) => f.name === "Id" && f.type === "id"))
      fail("FAKE_FIXTURE_ID", `${schema.name}에는 Id 타입 필드가 필요합니다.`);
  }
  for (const [object, rows] of Object.entries(fixture.records)) {
    const schema = schemas.get(object);
    if (!schema)
      fail("FAKE_FIXTURE_OBJECT", `${object}의 Describe가 없습니다.`);
    for (const [id, row] of Object.entries(rows)) {
      if (row.Id !== id)
        fail(
          "FAKE_FIXTURE_ID",
          "레코드 맵의 ID와 실제 Id 값이 일치해야 합니다.",
        );
      for (const [field, value] of Object.entries(row)) {
        const described = schema.fields.find((f) => f.name === field);
        if (!described)
          fail(
            "FAKE_FIXTURE_FIELD",
            `${object}.${field}의 Describe가 없습니다.`,
          );
        if (fieldValueErrors(described, value).length)
          fail(
            "FAKE_FIXTURE_VALUE",
            `${object}.${field}의 오프라인 값 타입을 확인하세요.`,
          );
      }
    }
  }
  for (const [id, job] of Object.entries(fixture.jobs)) {
    if (
      job.id !== id ||
      job.done !== ["Completed", "Aborted", "Failed"].includes(job.status)
    )
      fail(
        "FAKE_FIXTURE_JOB",
        "오프라인 Job의 ID·상태·완료 여부가 일치하지 않습니다.",
      );
  }
  for (const constraint of fixture.constraints)
    if (
      !constraint.source.startsWith(
        "명시적 오프라인 fixture (실제 Org 증거 아님): ",
      )
    )
      constraint.source = `명시적 오프라인 fixture (실제 Org 증거 아님): ${constraint.source}`;
  return fixture;
}

export async function installOfflineFixture(
  store: Store,
  filename: string,
): Promise<{ file: string; objects: string[] }> {
  await store.init();
  const relative = path.relative(
    store.workspace,
    path.resolve(store.workspace, filename),
  );
  const source = await safePath(store.workspace, relative);
  const stat = await fs.stat(source);
  if (!stat.isFile() || stat.size > MAX_BYTES)
    fail(
      "FAKE_FIXTURE_SIZE",
      "오프라인 fixture는 5 MiB 이하의 JSON 파일이어야 합니다.",
    );
  const fixture = parseOfflineFixture(await fs.readFile(source, "utf8"));
  const target = await safePath(store.root, "offline-fixture.json", true);
  await atomicWrite(target, fixture);
  return {
    file: ".workbench/offline-fixture.json",
    objects: fixture.schemas.map((s) => s.name),
  };
}

function safeLocalFile(root: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes(".."))
    fail("FAKE_FIXTURE_PATH", "오프라인 상태 경로가 올바르지 않습니다.");
  const base = realpathSync(root),
    target = path.resolve(base, relative);
  let current = base;
  for (const part of path.relative(base, target).split(path.sep)) {
    current = path.join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink())
        fail(
          "SYMLINK_DENIED",
          "오프라인 fixture의 심볼릭 링크를 사용할 수 없습니다.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  return target;
}
function readFixture(file: string): OfflineFixture {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_BYTES)
    fail("FAKE_FIXTURE_SIZE", "오프라인 fixture 크기 또는 형식을 확인하세요.");
  return parseOfflineFixture(readFileSync(file, "utf8"));
}

/** The first use freezes workspace fixture configuration for this run. */
export function offlineOptions(run: Run, stateRoot: string): FakeOptions {
  const relative = path.join("runs", run.run_id, "offline-fixture.json");
  const snapshot = safeLocalFile(stateRoot, relative);
  let fixture: OfflineFixture;
  try {
    fixture = readFixture(snapshot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      fixture = readFixture(safeLocalFile(stateRoot, "offline-fixture.json"));
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code !== "ENOENT") throw missing;
      fixture = OfflineFixtureSchema.parse({ schemaVersion: 1 });
    }
    const temporary = snapshot + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(temporary, JSON.stringify(fixture, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporary, snapshot);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  return {
    schemas: fixture.schemas,
    records: fixture.records,
    jobs: fixture.jobs,
    constraints: fixture.constraints,
    identity: { ...fixture.identity, alias: run.target, mode: "fake" },
    sourceFiles: run.source?.files,
    statePath: safeLocalFile(
      stateRoot,
      path.join("runs", run.run_id, "fake-org.json"),
    ),
  };
}
