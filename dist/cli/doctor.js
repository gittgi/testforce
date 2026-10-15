import { runProcess, resolveSfCommand, AdapterError, } from "../salesforce/process.js";
export async function toolVersion(tool, cwd, sfOptions = {}) {
    const command = tool === "sf"
        ? await resolveSfCommand(sfOptions)
        : { executable: tool, prefix: [] };
    const result = await runProcess(command.executable, [...command.prefix, "--version"], { cwd, timeoutMs: 15000, maxBytes: 64 * 1024 });
    if (result.exitCode !== 0)
        throw new AdapterError("DOCTOR_VERSION", "도구 버전을 확인하지 못했습니다.");
    return result.stdout.trim();
}
