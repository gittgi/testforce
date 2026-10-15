import { spawn } from "node:child_process";
import { access, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

export class AdapterError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
    public unknown = false,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}
export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
export async function runProcess(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
    maxBytes?: number;
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<ProcessResult> {
  if (args.some((x) => x.includes("\0")))
    throw new AdapterError(
      "INVALID_ARGUMENT",
      "명령 인자에 NUL 문자가 있습니다.",
    );
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    let stdout = "",
      stderr = "",
      bytes = 0,
      settled = false;
    const stdoutDecoder = new StringDecoder("utf8"),
      stderrDecoder = new StringDecoder("utf8");
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    const timer = setTimeout(
      () =>
        fail(
          new AdapterError(
            "PROCESS_TIMEOUT",
            "명령 응답 시간을 초과했습니다. 쓰기 결과를 확인한 후 재개하세요.",
            false,
            true,
          ),
        ),
      options.timeoutMs ?? 60000,
    );
    const append = (part: "stdout" | "stderr", buffer: Buffer) => {
      bytes += buffer.length;
      if (bytes > (options.maxBytes ?? 20 * 1024 * 1024)) {
        fail(
          new AdapterError(
            "OUTPUT_LIMIT",
            "명령 출력이 허용 크기를 초과했습니다.",
            false,
            true,
          ),
        );
        return;
      }
      if (part === "stdout") stdout += stdoutDecoder.write(buffer);
      else stderr += stderrDecoder.write(buffer);
    };
    child.stdout.on("data", (b) => append("stdout", b));
    child.stderr.on("data", (b) => append("stderr", b));
    child.on("error", () => {
      clearTimeout(timer);
      fail(
        new AdapterError(
          "PROCESS_START",
          "실행 파일을 시작하지 못했습니다. 설치 경로와 권한을 확인하세요.",
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
  });
}
export async function resolveSfCommand(
  options: {
    platform?: NodeJS.Platform;
    pathEnv?: string;
    node?: string;
    executable?: string;
  } = {},
): Promise<{ executable: string; prefix: string[] }> {
  const platform = options.platform ?? process.platform;
  const names = platform === "win32" ? ["sf.exe", "sf.cmd", "sf"] : ["sf"];
  const locations = options.executable
    ? [options.executable]
    : (options.pathEnv ?? process.env.PATH ?? "")
        .split(platform === "win32" ? ";" : path.delimiter)
        .flatMap((p) => names.map((n) => path.join(p, n)));
  let found: string | undefined;
  for (const entry of locations) {
    try {
      await access(entry);
      found = await realpath(entry);
      break;
    } catch {
      /* next PATH entry */
    }
  }
  if (!found)
    throw new AdapterError(
      "SF_NOT_FOUND",
      "Salesforce CLI가 없습니다. 공식 설치 후 PATH를 확인하세요.",
    );
  if (platform !== "win32" || !found.toLowerCase().endsWith(".cmd"))
    return { executable: found, prefix: [] };
  // Never pass an untrusted argument through cmd.exe. Resolve only the known CLI JS entry.
  const dir = path.dirname(found),
    wrapper = await readFile(found, "utf8");
  const candidates = [
    path.join(dir, "node_modules", "@salesforce", "cli", "bin", "run.js"),
    path.join(dir, "..", "client", "bin", "run.js"),
    path.join(dir, "run.js"),
  ];
  for (const match of wrapper.matchAll(
    /"%(?:~dp0|dp0%)\\?([^"\r\n]+\.(?:js|cjs))"/gi,
  ))
    candidates.unshift(path.resolve(dir, match[1]!.replaceAll("\\", path.sep)));
  for (const candidate of candidates) {
    try {
      const entry = await realpath(candidate);
      const content = await readFile(entry, "utf8");
      if (!/oclif|@salesforce\/cli/.test(content)) continue;
      return { executable: options.node ?? process.execPath, prefix: [entry] };
    } catch {
      /* unsupported candidate */
    }
  }
  throw new AdapterError(
    "SF_WINDOWS_ENTRY",
    "sf.cmd의 안전한 Node 진입점을 찾을 수 없습니다. npm install --global @salesforce/cli 설치 경로를 확인하세요. 셸 우회 실행은 하지 않습니다.",
  );
}
export function parseCliJson(
  output: ProcessResult,
  allowApexFailure = false,
): Record<string, unknown> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(output.stdout.replace(/^\uFEFF/, "")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new AdapterError(
      "SF_JSON",
      "SF CLI가 올바른 JSON을 반환하지 않았습니다.",
      false,
      true,
    );
  }
  if (body === null || typeof body !== "object" || Array.isArray(body))
    throw new AdapterError(
      "SF_JSON",
      "SF CLI JSON 응답 형식이 올바르지 않습니다.",
      false,
      true,
    );
  if (body.status !== 0 || output.exitCode !== 0) {
    if (
      allowApexFailure &&
      body.data &&
      typeof body.data === "object" &&
      typeof (body.data as Record<string, unknown>).compiled === "boolean"
    )
      return body.data as Record<string, unknown>;
    // Authentication command output can contain secrets: never include raw body/stderr.
    throw new AdapterError(
      "SF_COMMAND_FAILED",
      "SF CLI 명령이 실패했습니다. 인증·권한·명령 버전을 확인하세요.",
    );
  }
  if (!body.result || typeof body.result !== "object")
    throw new AdapterError(
      "SF_CONTRACT",
      "SF CLI 응답에 result가 없습니다.",
      false,
      true,
    );
  return body.result as Record<string, unknown>;
}
