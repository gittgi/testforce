import { Decimal } from "decimal.js";
import { canonical } from "./hash.js";
export function fieldAt(value, field) {
    if (!field)
        return value;
    let out = value;
    for (const k of field.split(".")) {
        if (["__proto__", "prototype", "constructor"].includes(k) ||
            out === null ||
            typeof out !== "object" ||
            !Object.hasOwn(out, k))
            return undefined;
        out = out[k];
    }
    return out;
}
function normalized(value, unordered) {
    if (Array.isArray(value))
        return unordered
            ? value
                .map((v) => normalized(v, true))
                .sort((a, b) => canonical(a).localeCompare(canonical(b)))
            : value.map((v) => normalized(v, false));
    return value;
}
export function compare(a, actual, before, execution = "observed") {
    const base = {
        assertionId: a.id,
        scenarioId: a.scenarioId,
        status: "UNVERIFIABLE",
        expected: a.expected,
        actual: actual,
        before: before,
        message: "",
    };
    if (execution === "not-executed")
        return {
            ...base,
            status: "NOT_EXECUTED",
            message: "테스트 동작이 전달되지 않았습니다.",
        };
    if (execution === "unknown" || actual === undefined)
        return {
            ...base,
            message: "판정에 필요한 실제 증거를 확보하지 못했습니다.",
        };
    try {
        let match = false;
        const eq = (x, y) => {
            if (a.valueType === "decimal" || a.tolerance > 0) {
                const xx = new Decimal(String(x)), yy = new Decimal(String(y));
                return xx.minus(yy).abs().lte(a.tolerance);
            }
            if (a.valueType === "datetime")
                return temporal(x) === temporal(y);
            return (canonical(normalized(x, a.unordered)) ===
                canonical(normalized(y, a.unordered)));
        };
        const cmp = (x, y) => a.valueType === "datetime"
            ? Math.sign(temporal(x) - temporal(y))
            : new Decimal(String(x)).cmp(new Decimal(String(y)));
        switch (a.operator) {
            case "eq":
                match = eq(actual, a.expected);
                break;
            case "ne":
                match = !eq(actual, a.expected);
                break;
            case "null":
                match = actual === null;
                break;
            case "notNull":
                match = actual !== null;
                break;
            case "exists":
                match = Array.isArray(actual) ? actual.length > 0 : actual !== null;
                break;
            case "absent":
                match = Array.isArray(actual) ? actual.length === 0 : actual === null;
                break;
            case "count":
                if (!Array.isArray(actual))
                    throw Error("not list");
                match = actual.length === a.expected;
                break;
            case "gt":
                match = cmp(actual, a.expected) > 0;
                break;
            case "gte":
                match = cmp(actual, a.expected) >= 0;
                break;
            case "lt":
                match = cmp(actual, a.expected) < 0;
                break;
            case "lte":
                match = cmp(actual, a.expected) <= 0;
                break;
            case "range":
                if (!Array.isArray(a.expected) || a.expected.length !== 2)
                    throw Error("range");
                match =
                    cmp(actual, a.expected[0]) >= 0 && cmp(actual, a.expected[1]) <= 0;
                break;
            case "changed":
                if (before === undefined)
                    throw Error("no baseline");
                match = !eq(actual, before);
                break;
            case "unchanged":
                if (before === undefined)
                    throw Error("no baseline");
                match = eq(actual, before);
                break;
            case "includes":
                match =
                    typeof actual === "string" && typeof a.expected === "string"
                        ? actual.includes(a.expected)
                        : Array.isArray(actual) && actual.some((v) => eq(v, a.expected));
                break;
        }
        return {
            ...base,
            status: match ? "MATCH" : "MISMATCH",
            message: match ? "승인한 조건과 일치합니다." : "승인한 조건과 다릅니다.",
        };
    }
    catch {
        return {
            ...base,
            message: "비교 타입 또는 실행 직전 증거를 확인할 수 없습니다.",
        };
    }
}
function temporal(v) {
    if (typeof v !== "string" ||
        !/^\d{4}-\d\d-\d\d(?:T.*(?:Z|[+-]\d\d:\d\d))?$/.test(v))
        throw Error("timezone required");
    const n = Date.parse(v);
    if (!Number.isFinite(n))
        throw Error("date");
    return n;
}
