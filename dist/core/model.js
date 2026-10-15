import { z } from "zod";
export const Identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/);
export const Key = z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/)
    .refine((value) => !["__proto__", "constructor", "prototype"].includes(value), "예약된 관리 키입니다.");
export const JsonValue = z.lazy(() => z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValue),
    z.record(z.string(), JsonValue),
]));
export const InputValueSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("value"), value: JsonValue }).strict(),
    z.object({ kind: z.literal("null") }).strict(),
    z.object({ kind: z.literal("omit") }).strict(),
    z.object({ kind: z.literal("ref"), key: Key }).strict(),
]);
export const OrgSchema = z
    .object({
    mode: z.enum(["fake", "live"]),
    alias: z.string().min(1),
    orgId: z.string().min(1),
    username: z.string().min(1),
    isSandbox: z.boolean(),
    organizationType: z.string().min(1).optional(),
    verifiedScratchOrgId: z.string().regex(/^00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/).optional(),
    name: z.string(),
})
    .strict();
export const SourceFileSchema = z
    .object({
    path: z.string(),
    name: Identifier,
    kind: z.enum(["class", "trigger"]),
    hash: z.string(),
    content: z.string(),
    apiVersion: z.string(),
    methods: z.array(z.string()).default([]),
})
    .strict();
export const SourceSnapshotSchema = z
    .object({
    hash: z.string(),
    root: z.string(),
    files: z.array(SourceFileSchema),
    gitCommit: z.string().nullable(),
    dirty: z.boolean(),
    selection: z.string(),
    warnings: z.array(z.string()).default([]),
})
    .strict();
export const QuerySchema = z
    .object({
    object: Identifier,
    fields: z.array(Identifier).min(1),
    where: z
        .array(z
        .object({
        field: Identifier,
        op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in"]),
        value: InputValueSchema,
    })
        .strict())
        .default([]),
    limit: z.number().int().min(1).max(50000).default(2000),
})
    .strict();
export const RecordSpecSchema = z
    .object({
    key: Key,
    scenarioId: Key,
    object: Identifier,
    stage: z.enum(["fixture", "action"]),
    ownership: z.enum(["created", "existing"]),
    existingId: z
        .string()
        .regex(/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/)
        .optional(),
    fields: z.record(Identifier, InputValueSchema),
    dependsOn: z.array(Key).default([]),
    intentionalInvalid: z.boolean().default(false),
    existingImpactIds: z.array(z.string()).default([]),
})
    .strict();
export const AssertionSchema = z
    .object({
    id: Key,
    scenarioId: Key,
    label: z.string(),
    subject: z
        .object({
        kind: z.enum(["record", "query", "return", "error", "job", "manual"]),
        key: Key.optional(),
        field: z.string().optional(),
        query: QuerySchema.optional(),
    })
        .strict(),
    operator: z.enum([
        "eq",
        "ne",
        "null",
        "notNull",
        "exists",
        "absent",
        "count",
        "gt",
        "gte",
        "lt",
        "lte",
        "range",
        "changed",
        "unchanged",
        "includes",
    ]),
    expected: JsonValue.optional(),
    tolerance: z.number().nonnegative().default(0),
    unordered: z.boolean().default(false),
    valueType: z.enum(["auto", "decimal", "datetime"]).default("auto"),
    timezone: z.string().default("UTC"),
})
    .strict();
const ImpactSchema = z
    .object({
    description: z.string().min(1),
    existingRecordIds: z.array(z.string()).default([]),
    existingFields: z.array(Identifier).default([]),
    externalEffects: z.array(z.string()).default([]),
    bounded: z.boolean(),
    acknowledgement: z.string().default(""),
})
    .strict();
const ArgumentSchema = z
    .object({
    type: z.string().regex(/^[A-Za-z][A-Za-z0-9_.<>\[\], ]*$/),
    value: InputValueSchema,
})
    .strict();
export const ActionSchema = z
    .object({
    id: Key,
    kind: z.enum(["dml", "service", "batch", "anonymous"]),
    verb: z.enum(["insert", "update", "delete"]).optional(),
    object: Identifier.optional(),
    recordKeys: z.array(Key).default([]),
    fieldOverrides: z
        .record(Key, z.record(Identifier, InputValueSchema))
        .default({}),
    allOrNone: z.boolean().default(true),
    transaction: z.enum(["single", "per-record"]).default("single"),
    className: Identifier.optional(),
    method: Identifier.optional(),
    static: z.boolean().default(true),
    constructorArgs: z.array(ArgumentSchema).default([]),
    args: z.array(ArgumentSchema).default([]),
    returns: z.boolean().default(true),
    script: z.string().default(""),
    scriptPath: z.string().optional(),
    scriptHash: z.string().optional(),
    scopeSize: z.number().int().min(1).max(2000).default(200),
    scopeQuery: QuerySchema.optional(),
    approvedScopeIds: z.array(z.string()).default([]),
    impact: ImpactSchema,
})
    .strict();
export const ScenarioSchema = z
    .object({
    id: Key,
    title: z.string().min(1),
    purpose: z.string(),
    rationale: z.string(),
    sourceRefs: z.array(z
        .object({
        path: z.string(),
        symbol: z.string(),
        line: z.number().int().positive().optional(),
    })
        .strict()),
    selected: z.boolean(),
    execution: z.enum(["tool", "human-ui", "human-import", "human-apex"]),
    dependsOn: z.array(Key).default([]),
    preconditions: z.array(AssertionSchema).default([]),
    actions: z.array(ActionSchema),
    observation: z
        .object({
        pollMs: z.number().int().min(100).default(1000),
        timeoutMs: z.number().int().min(100).default(60000),
        expectedDurationMs: z.number().positive().optional(),
        durationRequirement: z.boolean().default(false),
        followupQueries: z.array(QuerySchema).default([]),
        completionAssertions: z.array(AssertionSchema).default([]),
    })
        .strict(),
})
    .strict();
export const PlanSchema = z
    .object({
    schemaVersion: z.literal(1),
    plan_id: Key,
    version: z.number().int().positive(),
    hash: z.string(),
    org: OrgSchema,
    source: SourceSnapshotSchema,
    scenarios: z.array(ScenarioSchema),
    records: z.array(RecordSpecSchema),
    expectations: z.array(AssertionSchema),
    policies: z
        .object({ existingMutation: z.boolean(), notes: z.string() })
        .strict(),
    constraints: z
        .array(z
        .object({
        object: z.string(),
        category: z.string(),
        detail: z.string(),
        source: z.string(),
    })
        .strict())
        .default([]),
})
    .strict();
export const DraftSchema = z
    .object({
    run_id: Key,
    request_id: Key,
    plan_version: z.number().int().nonnegative(),
    source_snapshot_hash: z.string(),
    plan: PlanSchema,
})
    .strict();
