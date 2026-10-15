import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { stringify } from "csv-stringify/sync";
import { Decimal } from "decimal.js";
import { parse } from "csv-parse/sync";
import {
  Identifier,
  type Plan,
  type RecordBinding,
  type RecordSpec,
  type Json,
  type ObjectDescribe,
} from "../core/model.js";

export interface ImportRow {
  key: string;
  object: string;
  scenarioId: string;
  fields: Record<string, string>;
  fingerprint: string;
  operation: "insert" | "update" | "delete";
}
export interface ImportFile {
  name: string;
  reviewName: string;
  object: string;
  scenarioId: string;
  operation: "insert" | "update" | "delete";
  api: "SOAP";
  insertNullValues: boolean;
  columns: string[];
  rows: ImportRow[];
  sha256: string;
  allOrNone: boolean;
  transaction: string;
}
export interface ImportBundle {
  schemaVersion: 1;
  planId: string;
  planVersion: number;
  planHash: string;
  phase: "fixture" | "action";
  files: ImportFile[];
  blocked: { key: string; reason: string }[];
  warnings: string[];
  guidePath: string;
  manifestPath: string;
}
export interface ImportMapping {
  key: string;
  id: string;
  object: string;
  scenarioId: string;
  operation: "insert" | "update" | "delete";
  proof: "unique-echoed-fields" | "explicit-user-mapping";
  requiresVerification: true;
  fields: Record<string, string>;
}
export interface ImportResult {
  mappings: ImportMapping[];
  failures: { key?: string; error: string; row: Record<string, string> }[];
  unresolved: { key?: string; row: Record<string, string>; reason: string }[];
}
const ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const tuple = (value: Record<string, string>) =>
  JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
const reviewValue = (v: string) =>
  /^[\s\u0000-\u001f]*[=+\-@]/.test(v) ? `'${v}` : v;
const isId = (s: string) => ID.test(s);
function raw(value: Json): string {
  if (value === null) return "";
  if (typeof value === "object")
    throw new Error(
      "Data Loader 셀에는 배열/객체를 전송할 수 없습니다. 필드 타입에 맞는 값으로 계획을 수정하세요.",
    );
  return String(value);
}
function refs(r: RecordSpec): string[] {
  return [
    ...new Set([
      ...r.dependsOn,
      ...Object.values(r.fields)
        .filter((x) => x.kind === "ref")
        .map((x) => x.key),
    ]),
  ];
}
function checkCycles(plan: Plan): void {
  const nodes = new Map(plan.records.map((r) => [r.key, r]));
  const visiting = new Set<string>(),
    done = new Set<string>();
  const visit = (key: string) => {
    if (done.has(key)) return;
    if (visiting.has(key))
      throw new Error(
        `순환 관계가 있습니다: ${key}. 부모 생성 후 관계 Update를 별도 계획으로 분리하세요.`,
      );
    visiting.add(key);
    for (const dep of refs(nodes.get(key)!)) {
      if (!nodes.has(dep)) throw new Error(`없는 논리키 참조: ${dep}`);
      visit(dep);
    }
    visiting.delete(key);
    done.add(key);
  };
  for (const key of nodes.keys()) visit(key);
}
/** Call only after engine approval/metadata verification. Does not perform Org writes. */
export async function createImportBundle(
  plan: Plan,
  bindings: Record<string, RecordBinding>,
  phase: "fixture" | "action",
  outputDir: string,
  scenarioId?: string,
): Promise<ImportBundle> {
  checkCycles(plan);
  await mkdir(outputDir, { recursive: true });
  const bundle: ImportBundle = {
    schemaVersion: 1,
    planId: plan.plan_id,
    planVersion: plan.version,
    planHash: plan.hash,
    phase,
    files: [],
    blocked: [],
    warnings: [],
    guidePath: path.join(outputDir, "README.md"),
    manifestPath: path.join(outputDir, "manifest.json"),
  };
  const selected = plan.scenarios.filter(
    (s) => s.selected && (!scenarioId || s.id === scenarioId),
  );
  const groups = new Map<
    string,
    {
      object: string;
      scenarioId: string;
      operation: "insert" | "update" | "delete";
      nulls: boolean;
      columns: string[];
      rows: ImportRow[];
      allOrNone: boolean;
      transaction: string;
    }
  >();
  const tasks: {
    record: RecordSpec;
    operation: "insert" | "update" | "delete";
    actionId: string;
    allOrNone: boolean;
    transaction: string;
  }[] = [];
  if (phase === "fixture")
    for (const record of plan.records.filter(
      (r) =>
        r.stage === "fixture" && selected.some((s) => s.id === r.scenarioId),
    )) {
      if (record.ownership === "existing" || bindings[record.key]?.id) continue;
      tasks.push({
        record,
        operation: "insert",
        actionId: `fixture_${record.scenarioId}`,
        allOrNone: false,
        transaction: "per-record",
      });
    }
  else
    for (const scenario of selected) {
      for (const action of scenario.actions) {
        if (action.kind !== "dml") {
          bundle.blocked.push({
            key: action.id,
            reason:
              "Service·Batch·Anonymous는 CSV 동작이 아닙니다. 승인 스크립트 안내를 사용하세요.",
          });
          continue;
        }
        if (!action.verb) {
          bundle.blocked.push({
            key: action.id,
            reason: "DML 종류가 없습니다.",
          });
          continue;
        }
        for (const key of action.recordKeys) {
          const record = plan.records.find((r) => r.key === key);
          if (!record) throw new Error(`없는 동작 레코드: ${key}`);
          tasks.push({
            record: {
              ...record,
              fields: action.fieldOverrides[key] ?? record.fields,
            },
            operation: action.verb,
            actionId: action.id,
            allOrNone: action.allOrNone,
            transaction: action.transaction,
          });
        }
      }
    }
  for (const task of tasks) {
    const r = task.record;
    Identifier.parse(r.object);
    const missing = refs(r).filter((key) => !bindings[key]?.id);
    if (missing.length) {
      bundle.blocked.push({
        key: r.key,
        reason: `부모/참조 ID 연결 후 파일을 다시 생성하세요: ${missing.join(", ")}`,
      });
      continue;
    }
    if (task.operation === "insert" && bindings[r.key]?.id) {
      bundle.blocked.push({
        key: r.key,
        reason:
          "이미 실제 ID가 연결된 Insert는 다시 내보내지 않습니다. 새 실행을 만드세요.",
      });
      continue;
    }
    const fields: Record<string, string> = {};
    let nulls = false,
      error = "";
    if (task.operation !== "insert") {
      const id = bindings[r.key]?.id ?? r.existingId;
      if (!id || !isId(id)) {
        bundle.blocked.push({
          key: r.key,
          reason: "Update/Delete에는 검증된 실제 ID 연결이 필요합니다.",
        });
        continue;
      }
      fields.Id = id;
    }
    if (task.operation !== "delete")
      for (const [field, value] of Object.entries(r.fields)) {
        Identifier.parse(field);
        if (value.kind === "omit") continue;
        if (value.kind === "ref") {
          const id = bindings[value.key]?.id;
          if (!id || !isId(id)) {
            error = `관계 ID 형식 오류: ${value.key}`;
            break;
          }
          fields[field] = id;
        } else if (value.kind === "null" || value.value === null) {
          fields[field] = "";
          nulls = true;
        } else if (value.value === "") {
          error = `${field}: 빈 문자열과 null을 Data Loader SOAP 경로에서 구분할 수 없습니다. 계획을 명시적 null로 수정하거나 도구 실행 경로를 사용하세요.`;
          break;
        } else {
          try {
            fields[field] = raw(value.value);
          } catch (err) {
            error = (err as Error).message;
            break;
          }
        }
      }
    if (error) {
      bundle.blocked.push({ key: r.key, reason: error });
      continue;
    }
    const columns = Object.keys(fields).sort();
    if (!columns.length) {
      bundle.blocked.push({
        key: r.key,
        reason: "업로드할 API 필드가 없습니다.",
      });
      continue;
    }
    const key = JSON.stringify([
      task.actionId,
      r.object,
      task.operation,
      columns,
      nulls,
    ]);
    let group = groups.get(key);
    if (!group) {
      group = {
        object: r.object,
        scenarioId: r.scenarioId,
        operation: task.operation,
        nulls,
        columns,
        rows: [],
        allOrNone: task.allOrNone,
        transaction: task.transaction,
      };
      groups.set(key, group);
    }
    group.rows.push({
      key: r.key,
      object: r.object,
      scenarioId: r.scenarioId,
      fields,
      fingerprint: hash(tuple(fields)),
      operation: task.operation,
    });
  }
  let index = 0;
  for (const group of groups.values()) {
    const name = `${phase}_${String(++index).padStart(3, "0")}_${group.object}_${group.operation}.csv`,
      reviewName = name.replace(".csv", ".review.csv");
    const csv = stringify(
      group.rows.map((r) => r.fields),
      {
        header: true,
        columns: group.columns,
        record_delimiter: "\r\n",
        bom: true,
      },
    );
    const reviewCsv = stringify(
      group.rows.map((r) =>
        Object.fromEntries(
          Object.entries(r.fields).map(([k, v]) => [k, reviewValue(v)]),
        ),
      ),
      {
        header: true,
        columns: group.columns,
        record_delimiter: "\r\n",
        bom: true,
      },
    );
    await writeFile(path.join(outputDir, name), csv, "utf8");
    await writeFile(path.join(outputDir, reviewName), reviewCsv, "utf8");
    bundle.files.push({
      name,
      reviewName,
      object: group.object,
      scenarioId: group.scenarioId,
      operation: group.operation,
      api: "SOAP",
      insertNullValues: group.nulls,
      columns: group.columns,
      rows: group.rows,
      sha256: hash(csv),
      allOrNone: group.allOrNone,
      transaction: group.transaction,
    });
    if (group.rows.length > 200)
      bundle.warnings.push(
        `${name}: SOAP 최대 요청 크기 200건. 여러 요청을 단일 트랜잭션 Bulk 테스트로 기록하지 마세요.`,
      );
    if (group.allOrNone || group.transaction === "single")
      bundle.warnings.push(
        `${name}: Data Loader 설정만으로 계획의 allOrNone/단일 트랜잭션을 보장하지 않습니다. 실제 요청 분할·결과를 기록하거나 도구 실행 경로를 사용하세요.`,
      );
  }
  const guide = [
    `# ${phase === "fixture" ? "준비" : "테스트 동작"} Data Loader 가져오기`,
    "",
    `계획 ${plan.plan_id}, 버전 ${plan.version}, 해시 ${plan.hash}. ${plan.org.mode === "fake" ? "이 자료는 오프라인 시뮬레이션용입니다. 실제 Org에 업로드하지 마세요." : "승인 화면에 표시한 Sandbox와 사용자로만 실행하세요."}`,
    "",
    "지원 경로는 Data Loader SOAP API입니다. Bulk API 및 Bulk API 2.0을 선택하지 마세요. 작업마다 실제 파일을 확인하고 CSV 머리글을 같은 Salesforce API 필드에 매핑하세요. 관리 논리키는 CSV에 포함되지 않습니다.",
    "",
    "원본 .csv는 Salesforce 업로드 전용입니다. 스프레드시트 앱으로 열지 마세요. 수식처럼 보이는 문자열도 승인한 원본 데이터로 보존됩니다. 사람이 검토할 때는 .review.csv를 사용하세요. 검토 파일은 수식 주입을 막기 위해 일부 표시값 앞에 작은따옴표를 붙였으며 업로드하면 안 됩니다.",
    "",
    "Data Loader의 Insert Null Values 설정은 아래 파일마다 맞추세요. 생략한 필드는 CSV 열에서 제외했습니다. 빈 문자열은 이 경로에서 의미를 보존할 수 없어 차단합니다. UTF-8 파일과 문자열 ID를 그대로 유지하고 필드 자동 잘라내기를 켜지 마세요.",
  ];
  for (const f of bundle.files)
    guide.push(
      "",
      `## ${f.name}`,
      `오브젝트: ${f.object}. 작업: ${f.operation}. 행: ${f.rows.length}. Insert Null Values: ${f.insertNullValues ? "켜기" : "끄기"}. 필드: ${f.columns.join(", ")}.`,
      `요청 정책: ${f.transaction}, allOrNone=${f.allOrNone}. Data Loader 실행 설정과 일치하는지 검토하세요. 실행 결과의 ID와 모든 입력 필드를 보존한 success/error CSV를 엔진에 불러오세요.`,
    );
  if (bundle.blocked.length)
    guide.push(
      "",
      "## 아직 생성하지 않은 행",
      ...bundle.blocked.map((b) => `- ${b.key}: ${b.reason}`),
    );
  if (bundle.warnings.length)
    guide.push(
      "",
      "## 실행 범위 검토",
      ...bundle.warnings.map((x) => `- ${x}`),
    );
  guide.push(
    "",
    "부모 파일을 먼저 업로드하고 결과 ID를 연결·재조회한 다음 자식 파일을 새로 생성하세요. 성공 파일의 행 순서나 Name만으로 연결하지 않습니다. 전체 반향 입력값이 유일하게 일치하지 않으면 UI에서 명시적으로 ID를 연결해야 합니다. 완료 보고만으로 업로드 성공 또는 데이터 소유권이 확정되지 않습니다.",
    "",
    "공식 근거: https://developer.salesforce.com/docs/platform/data-loader-impl/guide/inserting-updating-or-deleting-data.html 및 https://help.salesforce.com/s/articleView?id=000385696&language=en_US&type=1",
  );
  await writeFile(bundle.guidePath, guide.join("\n"), "utf8");
  await writeFile(bundle.manifestPath, JSON.stringify(bundle, null, 2), "utf8");
  return bundle;
}
/** Candidate links only. Engine must verify identity, read actual records, and persist proof. */
export async function mapImportResults(
  plan: Plan,
  bundle: ImportBundle,
  resultCsv: string,
  explicitMappings: Record<string, string> = {},
): Promise<ImportResult> {
  if (
    bundle.planId !== plan.plan_id ||
    bundle.planVersion !== plan.version ||
    bundle.planHash !== plan.hash
  )
    throw new Error("Import 결과가 현재 계획과 일치하지 않습니다.");
  const stat = await lstat(resultCsv);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 20 * 1024 * 1024 ||
    path.extname(resultCsv).toLowerCase() !== ".csv"
  )
    throw new Error("20 MB 이하 일반 CSV 파일이 필요합니다.");
  const data = await readFile(resultCsv, "utf8");
  const rows = parse(data, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    max_record_size: 1024 * 1024,
    relax_column_count: false,
  }) as Record<string, string>[];
  const source = bundle.files.flatMap((f) => f.rows);
  const result: ImportResult = { mappings: [], failures: [], unresolved: [] };
  const usedKeys = new Set<string>(),
    usedIds = new Set<string>();
  const normalized = (row: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]),
    );
  for (const row of rows) {
    const normalizedRow = normalized(row);
    const error = normalizedRow.error ?? normalizedRow.sf__error ?? "";
    const id = normalizedRow.id ?? normalizedRow.sf__id ?? "";
    const candidates = source.filter((r) =>
      Object.entries(r.fields).every(
        ([field, value]) =>
          Object.hasOwn(normalizedRow, field.toLowerCase()) &&
          normalizedRow[field.toLowerCase()] === value,
      ),
    );
    const mappedEntries = Object.entries(explicitMappings).filter(
      ([, v]) => v === id,
    );
    let candidate: ImportRow | undefined;
    let proof: ImportMapping["proof"] = "unique-echoed-fields";
    if (mappedEntries.length > 1)
      throw new Error("하나의 실제 ID를 여러 논리키에 연결할 수 없습니다.");
    if (mappedEntries.length === 1) {
      candidate = source.find((r) => r.key === mappedEntries[0]![0]);
      if (!candidate)
        throw new Error(
          `Import 대상에 없는 명시적 논리키: ${mappedEntries[0]![0]}`,
        );
      proof = "explicit-user-mapping";
    } else if (candidates.length === 1) candidate = candidates[0];
    if (error) {
      result.failures.push({
        ...(candidate ? { key: candidate.key } : {}),
        error,
        row,
      });
      continue;
    }
    if (!candidate || !isId(id)) {
      result.unresolved.push({
        row,
        reason: !isId(id)
          ? "성공 결과에 유효한 실제 ID가 없습니다."
          : candidates.length > 1
            ? "동일 입력값이 여러 행에 있어 명시적 ID 연결이 필요합니다."
            : "전체 입력 필드의 유일한 대응을 확인할 수 없습니다. 명시적 ID 연결이 필요합니다.",
      });
      continue;
    }
    if (usedKeys.has(candidate.key) || usedIds.has(id)) {
      result.unresolved.push({
        key: candidate.key,
        row,
        reason: "결과에 중복 논리키 또는 실제 ID가 있습니다.",
      });
      continue;
    }
    if (candidate.operation !== "insert" && candidate.fields.Id !== id) {
      result.unresolved.push({
        key: candidate.key,
        row,
        reason: "결과 ID가 승인한 Update/Delete ID와 다릅니다.",
      });
      continue;
    }
    usedKeys.add(candidate.key);
    usedIds.add(id);
    result.mappings.push({
      key: candidate.key,
      id,
      object: candidate.object,
      scenarioId: candidate.scenarioId,
      operation: candidate.operation,
      proof,
      requiresVerification: true,
      fields: candidate.fields,
    });
  }
  for (const [key, id] of Object.entries(explicitMappings)) {
    if (!source.some((r) => r.key === key) || !isId(id))
      throw new Error(`잘못된 명시적 ID 연결: ${key}`);
    if (
      !rows.some((r) => {
        const n = normalized(r);
        return (n.id ?? n.sf__id) === id;
      })
    )
      result.unresolved.push({
        key,
        row: { Id: id },
        reason:
          "명시적 ID가 결과 파일에 없습니다. 브라우저의 수동 실행 ID 연결을 사용하세요.",
      });
  }
  return result;
}

export interface ImportVerification {
  matches: boolean;
  mismatchedFields: string[];
  missingFields: string[];
  ownership: "unresolved";
  reason: string;
}
/** Verify only correspondence with an Org requery. A success CSV is untrusted and never proves creation ownership. */
export function verifyImportMapping(
  mapping: ImportMapping,
  actual: Record<string, Json> | undefined,
  describe?: ObjectDescribe,
): ImportVerification {
  const mismatchedFields: string[] = [],
    missingFields: string[] = [];
  if (!actual)
    return {
      matches: false,
      mismatchedFields: [],
      missingFields: ["Id"],
      ownership: "unresolved",
      reason:
        mapping.operation === "delete"
          ? "삭제 결과는 별도 조회 권한 확인과 부재 관찰로 검증하세요."
          : "실제 Org 레코드를 조회하지 못했습니다.",
    };
  const sameId = (a: string, b: string) =>
    a === b || (isId(a) && isId(b) && a.slice(0, 15) === b.slice(0, 15));
  if (typeof actual.Id !== "string" || !sameId(mapping.id, actual.Id))
    mismatchedFields.push("Id");
  for (const [field, expected] of Object.entries(mapping.fields)) {
    if (!Object.hasOwn(actual, field)) {
      missingFields.push(field);
      continue;
    }
    const got = actual[field];
    const metadata = describe?.fields.find((f) => f.name === field);
    let matches = false;
    if (expected === "") matches = got === null;
    else if (
      field === "Id" ||
      metadata?.type === "reference" ||
      metadata?.type === "id"
    )
      matches = typeof got === "string" && sameId(expected, got);
    else if (metadata?.type === "boolean")
      matches =
        typeof got === "boolean" && String(got) === expected.toLowerCase();
    else if (
      metadata &&
      ["currency", "double", "int", "long", "percent", "decimal"].includes(
        metadata.type,
      )
    ) {
      try {
        matches =
          got !== null &&
          typeof got !== "boolean" &&
          new Decimal(String(got)).eq(new Decimal(expected));
      } catch {
        matches = false;
      }
    } else if (metadata?.type === "datetime") {
      const x = Date.parse(expected),
        y = typeof got === "string" ? Date.parse(got) : NaN;
      matches = Number.isFinite(x) && Number.isFinite(y) && x === y;
    } else matches = typeof got === "string" && got === expected;
    if (!matches) mismatchedFields.push(field);
  }
  const matches = mismatchedFields.length === 0 && missingFields.length === 0;
  return {
    matches,
    mismatchedFields,
    missingFields,
    ownership: "unresolved",
    reason: matches
      ? "입력값과 실제 조회값의 대응을 확인했습니다. 이 결과만으로 이번 실행의 생성 소유권을 증명하지 않습니다."
      : "실제 조회값이 입력과 다르거나 필요한 필드가 누락되었습니다. 자동화 변경과 ID 연결을 검토하세요.",
  };
}
