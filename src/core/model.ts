import { z } from "zod";

export const Identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/);
export const Key = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/)
  .refine(
    (value) => !["__proto__", "constructor", "prototype"].includes(value),
    "예약된 관리 키입니다.",
  );
export const JsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValue),
    z.record(z.string(), JsonValue),
  ]),
);
export type Json =
  string | number | boolean | null | Json[] | { [key: string]: Json };
export const InputValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("value"), value: JsonValue }).strict(),
  z.object({ kind: z.literal("null") }).strict(),
  z.object({ kind: z.literal("omit") }).strict(),
  z.object({ kind: z.literal("ref"), key: Key }).strict(),
]);
export type InputValue = z.infer<typeof InputValueSchema>;
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
export type OrgIdentity = z.infer<typeof OrgSchema>;
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
export type SourceFile = z.infer<typeof SourceFileSchema>;
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
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;
export const QuerySchema = z
  .object({
    object: Identifier,
    fields: z.array(Identifier).min(1),
    where: z
      .array(
        z
          .object({
            field: Identifier,
            op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in"]),
            value: InputValueSchema,
          })
          .strict(),
      )
      .default([]),
    limit: z.number().int().min(1).max(50000).default(2000),
  })
  .strict();
export type QuerySpec = z.infer<typeof QuerySchema>;
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
export type RecordSpec = z.infer<typeof RecordSpecSchema>;
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
export type Assertion = z.infer<typeof AssertionSchema>;
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
export type Action = z.infer<typeof ActionSchema>;
export const ScenarioSchema = z
  .object({
    id: Key,
    title: z.string().min(1),
    purpose: z.string(),
    rationale: z.string(),
    sourceRefs: z.array(
      z
        .object({
          path: z.string(),
          symbol: z.string(),
          line: z.number().int().positive().optional(),
        })
        .strict(),
    ),
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
export type Scenario = z.infer<typeof ScenarioSchema>;
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
      .array(
        z
          .object({
            object: z.string(),
            category: z.string(),
            detail: z.string(),
            source: z.string(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type Plan = z.infer<typeof PlanSchema>;
export const DraftSchema = z
  .object({
    run_id: Key,
    request_id: Key,
    plan_version: z.number().int().nonnegative(),
    source_snapshot_hash: z.string(),
    plan: PlanSchema,
  })
  .strict();
export type Draft = z.infer<typeof DraftSchema>;
export type ComparisonStatus =
  "MATCH" | "MISMATCH" | "UNVERIFIABLE" | "NOT_EXECUTED";
export interface AssertionResult {
  assertionId: string;
  scenarioId: string;
  status: ComparisonStatus;
  expected?: Json;
  actual?: Json;
  before?: Json;
  message: string;
  evidenceRef?: string;
}
export interface Approval {
  id: string;
  planVersion: number;
  planHash: string;
  orgId: string;
  username: string;
  scope:
    "prepare" | "execute" | "existing" | "cleanup" | "restore" | "cancel-job";
  at: string;
  actor: string;
  channel: "browser" | "terminal" | "mod";
  detailsHash?: string;
}
export interface RecordBinding {
  key: string;
  object: string;
  id: string;
  ownership: "created" | "existing" | "unresolved";
  runId: string;
  scenarioId: string;
  before?: Record<string, Json>;
  after?: Record<string, Json>;
  lastKnown?: Record<string, Json>;
  deleted?: boolean;
  proof: string;
}
export interface Operation {
  op_id: string;
  scenarioId: string;
  phase: "prepare" | "action" | "cleanup" | "restore";
  planVersion: number;
  requestHash: string;
  state: "NOT_SENT" | "SENDING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
  startedAt: string;
  endedAt?: string;
  request: Json;
  result?: Json;
  jobId?: string;
  error?: string;
}
export interface JobEvidence {
  id: string;
  status: string;
  errors: number;
  processed: number;
  total: number;
  parentJobId?: string;
  done: boolean;
  extendedStatus?: string;
}
export interface ScenarioState {
  errorCode?: string;
  status:
    | "PENDING"
    | "PREPARING"
    | "PREPARED"
    | "PREPARE_FAILED"
    | "BLOCKED"
    | "RUNNING"
    | "WAITING_HUMAN"
    | "WAITING_ASYNC"
    | "EXECUTED"
    | "UNKNOWN"
    | "ERROR";
  message?: string;
  actionResults: Record<string, Json>;
  baseline: Record<string, Record<string, Json>>;
  after: Record<string, Record<string, Json>>;
  jobs: JobEvidence[];
  humanReport?: {
    actor: string;
    at: string;
    executedAt?: string;
    path: string;
    notes: string;
  };
  manualObservations: Record<string, Json>;
  followups?: Record<string, Json[]>;
  timing?: { startedAt: string; completedAt?: string; timedOut?: boolean };
}
export interface Run {
  schemaVersion: 1;
  run_id: string;
  parent_run_id?: string;
  createdAt: string;
  updatedAt: string;
  mode: "fake" | "live";
  target: string;
  sourceRoot: string;
  status: string;
  paused: boolean;
  plan?: Plan;
  planHistory: Plan[];
  source?: SourceSnapshot;
  analysisRequest?: {
    request_id: string;
    plan_version: number;
    source_snapshot_hash: string;
    contextPath: string;
  };
  approvals: Approval[];
  bindings: Record<string, RecordBinding>;
  operations: Operation[];
  scenarios: Record<string, ScenarioState>;
  assertions: AssertionResult[];
  aiNotes: { at: string; text: string; evidenceRefs: string[] }[];
  review?: {
    verdict: "accepted" | "rejected" | "needs-review";
    notes: string;
    actor: string;
    at: string;
  };
  cleanup: {
    decision: "pending" | "keep" | "clean";
    status: "pending" | "kept" | "complete" | "partial" | "needs-review";
    results: { key: string; id: string; success: boolean; error?: string }[];
  };
  sourceCheck?: {
    at: string;
    sourceHash: string;
    matches: boolean;
    files: { path: string; matches: boolean; reason: string }[];
  };
  events: { at: string; type: string; message: string }[];
}

export interface FieldDescribe {
  name: string;
  type: string;
  length?: number;
  precision?: number;
  scale?: number;
  nillable: boolean;
  defaultedOnCreate: boolean;
  createable: boolean;
  updateable: boolean;
  referenceTo?: string[];
  picklistValues?: string[];
  restrictedPicklist?: boolean;
  defaultValue?: Json;
  defaultValueFormula?: string;
  dependentPicklist?: boolean;
  controllerName?: string;
  calculated?: boolean;
}
export interface ObjectDescribe {
  name: string;
  createable: boolean;
  updateable: boolean;
  deletable: boolean;
  fields: FieldDescribe[];
  childRelationships?: {
    childSObject: string;
    field: string;
    cascadeDelete: boolean;
  }[];
  recordTypes?: { id: string; name: string; available: boolean }[];
}
export interface ConstraintInfo {
  object: string;
  category: string;
  detail: string;
  source: string;
}
export interface MutationRequest {
  verb: "insert" | "update" | "delete";
  object: string;
  records: { key: string; id?: string; fields: Record<string, Json> }[];
  allOrNone: boolean;
}
export interface MutationResult {
  results: {
    key: string;
    id?: string;
    success: boolean;
    errors: { code: string; message: string; fields?: string[] }[];
  }[];
  transaction: "single" | "per-record";
  unknown?: boolean;
}
export interface ApexResult {
  recoveryLog?: {
    id: string;
    username: string;
    startedAt: string;
    status: string;
  };
  success: boolean;
  compiled: boolean;
  returnCaptured: boolean;
  returnValue?: Json;
  exception?: { code: string; message: string };
  jobId?: string;
  log?: string;
  unknown?: boolean;
}
export interface SalesforceAdapter {
  readonly mode: "fake" | "live";
  identity(): Promise<OrgIdentity>;
  describe(object: string): Promise<ObjectDescribe>;
  constraints(objects: string[]): Promise<ConstraintInfo[]>;
  deployedSource(
    file: SourceFile,
  ): Promise<{ content: string; apiVersion: string } | null>;
  query(
    query: QuerySpec,
    bindings: Record<string, string>,
  ): Promise<Record<string, Json>[]>;
  read(
    object: string,
    ids: string[],
    fields: string[],
  ): Promise<Record<string, Json>[]>;
  mutate(request: MutationRequest): Promise<MutationResult>;
  executeApex(script: string, correlationId: string): Promise<ApexResult>;
  recoverApex?(correlationId: string, logId: string): Promise<ApexResult>;
  job(id: string): Promise<JobEvidence>;
  relatedRecords(
    binding: RecordBinding,
  ): Promise<{ object: string; id: string; field: string }[]>;
  cancelJob?(id: string): Promise<void>;
}
