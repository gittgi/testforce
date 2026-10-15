import { Decimal } from "decimal.js";

/** JSON numbers that would change in a JavaScript Number are kept as exact decimal strings. */
export function parseEvidenceJson(text: string): unknown {
  let output = "",
    offset = 0;
  while (offset < text.length) {
    const character = text[offset]!;
    if (character === '"') {
      const start = offset++;
      while (offset < text.length) {
        const current = text[offset++]!;
        if (current === "\\") {
          offset++;
          continue;
        }
        if (current === '"') break;
      }
      output += text.slice(start, offset);
      continue;
    }
    if (character === "-" || (character >= "0" && character <= "9")) {
      const raw = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
        text.slice(offset),
      )?.[0];
      if (raw) {
        const numeric = Number(raw);
        const exact =
          Number.isFinite(numeric) &&
          new Decimal(raw).eq(new Decimal(String(numeric)));
        output += exact ? raw : JSON.stringify(raw);
        offset += raw.length;
        continue;
      }
    }
    output += character;
    offset++;
  }
  return JSON.parse(output) as unknown;
}
