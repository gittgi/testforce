import { assertIdentifier, resolveInput } from "./apex.js";
import { AdapterError } from "./process.js";
export function soqlString(value) {
    return ("'" +
        value
            .replaceAll("\\", "\\\\")
            .replaceAll("'", "\\'")
            .replaceAll("\r", "\\r")
            .replaceAll("\n", "\\n")
            .replaceAll("\t", "\\t") +
        "'");
}
function literal(value, type) {
    if (value === undefined)
        throw new AdapterError("QUERY_OMIT", "조회 조건 값은 생략할 수 없습니다.");
    if (value === null)
        return "null";
    if (typeof value === "boolean")
        return value ? "true" : "false";
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new AdapterError("QUERY_NUMBER", "유효한 숫자가 아닙니다.");
        return String(value);
    }
    if (typeof value === "string") {
        if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value))
            return value;
        if (type === "datetime" &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
            return value;
        return soqlString(value);
    }
    throw new AdapterError("QUERY_VALUE", "조회 조건에는 단순 값 또는 IN 목록만 사용할 수 있습니다.");
}
export function buildSoql(query, describe, bindings = {}) {
    assertIdentifier(query.object);
    if (query.object !== describe.name)
        throw new AdapterError("SCHEMA_OBJECT", "Describe와 조회 오브젝트가 다릅니다.");
    const names = new Set(describe.fields.map((f) => f.name));
    const check = (field) => {
        assertIdentifier(field);
        if (!names.has(field))
            throw new AdapterError("UNKNOWN_FIELD", `조회 필드가 Describe에 없습니다: ${field}`);
        return field;
    };
    const clauses = query.where.map((c) => {
        const field = check(c.field), value = resolveInput(c.value, bindings), type = describe.fields.find((f) => f.name === field)?.type;
        if (c.op === "in") {
            if (!Array.isArray(value) || !value.length)
                throw new AdapterError("QUERY_IN", "IN에는 비어 있지 않은 목록이 필요합니다.");
            return `${field} IN (${value.map((v) => literal(v, type)).join(",")})`;
        }
        const ops = { eq: "=", ne: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" };
        return `${field} ${ops[c.op]} ${literal(value, type)}`;
    });
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50000)
        throw new AdapterError("QUERY_LIMIT", "조회 최대 건수는 1~50000입니다.");
    return `SELECT ${query.fields.map(check).join(",")} FROM ${query.object}${clauses.length ? " WHERE " + clauses.join(" AND ") : ""} LIMIT ${query.limit}`;
}
