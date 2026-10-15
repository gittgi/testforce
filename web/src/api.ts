let csrf = sessionStorage.getItem("sftw-csrf") ?? "";
let boot: Promise<void> | undefined;
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public action?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-WB-CSRF": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response
    .json()
    .catch(() => ({ message: "서버 응답을 읽을 수 없습니다." }));
  if (!response.ok)
    throw new ApiError(
      data.code ?? data.error?.code ?? `HTTP_${response.status}`,
      data.message ?? data.error?.message ?? "요청을 처리하지 못했습니다.",
      data.action ?? data.error?.action,
      data.candidates ??
        data.details?.candidates ??
        data.details ??
        data.error?.details,
    );
  return data as T;
}
export function bootstrap(): Promise<void> {
  if (boot) return boot;
  boot = (async () => {
    const hash = new URLSearchParams(location.hash.slice(1));
    const token =
      hash.get("token") ??
      (location.hash && !location.hash.includes("=")
        ? location.hash.slice(1)
        : "");
    const session = token
      ? await api<{ csrf: string }>("/api/session", { token })
      : await api<{ csrf?: string }>("/api/session");
    if (session.csrf) {
      csrf = session.csrf;
      sessionStorage.setItem("sftw-csrf", csrf);
    }
    if (token)
      history.replaceState(null, "", location.pathname + location.search);
  })();
  return boot;
}
export async function fileBase64(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error("파일은 10 MB 이하여야 합니다.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("파일을 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });
}
