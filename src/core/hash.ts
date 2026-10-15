import { createHash } from "node:crypto";
export function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonical((value as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}
export const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const contentHash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const planHash = (plan: { hash: string }) => hash({ ...plan, hash: "" });
