export class WorkbenchError extends Error {
  constructor(
    public code: string,
    message: string,
    public action = "내용을 확인하고 다시 시도하세요.",
    public retryable = false,
    public statusCode = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = "WorkbenchError";
  }
}
export function fail(code: string, message: string, details?: unknown): never {
  throw new WorkbenchError(code, message, undefined, false, 400, details);
}
export function publicError(error: unknown) {
  if (error instanceof WorkbenchError)
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      action: error.action,
      details: error.details,
    };
  if (error instanceof Error) {
    const e = error as Error & {
      code?: string;
      retryable?: boolean;
      candidates?: unknown;
    };
    return {
      code: e.code && /^[A-Z_]+$/.test(e.code) ? e.code : "VALIDATION_ERROR",
      message: redact(e.message).slice(0, 2000),
      retryable: e.retryable === true,
      action: "표시된 입력·연결 상태를 확인하고 수정하세요.",
      details: e.candidates ? { candidates: e.candidates } : undefined,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "작업을 완료하지 못했습니다.",
    retryable: false,
    action: "로컬 상태와 명령 입력을 확인하세요.",
  };
}
export function redact(text: string) {
  return text
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(
      /((?:access_token|accessToken|refresh_token|refreshToken|password|client_secret|sessionId)\s*[=:]\s*["']?)[^\s,"'}]+/gi,
      "$1[REDACTED]",
    )
    .replace(/00D[A-Za-z0-9]{12,15}![A-Za-z0-9._-]+/g, "[REDACTED]");
}
