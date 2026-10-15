import { createHash } from "node:crypto";
export function canonical(value) {
    if (value === undefined)
        return "null";
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return "[" + value.map(canonical).join(",") + "]";
    return ("{" +
        Object.keys(value)
            .filter((k) => value[k] !== undefined)
            .sort()
            .map((k) => JSON.stringify(k) +
            ":" +
            canonical(value[k]))
            .join(",") +
        "}");
}
export const hash = (value) => createHash("sha256").update(canonical(value)).digest("hex");
export const contentHash = (value) => createHash("sha256").update(value).digest("hex");
export const planHash = (plan) => hash({ ...plan, hash: "" });
