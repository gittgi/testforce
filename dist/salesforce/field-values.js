import { Decimal } from "decimal.js";
/** Type constraints only. Does not evaluate validation rules, Flow, triggers, or defaults. */
export function fieldValueErrors(field, value) {
    const error = (code, message) => [
        { code, message, fields: [field.name] },
    ];
    if (value === null)
        return field.nillable
            ? []
            : error("REQUIRED_FIELD_MISSING", "필수 필드 값이 null입니다.");
    if (field.type === "boolean" && typeof value !== "boolean")
        return error("INVALID_TYPE", "Boolean 필드에는 true/false가 필요합니다.");
    if (["int", "long", "double", "currency", "percent", "decimal"].includes(field.type)) {
        if ((typeof value !== "number" && typeof value !== "string") ||
            !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(String(value)))
            return error("INVALID_TYPE", "숫자 필드 값의 형식이 올바르지 않습니다.");
        try {
            const decimal = new Decimal(value);
            if (!decimal.isFinite())
                return error("INVALID_TYPE", "유한한 숫자가 필요합니다.");
            if (["int", "long"].includes(field.type) && !decimal.isInteger())
                return error("NUMBER_OUTSIDE_VALID_RANGE", "정수 필드에 소수 부분을 사용할 수 없습니다.");
            if (field.scale !== undefined && decimal.decimalPlaces() > field.scale)
                return error("NUMBER_OUTSIDE_VALID_RANGE", "소수 자릿수 제한을 초과했습니다.");
            const integerDigits = decimal.abs().lt(1) ? 0 : decimal.e + 1;
            if (field.precision &&
                integerDigits > field.precision - (field.scale ?? 0))
                return error("NUMBER_OUTSIDE_VALID_RANGE", "숫자 정밀도 제한을 초과했습니다.");
        }
        catch {
            return error("INVALID_TYPE", "숫자 필드 값을 해석하지 못했습니다.");
        }
    }
    const dateValid = (text) => /^\d{4}-\d{2}-\d{2}$/.test(text) &&
        Number.isFinite(Date.parse(text)) &&
        new Date(text + "T00:00:00Z").toISOString().slice(0, 10) === text;
    if (field.type === "date" && (typeof value !== "string" || !dateValid(value)))
        return error("INVALID_DATE", "Date 필드는 유효한 YYYY-MM-DD 형식이어야 합니다.");
    if (field.type === "datetime" &&
        (typeof value !== "string" ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
            !dateValid(value.slice(0, 10)) ||
            !Number.isFinite(Date.parse(value))))
        return error("INVALID_DATE", "DateTime 필드에는 시간대가 포함된 ISO 날짜가 필요합니다.");
    if ([
        "string",
        "textarea",
        "phone",
        "url",
        "email",
        "encryptedstring",
        "picklist",
        "multipicklist",
    ].includes(field.type) &&
        typeof value !== "string")
        return error("INVALID_TYPE", "문자열 필드에는 문자열이 필요합니다.");
    if (field.restrictedPicklist &&
        field.picklistValues &&
        typeof value === "string") {
        const requested = field.type === "multipicklist" ? value.split(";") : [value];
        if (requested.some((v) => !field.picklistValues.includes(v)))
            return error("INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST", "허용된 Picklist 값이 아닙니다.");
    }
    if (typeof value === "string" && field.length && value.length > field.length)
        return error("STRING_TOO_LONG", "필드 길이 제한을 초과했습니다.");
    return [];
}
