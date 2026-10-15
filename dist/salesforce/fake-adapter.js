import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import { AdapterError } from "./process.js";
import { buildSoql } from "./query.js";
import { resolveInput, parseRecoveredApexLog } from "./apex.js";
import { fieldValueErrors } from "./field-values.js";
export class FakeAdapter {
    options;
    mode = "fake";
    state = { counter: 0, records: {}, jobs: {}, writes: 0 };
    ready;
    org;
    schemas;
    constructor(options = {}) {
        this.options = options;
        this.org = {
            alias: "offline",
            orgId: "00D000000000001AAA",
            username: "offline@example.invalid",
            isSandbox: true,
            name: "오프라인 시뮬레이션",
            ...options.identity,
            mode: "fake",
        };
        this.schemas = Array.isArray(options.schemas)
            ? Object.fromEntries(options.schemas.map((d) => [d.name, d]))
            : (options.schemas ?? {});
        this.ready = this.initialize();
    }
    advanceCounter() {
        for (const rows of Object.values(this.state.records))
            for (const id of Object.keys(rows)) {
                const match = /^a00(\d{12})(?:AAA)?$/.exec(id);
                if (match)
                    this.state.counter = Math.max(this.state.counter, Number(match[1]));
            }
    }
    async initialize() {
        if (this.options.statePath) {
            try {
                const parsed = JSON.parse(await readFile(this.options.statePath, "utf8"));
                if (!Number.isSafeInteger(parsed.counter) ||
                    parsed.counter < 0 ||
                    !parsed.records ||
                    !parsed.jobs)
                    throw new Error("state");
                this.state = parsed;
                this.advanceCounter();
                return;
            }
            catch (error) {
                if (error.code !== "ENOENT")
                    throw new AdapterError("FAKE_STATE", "오프라인 상태 파일이 손상되었습니다.");
            }
        }
        this.state.records = structuredClone(this.options.records ?? {});
        this.state.jobs = structuredClone(this.options.jobs ?? {});
        this.advanceCounter();
    }
    async save() {
        if (!this.options.statePath)
            return;
        await mkdir(path.dirname(this.options.statePath), { recursive: true });
        const tmp = this.options.statePath + "." + randomUUID() + ".tmp";
        await writeFile(tmp, JSON.stringify(this.state, null, 2), {
            encoding: "utf8",
            mode: 0o600,
        });
        for (let attempt = 0;; attempt++) {
            try {
                await rename(tmp, this.options.statePath);
                return;
            }
            catch (error) {
                if (attempt >= 4 ||
                    !["EPERM", "EBUSY", "EACCES"].includes(String(error.code)))
                    throw error;
                await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
            }
        }
    }
    async identity() {
        await this.ready;
        return structuredClone(this.org);
    }
    setIdentity(identity) {
        this.org = { ...this.org, ...identity, mode: "fake" };
    }
    async describe(object) {
        await this.ready;
        const schema = this.schemas[object];
        if (!schema)
            throw new AdapterError("FAKE_SCHEMA", `오프라인 fixture에 스키마가 없습니다: ${object}`);
        return structuredClone(schema);
    }
    async constraints(objects) {
        return [
            ...objects.map((object) => ({
                object,
                category: "오프라인 스키마",
                detail: JSON.stringify(this.schemas[object] ?? null),
                source: "명시적 로컬 fixture (실제 Org 증거 아님)",
            })),
            ...structuredClone(this.options.constraints ?? []),
        ];
    }
    async deployedSource(file) {
        const source = this.options.sourceFiles?.find((f) => f.path === file.path && f.name === file.name);
        return source
            ? { content: source.content, apiVersion: source.apiVersion }
            : null;
    }
    async query(query, bindings) {
        await this.ready;
        const schema = await this.describe(query.object);
        buildSoql(query, schema, bindings);
        return Object.values(this.state.records[query.object] ?? {})
            .filter((row) => query.where.every((condition) => {
            const actual = row[condition.field] ?? null, expected = resolveInput(condition.value, bindings), type = schema.fields.find((field) => field.name === condition.field)?.type;
            const numeric = [
                "currency",
                "double",
                "int",
                "percent",
                "long",
                "decimal",
            ].includes(type ?? "");
            const compare = (left, right) => {
                if (left === null || right === null || right === undefined)
                    return undefined;
                try {
                    if (numeric)
                        return new Decimal(String(left)).cmp(new Decimal(String(right)));
                    if (type === "datetime") {
                        const a = Date.parse(String(left)), b = Date.parse(String(right));
                        return Number.isFinite(a) && Number.isFinite(b)
                            ? Math.sign(a - b)
                            : undefined;
                    }
                    return left === right ? 0 : left > right ? 1 : -1;
                }
                catch {
                    return undefined;
                }
            };
            const equal = (value) => actual === null || value === null
                ? actual === value
                : numeric || type === "datetime"
                    ? compare(actual, value) === 0
                    : actual === value;
            const order = compare(actual, expected);
            switch (condition.op) {
                case "eq":
                    return equal(expected);
                case "ne":
                    return !equal(expected);
                case "in":
                    return Array.isArray(expected) && expected.some(equal);
                case "gt":
                    return order !== undefined && order > 0;
                case "gte":
                    return order !== undefined && order >= 0;
                case "lt":
                    return order !== undefined && order < 0;
                case "lte":
                    return order !== undefined && order <= 0;
            }
        }))
            .slice(0, query.limit)
            .map((row) => Object.fromEntries(query.fields.map((field) => [
            field,
            structuredClone(row[field] ?? null),
        ])));
    }
    async read(object, ids, fields) {
        if (!ids.length)
            return [];
        return this.query({
            object,
            fields: [...new Set(["Id", ...fields])],
            where: [
                { field: "Id", op: "in", value: { kind: "value", value: ids } },
            ],
            limit: 50000,
        }, {});
    }
    async mutate(request) {
        await this.ready;
        const schema = await this.describe(request.object);
        if (request.verb === "insert"
            ? !schema.createable
            : request.verb === "update"
                ? !schema.updateable
                : !schema.deletable)
            throw new AdapterError("OBJECT_PERMISSION", "선택한 오브젝트 동작 권한이 없습니다.");
        if (!request.records.length || request.records.length > 200)
            throw new AdapterError("TRANSACTION_SIZE", "단일 요청은 1~200개입니다.");
        const previous = structuredClone(this.state);
        this.state.records[request.object] ??= {};
        const records = this.state.records[request.object];
        const results = [];
        for (const r of request.records) {
            const errors = [];
            const failure = this.options.failRows?.(r, request);
            if (failure)
                errors.push(failure);
            if (request.verb !== "insert" && (!r.id || !records[r.id]))
                errors.push({
                    code: "INVALID_CROSS_REFERENCE_KEY",
                    message: "레코드가 존재하지 않습니다.",
                });
            for (const [field, value] of Object.entries(r.fields)) {
                const f = schema.fields.find((x) => x.name === field);
                if (!f ||
                    (request.verb === "insert" ? !f.createable : !f.updateable) ||
                    f.calculated)
                    errors.push({
                        code: "INVALID_FIELD_FOR_INSERT_UPDATE",
                        message: "쓰기 불가능한 필드입니다.",
                        fields: [field],
                    });
                if (f)
                    errors.push(...fieldValueErrors(f, value));
                if (f?.type === "reference" &&
                    value !== null &&
                    typeof value === "string" &&
                    !(f.referenceTo ?? []).some((o) => this.state.records[o]?.[value]))
                    errors.push({
                        code: "INVALID_CROSS_REFERENCE_KEY",
                        message: "참조 레코드가 없습니다.",
                        fields: [field],
                    });
            }
            if (request.verb === "insert")
                for (const f of schema.fields)
                    if (f.createable &&
                        !f.nillable &&
                        !f.defaultedOnCreate &&
                        !(f.name in r.fields))
                        errors.push({
                            code: "REQUIRED_FIELD_MISSING",
                            message: "필수 필드 누락",
                            fields: [f.name],
                        });
            if (errors.length) {
                results.push({ key: r.key, id: r.id, success: false, errors });
                continue;
            }
            if (!r.id && this.state.counter >= 999999999999)
                throw new AdapterError("FAKE_ID_LIMIT", "오프라인 ID 생성 범위를 초과했습니다. 새 fixture를 사용하세요.");
            const id = r.id ?? `a00${String(++this.state.counter).padStart(12, "0")}AAA`;
            if (request.verb === "delete")
                delete records[id];
            else
                records[id] = {
                    ...(records[id] ?? {}),
                    ...structuredClone(r.fields),
                    Id: id,
                    ...(schema.fields.some((f) => f.name === "LastModifiedDate")
                        ? { LastModifiedDate: new Date().toISOString() }
                        : {}),
                };
            results.push({ key: r.key, id, success: true, errors: [] });
        }
        if (request.allOrNone && results.some((r) => !r.success)) {
            this.state = previous;
            for (const result of results)
                if (result.success) {
                    result.success = false;
                    result.id = undefined;
                    result.errors = [
                        {
                            code: "ALL_OR_NONE_OPERATION_ROLLED_BACK",
                            message: "같은 요청의 실패로 롤백되었습니다.",
                        },
                    ];
                }
        }
        else {
            this.state.writes++;
            await this.options.mutationHook?.(request, this.state);
        }
        await this.save();
        return { transaction: "single", results };
    }
    async executeApex(script, correlationId) {
        await this.ready;
        if (!this.options.apexHandler)
            return {
                success: false,
                compiled: false,
                returnCaptured: false,
                exception: {
                    code: "FAKE_APEX_NOT_CONFIGURED",
                    message: "오프라인 fixture에 이 Apex 동작의 시뮬레이션이 구성되지 않았습니다.",
                },
            };
        const result = await this.options.apexHandler(script, correlationId, this.state);
        this.state.writes++;
        await this.save();
        return structuredClone(result);
    }
    async recoverApex(correlationId, logId) {
        await this.ready;
        const entry = this.options.recoveryLogs?.[logId];
        if (!entry)
            throw new AdapterError("APEX_LOG_NOT_FOUND", "오프라인 fixture에 명시한 기존 로그가 없습니다.");
        if (entry.username !== this.org.username)
            throw new AdapterError("APEX_LOG_USER", "기존 로그의 실행 사용자가 승인한 인증 사용자와 다릅니다.");
        return parseRecoveredApexLog(entry.log, correlationId, {
            id: logId,
            username: entry.username,
            startedAt: entry.startedAt,
            status: entry.status,
        });
    }
    async job(id) {
        await this.ready;
        const job = this.state.jobs[id];
        if (!job)
            throw new AdapterError("JOB_NOT_FOUND", "오프라인 fixture에 Job이 없습니다.");
        return structuredClone(job);
    }
    async relatedRecords(binding) {
        await this.ready;
        const result = [];
        for (const schema of Object.values(this.schemas))
            for (const field of schema.fields)
                if (field.referenceTo?.includes(binding.object))
                    for (const record of Object.values(this.state.records[schema.name] ?? {}))
                        if (record[field.name] === binding.id)
                            result.push({
                                object: schema.name,
                                id: String(record.Id),
                                field: field.name,
                            });
        return result;
    }
    async cancelJob(id) {
        await this.ready;
        const job = this.state.jobs[id];
        if (!job)
            throw new AdapterError("JOB_NOT_FOUND", "확인된 Job이 없습니다.");
        job.status = "Aborted";
        job.done = true;
        await this.save();
    }
    async inspectState() {
        await this.ready;
        return structuredClone(this.state);
    }
}
