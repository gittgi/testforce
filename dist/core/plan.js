import { PlanSchema, } from "./model.js";
import { fail } from "./errors.js";
import { planHash } from "./hash.js";
import { fieldValueErrors } from "../salesforce/field-values.js";
export function validatePlan(input) {
    const p = PlanSchema.parse(input);
    const unique = (values, what) => {
        if (new Set(values).size !== values.length)
            fail("DUPLICATE_KEY", `${what} 키가 중복됩니다.`);
    };
    unique(p.scenarios.map((s) => s.id), "시나리오");
    unique(p.records.map((r) => r.key), "레코드");
    unique(p.expectations.map((e) => e.id), "기대값");
    unique(p.scenarios.flatMap((s) => s.actions.map((a) => a.id)), "동작");
    const keys = new Set(p.records.map((r) => r.key)), scenarios = new Set(p.scenarios.map((s) => s.id));
    for (const r of p.records) {
        if (!scenarios.has(r.scenarioId))
            fail("REFERENCE", "레코드의 시나리오가 없습니다.");
        if (r.ownership === "existing" && !r.existingId)
            fail("EXISTING_ID", "기존 레코드는 실제 ID가 필요합니다.");
        if (r.ownership === "created" && r.existingId)
            fail("FORGED_ID", "신규 계획에 실제 ID를 지정할 수 없습니다.");
        for (const k of [
            ...r.dependsOn,
            ...Object.values(r.fields)
                .filter((v) => v.kind === "ref")
                .map((v) => v.key),
        ])
            if (!keys.has(k))
                fail("REFERENCE", `참조 키 ${k}가 없습니다.`);
    }
    for (const s of p.scenarios) {
        for (const dep of s.dependsOn)
            if (dep === s.id || !scenarios.has(dep))
                fail("REFERENCE", "시나리오 의존성이 올바르지 않습니다.");
        for (const ref of s.sourceRefs)
            if (!p.source.files.some((f) => f.path === ref.path && f.content.includes(ref.symbol)))
                fail("SOURCE_REFERENCE", `소스 근거를 찾지 못했습니다: ${ref.path} / ${ref.symbol}`);
        for (const a of s.actions) {
            for (const k of a.recordKeys)
                if (!keys.has(k))
                    fail("REFERENCE", `동작의 레코드 ${k}가 없습니다.`);
            if (a.kind === "dml" && (!a.verb || !a.object || !a.recordKeys.length))
                fail("DML_PLAN", "DML 대상과 동작, 레코드를 지정하세요.");
            if (a.verb === "insert" &&
                a.recordKeys.some((k) => p.records.find((r) => r.key === k)?.stage !== "action"))
                fail("INSERT_STAGE", "Insert 테스트 입력은 준비 데이터와 분리해야 합니다.");
            if (a.kind === "service" && (!a.className || !a.method))
                fail("SERVICE_ENTRY", "Service 공개 호출 진입점을 지정하세요.");
            if (a.kind === "batch" && (!a.className || !a.scopeQuery))
                fail("BATCH_SCOPE", "Batch 클래스와 실제 대상 조회 조건이 필요합니다.");
            if (a.transaction === "per-record" &&
                a.allOrNone &&
                a.recordKeys.length > 1)
                fail("TRANSACTION_POLICY", "여러 개별 요청에 전체 allOrNone을 적용할 수 없습니다.");
            if (a.transaction === "single" && a.recordKeys.length > 200)
                fail("TRANSACTION_LIMIT", "단일 Composite 트랜잭션은 200개 이하입니다. 분리 요청은 별도 동작으로 계획하세요.");
        }
    }
    for (const e of p.expectations)
        if (!scenarios.has(e.scenarioId))
            fail("REFERENCE", "기대값의 시나리오가 없습니다.");
    const visit = (id, trail) => {
        if (trail.has(id))
            fail("DEPENDENCY_CYCLE", "시나리오 의존성이 순환합니다.");
        const next = new Set(trail).add(id);
        for (const dep of p.scenarios.find((s) => s.id === id).dependsOn)
            visit(dep, next);
    };
    p.scenarios.forEach((s) => visit(s.id, new Set()));
    return p;
}
export function sealPlan(input) {
    const p = validatePlan(input);
    p.hash = planHash(p);
    return p;
}
export function inputValue(value, bindings) {
    switch (value.kind) {
        case "value":
            return value.value;
        case "null":
            return null;
        case "omit":
            return undefined;
        case "ref":
            if (!bindings[value.key])
                fail("UNRESOLVED_ID", `레코드 ${value.key}의 실제 ID가 없습니다.`);
            return bindings[value.key];
    }
}
export function resolveFields(fields, bindings) {
    return Object.fromEntries(Object.entries(fields).flatMap(([k, v]) => {
        const val = inputValue(v, bindings);
        return val === undefined ? [] : [[k, val]];
    }));
}
/** An explicit, hashed runtime binding. It never runs a template or expression. */
export function bindAssertion(assertion, bindings) {
    const resolve = (value) => {
        if (Array.isArray(value))
            return value.map(resolve);
        if (value && typeof value === "object") {
            if (Object.keys(value).length === 1 &&
                typeof value.$recordId === "string") {
                if (!bindings[value.$recordId])
                    fail("UNRESOLVED_ID", `기대값의 ${value.$recordId} ID가 연결되지 않았습니다.`);
                return bindings[value.$recordId];
            }
            return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
        }
        return value;
    };
    return assertion.expected === undefined
        ? assertion
        : { ...assertion, expected: resolve(assertion.expected) };
}
export function validateFields(fields, d, verb, intentional = false) {
    for (const [key, v] of Object.entries(fields)) {
        const field = d.fields.find((f) => f.name === key);
        if (!field)
            fail("UNKNOWN_FIELD", `${d.name}.${key} 필드가 없습니다.`);
        if (v.kind === "omit")
            continue;
        if (field.calculated ||
            !(verb === "insert" ? field.createable : field.updateable))
            fail("FIELD_PERMISSION", `${d.name}.${key} 필드를 쓸 수 없습니다.`);
        if (intentional)
            continue;
        if (v.kind === "null" && !field.nillable)
            fail("REQUIRED_FIELD", `${key} 필드는 필수입니다.`);
        if (v.kind === "value") {
            if (typeof v.value === "string" &&
                field.length &&
                v.value.length > field.length)
                fail("FIELD_LENGTH", `${key} 길이 제한을 초과합니다.`);
            if (field.type === "boolean" && typeof v.value !== "boolean")
                fail("FIELD_TYPE", `${key}은 boolean 값이어야 합니다.`);
            const valueErrors = fieldValueErrors(field, v.value);
            if (valueErrors.length)
                fail("FIELD_TYPE", `${key}: ${valueErrors[0].message}`, valueErrors);
        }
    }
    if (verb === "insert" && !intentional)
        for (const f of d.fields)
            if (f.createable &&
                !f.nillable &&
                !f.defaultedOnCreate &&
                (!fields[f.name] || fields[f.name].kind === "omit"))
                fail("REQUIRED_FIELD", `${d.name}.${f.name} 필드는 필수입니다.`);
}
