import type { Action, InputValue, Json, ApexResult } from "../core/model.js";
import { AdapterError } from "./process.js";
import { parseEvidenceJson } from "./json.js";
export const idPattern = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
export function assertIdentifier(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value))
    throw new AdapterError(
      "INVALID_IDENTIFIER",
      "API 이름에 허용되지 않는 문자가 있습니다.",
    );
  return value;
}
export function apexString(value: string): string {
  return (
    "'" +
    value
      .replaceAll("\\", "\\\\")
      .replaceAll("'", "\\'")
      .replaceAll("\r", "\\r")
      .replaceAll("\n", "\\n")
      .replaceAll("\t", "\\t")
      .replaceAll("\b", "\\b")
      .replaceAll("\f", "\\f") +
    "'"
  );
}
export function resolveInput(
  input: InputValue,
  bindings: Record<string, string>,
): Json | undefined {
  if (input.kind === "omit") return undefined;
  if (input.kind === "null") return null;
  if (input.kind === "value") return input.value;
  const id = bindings[input.key];
  if (!id || !idPattern.test(id))
    throw new AdapterError(
      "UNBOUND_REFERENCE",
      `실제 ID가 연결되지 않았습니다: ${input.key}`,
    );
  return id;
}
function argument(
  arg: Action["args"][number],
  bindings: Record<string, string>,
  template = false,
): string {
  const type = arg.type.trim();
  if (
    !/^[A-Za-z][A-Za-z0-9_.]*(?:\[\]|<[A-Za-z][A-Za-z0-9_.<>\[\], ]*>)?$/.test(
      type,
    )
  )
    throw new AdapterError(
      "INVALID_APEX_TYPE",
      "Apex 인자 타입이 올바르지 않습니다.",
    );
  const value =
    template &&
    arg.value.kind === "ref" &&
    bindings[arg.value.key] === `{{${arg.value.key}}}`
      ? bindings[arg.value.key]
      : resolveInput(arg.value, bindings);
  if (value === undefined)
    throw new AdapterError(
      "OMITTED_ARGUMENT",
      "메서드 인자는 생략할 수 없습니다.",
    );
  return `(${type})JSON.deserialize(${apexString(JSON.stringify(value))}, ${type}.class)`;
}
export function generateApexScript(
  action: Action,
  correlationId: string,
  bindings: Record<string, string>,
): string {
  const template = correlationId === "{{CORRELATION_ID}}";
  if (!template && !/^[A-Za-z0-9_.-]{1,120}$/.test(correlationId))
    throw new AdapterError(
      "INVALID_CORRELATION",
      "실행 상관 ID가 올바르지 않습니다.",
    );
  if (action.kind === "anonymous") return action.script;
  if (!action.className)
    throw new AdapterError("MISSING_CLASS", "호출할 클래스가 없습니다.");
  const name = assertIdentifier(action.className),
    ctors = action.constructorArgs
      .map((a) => argument(a, bindings, template))
      .join(", "),
    args = action.args.map((a) => argument(a, bindings, template)).join(", ");
  let expression: string;
  if (action.kind === "batch")
    expression = `Database.executeBatch(new ${name}(${ctors}), ${action.scopeSize})`;
  else if (action.kind === "service") {
    if (!action.method)
      throw new AdapterError("MISSING_METHOD", "호출할 메서드가 없습니다.");
    expression = `${action.static ? name : `new ${name}(${ctors})`}.${assertIdentifier(action.method)}(${args})`;
  } else
    throw new AdapterError(
      "DML_SCRIPT",
      "구조화 DML은 데이터 어댑터에서 실행합니다.",
    );
  const marker = `SFTW:${correlationId}:`;
  // Exceptions stay uncaught so a failed transaction is never silently committed.
  const begin = `System.debug(LoggingLevel.ERROR, ${apexString(marker + "BEGIN")});`;
  const execution =
    action.kind === "batch"
      ? `Id sftwJob = ${expression};\nSystem.debug(LoggingLevel.ERROR, ${apexString(marker + "JOB:")} + JSON.serialize(sftwJob));`
      : action.returns
        ? `Object sftwValue = ${expression};\nSystem.debug(LoggingLevel.ERROR, ${apexString(marker + "RETURN:")} + JSON.serialize(sftwValue));`
        : `${expression};`;
  return `${begin}\n${execution}\nSystem.debug(LoggingLevel.ERROR, ${apexString(marker + "END")});\n`;
}
function markers(
  logs: string,
  correlationId: string,
): { values: string[]; complete: boolean } {
  const prefix = `SFTW:${correlationId}:`;
  const values = logs.split(/\r?\n/).flatMap((line) => {
    const message =
      /\|USER_DEBUG\|\[[^\]\r\n]+\]\|(?:ERROR|DEBUG|INFO|WARN|FINE|FINER|FINEST)\|(.*)$/.exec(
        line,
      )?.[1];
    return message?.startsWith(prefix) ? [message.slice(prefix.length)] : [];
  });
  const complete =
    values.filter((v) => v === "BEGIN").length === 1 &&
    values.filter((v) => v === "END").length === 1 &&
    values[0] === "BEGIN" &&
    values.at(-1) === "END" &&
    values.filter((v) => v.startsWith("RETURN:")).length <= 1 &&
    values.filter((v) => v.startsWith("JOB:")).length <= 1 &&
    !/MAXIMUM DEBUG LOG SIZE REACHED/i.test(logs);
  return { values, complete };
}
export function parseApexResponse(
  result: Record<string, unknown>,
  correlationId: string,
): ApexResult {
  const logs = typeof result.logs === "string" ? result.logs : "";
  const { values, complete } = markers(logs, correlationId);
  const returns = values.filter((x) => x.startsWith("RETURN:")),
    jobs = values.filter((x) => x.startsWith("JOB:"));
  const output: ApexResult = {
    success: result.success === true,
    compiled: result.compiled === true,
    returnCaptured: false,
    log: logs,
  };
  if (!output.success)
    output.exception = {
      code: output.compiled ? "APEX_EXCEPTION" : "APEX_COMPILE_ERROR",
      message: String(
        result.exceptionMessage || result.compileProblem || "Apex 실행 오류",
      ),
    };
  if (complete && returns.length === 1) {
    try {
      output.returnValue = parseEvidenceJson(returns[0]!.slice(7)) as Json;
      output.returnCaptured = true;
    } catch {
      /* missing/truncated return remains uncaptured */
    }
  }
  if (complete && jobs.length === 1) {
    try {
      const id = JSON.parse(jobs[0]!.slice(4)) as unknown;
      if (typeof id === "string" && idPattern.test(id)) output.jobId = id;
    } catch {
      /* no guessed Job */
    }
  }
  return output;
}
/** Existing logs can reconcile a lost response only with successful metadata and a full correlation envelope. */
export function parseRecoveredApexLog(
  log: string,
  correlationId: string,
  recoveryLog: NonNullable<ApexResult["recoveryLog"]>,
): ApexResult {
  if (!/^[A-Za-z0-9_.-]{1,120}$/.test(correlationId))
    throw new AdapterError(
      "INVALID_CORRELATION",
      "실행 상관 ID가 올바르지 않습니다.",
    );
  const { values, complete } = markers(log, correlationId);
  const proven =
    complete &&
    recoveryLog.status === "Success" &&
    !/\|FATAL_ERROR\|/.test(log);
  const result = parseApexResponse(
    { success: proven, compiled: values.includes("BEGIN"), logs: log },
    correlationId,
  );
  result.recoveryLog = recoveryLog;
  if (!proven) {
    result.unknown = true;
    result.exception = {
      code: "APEX_RECOVERY_UNKNOWN",
      message:
        "기존 로그에서 해당 실행의 완전한 성공 증거를 확인하지 못했습니다. 자동 재실행하지 않습니다.",
    };
  }
  return result;
}
export function normalizeApexSource(content: string): string {
  return content.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
}
