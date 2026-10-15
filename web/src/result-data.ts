import type {
  Assertion,
  AssertionResult,
  ComparisonStatus,
  InputValue,
  Json,
  Run,
} from "../../src/core/model";

export const comparisonLabels: Record<ComparisonStatus, string> = {
  MATCH: "✓ 일치",
  MISMATCH: "≠ 불일치",
  UNVERIFIABLE: "? 확인 불가",
  NOT_EXECUTED: "– 미실행",
};

export const operatorLabels: Record<Assertion["operator"], string> = {
  eq: "같음", ne: "다름", null: "값 없음 (null)", notNull: "null이 아님",
  exists: "존재함", absent: "존재하지 않음", count: "레코드 수",
  gt: "초과", gte: "이상", lt: "미만", lte: "이하", range: "범위 안",
  changed: "실행 전과 달라짐", unchanged: "실행 전과 같음", includes: "포함함",
};

export const subjectLabels: Record<Assertion["subject"]["kind"], string> = {
  record: "레코드", query: "조회 결과", return: "반환값", error: "오류",
  job: "비동기 작업", manual: "사람 관찰",
};

/** A human-readable leaf; undefined stays distinct from every JSON value. */
export function scalarText(value: unknown): string {
  if (value === undefined) return "수집 안 됨";
  if (value === null) return "값 없음 (null)";
  if (value === "") return '빈 문자열 ("")';
  if (value === true) return "true (참)";
  if (value === false) return "false (거짓)";
  if (Array.isArray(value)) return value.length ? `${value.length}개 항목` : "빈 목록 (0개)";
  if (typeof value === "object") return Object.keys(value).length ? "필드별 값" : "빈 객체 (필드 없음)";
  return String(value);
}

export function ownValue(value: unknown, field: string): unknown {
  return value !== null && typeof value === "object" && Object.hasOwn(value, field)
    ? (value as Record<string, unknown>)[field] : undefined;
}

export interface ValueLeaf {
  path: string[];
  label: string;
  value: unknown;
}

export function valueLeaves(value: unknown, path: string[] = []): ValueLeaf[] {
  if (value !== null && typeof value === "object" && Object.keys(value).length) {
    return Object.entries(value).flatMap(([key, item]) => valueLeaves(item, [...path, key]));
  }
  return [{ path, label: path.map((part, index) => /^\d+$/.test(part) ? `[${Number(part) + 1}]` : `${index ? "." : ""}${part}`).join(""), value }];
}

export function atPath(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, field) => ownValue(current, field), value);
}

export function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) =>
    Object.hasOwn(right, key) && sameValue(ownValue(left, key), ownValue(right, key)));
}

export interface ComparisonRow {
  id: string;
  label: string;
  assertion?: Assertion;
  result?: AssertionResult;
}

/** Recorded comparisons remain authoritative; an absent result is pending, never a pass. */
export function comparisonRows(run: Run, scenarioId: string): ComparisonRow[] {
  const expectations = run.plan?.expectations.filter((a) => a.scenarioId === scenarioId) ?? [];
  const results = run.assertions.filter((a) => a.scenarioId === scenarioId);
  const rows: ComparisonRow[] = expectations.map((assertion) => ({
    id: assertion.id, label: assertion.label, assertion,
    result: results.find((result) => result.assertionId === assertion.id),
  }));
  for (const result of results) {
    if (!rows.some((row) => row.id === result.assertionId)) rows.push({
      id: result.assertionId,
      label: result.assertionId === "no-assertions" ? "비교 조건 없음"
        : result.assertionId === `duration-${scenarioId}` ? "처리 시간 (ms)" : result.assertionId,
      result,
    });
  }
  return rows;
}

export function comparisonCounts(rows: ComparisonRow[]) {
  const counts = { MATCH: 0, MISMATCH: 0, UNVERIFIABLE: 0, NOT_EXECUTED: 0, pending: 0 };
  for (const row of rows) {
    if (row.result) counts[row.result.status] += 1;
    else counts.pending += 1;
  }
  return counts;
}

export interface InputCell {
  source: string;
  input: InputValue;
  nestedPath: string[];
}

export interface RecordFieldRow {
  id: string;
  field: string;
  setup?: InputCell;
  actions: InputCell[];
  before: unknown;
  after: unknown;
  change: "changed" | "unchanged" | "missing" | "deleted";
  expectations: Assertion[];
}

export interface RecordComparison {
  key: string;
  object: string;
  id?: string;
  ownership?: string;
  rows: RecordFieldRow[];
  deletedByAction: boolean;
  cleanupDeleted: boolean;
}

/** A cleanup deletion must not masquerade as the outcome of a test Delete action. */
export function confirmedActionDeletion(run: Run, scenarioId: string, recordKey: string): boolean {
  const scenario = run.plan?.scenarios.find((s) => s.id === scenarioId);
  return !!scenario?.actions.some((action) => {
    if (action.kind !== "dml" || action.verb !== "delete" || !action.recordKeys.includes(recordKey)) return false;
    const results = ownValue(run.scenarios[scenarioId]?.actionResults[action.id], "results");
    return Array.isArray(results) && results.some((result) =>
      ownValue(result, "key") === recordKey && ownValue(result, "success") === true);
  });
}

export function recordComparisons(run: Run, scenarioId: string): RecordComparison[] {
  const scenario = run.plan?.scenarios.find((s) => s.id === scenarioId);
  const state = run.scenarios[scenarioId];
  const records = run.plan?.records.filter((record) => record.scenarioId === scenarioId) ?? [];
  const keys = new Set([
    ...records.map((r) => r.key), ...Object.keys(state?.baseline ?? {}), ...Object.keys(state?.after ?? {}),
    ...Object.values(run.bindings).filter((b) => b.scenarioId === scenarioId).map((b) => b.key),
  ]);
  return [...keys].map((key) => {
    const record = records.find((r) => r.key === key);
    const binding = run.bindings[key];
    const before = state?.baseline[key];
    const after = state?.after[key];
    const deletedByAction = confirmedActionDeletion(run, scenarioId, key);
    const setup = record?.stage === "fixture" ? record.fields : {};
    const inputs: { source: string; fields: Record<string, InputValue> }[] = [];
    for (const action of scenario?.actions ?? []) {
      if (action.kind !== "dml" || action.verb === "delete" || !action.recordKeys.includes(key)) continue;
      inputs.push({ source: `${action.id} · ${action.verb === "insert" ? "생성" : "변경"}`, fields: action.fieldOverrides[key] ?? record?.fields ?? {} });
    }
    if (record?.stage === "action" && !inputs.length) inputs.push({ source: "테스트 입력", fields: record.fields });
    const paths = new Map<string, string[]>();
    const addPaths = (value: unknown, prefix: string[] = []) => {
      for (const leaf of valueLeaves(value, prefix)) {
        if (leaf.path.length) paths.set(JSON.stringify(leaf.path), leaf.path);
      }
    };
    addPaths(before);
    addPaths(after);
    for (const fields of [setup, ...inputs.map((input) => input.fields)]) {
      for (const [field, input] of Object.entries(fields)) addPaths(input.kind === "value" ? input.value : undefined, [field]);
    }
    const expectations = run.plan?.expectations.filter((a) => a.scenarioId === scenarioId && a.subject.kind === "record" && a.subject.key === key) ?? [];
    for (const a of expectations) if (a.subject.field) {
      const path = a.subject.field.split(".");
      paths.set(JSON.stringify(path), path);
    }
    const inputCell = (fields: Record<string, InputValue>, path: string[], source: string): InputCell | undefined => {
      const input = fields[path[0]!];
      return input ? { source, input, nestedPath: path.slice(1) } : undefined;
    };
    const rows: RecordFieldRow[] = [...paths.values()].map((path) => {
      const oldValue = atPath(before, path), newValue = atPath(after, path);
      return {
        id: JSON.stringify(path), field: valueLeaves(undefined, path)[0]!.label,
        setup: inputCell(setup, path, "준비 입력"),
        actions: inputs.flatMap((input) => {
          const cell = inputCell(input.fields, path, input.source);
          return cell ? [cell] : [];
        }),
        before: oldValue, after: newValue,
        change: after === undefined && deletedByAction ? "deleted"
          : oldValue === undefined || newValue === undefined ? "missing"
            : sameValue(oldValue, newValue) ? "unchanged" : "changed",
        expectations: expectations.filter((a) => a.subject.field === path.join(".")),
      };
    });
    return {
      key, object: record?.object ?? binding?.object ?? "레코드", id: binding?.id,
      ownership: binding?.ownership, rows, deletedByAction,
      cleanupDeleted: run.cleanup.results.some((result) => result.key === key && result.success),
    };
  });
}

export function inputCellValue(cell: InputCell): unknown {
  return cell.input.kind === "value" ? atPath(cell.input.value, cell.nestedPath)
    : cell.input.kind === "null" ? null : undefined;
}

export function assertionExpected(assertion?: Assertion, result?: AssertionResult): Json | undefined {
  // The engine may resolve a logical reference into an actual ID; use that captured expected value.
  return result && Object.hasOwn(result, "expected") ? result.expected : assertion?.expected;
}
