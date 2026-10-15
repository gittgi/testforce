#!/usr/bin/env node
/** Private Mod adapter: use the plugin buttons, not this protocol to approve. */
import { modRequest } from "./bridge.js";
import { fail, publicError } from "../core/errors.js";

try {
  const [operation, ...rest] = process.argv.slice(2);
  if (!operation || rest.length)
    fail("MOD_PROTOCOL", "Mod 요청 형식 또는 크기가 올바르지 않습니다.");
  // The access capability must never be exposed in process listings / argv.
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 1024 * 1024) {
      process.stdin.destroy();
      fail("MOD_PROTOCOL", "Mod 요청 크기는 1 MiB 이하여야 합니다.");
    }
    chunks.push(buffer);
  }
  let payload: unknown;
  try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { fail("MOD_PROTOCOL", "Mod 요청 JSON 형식이 올바르지 않습니다."); }
  const response = await modRequest(operation, payload);
  process.stdout.write(JSON.stringify(response) + "\n");
  process.exitCode = response.ok ? 0 : 1;
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: publicError(error) }) + "\n");
  process.exitCode = 1;
}
