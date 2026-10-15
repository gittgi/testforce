import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  SalesforceAdapter,
  OrgIdentity,
  ObjectDescribe,
  ConstraintInfo,
  SourceFile,
  QuerySpec,
  Json,
  MutationRequest,
  MutationResult,
  ApexResult,
  JobEvidence,
  RecordBinding,
} from "../core/model.js";
import {
  AdapterError,
  parseCliJson,
  resolveSfCommand,
  runProcess,
  type ProcessResult,
} from "./process.js";
import {
  assertIdentifier,
  idPattern,
  parseApexResponse,
  parseRecoveredApexLog,
  apexString,
} from "./apex.js";
import { buildSoql, soqlString } from "./query.js";
import { redactSecrets } from "./redact.js";
import { parseEvidenceJson } from "./json.js";
import { isNonProductionOrg } from "../core/org-policy.js";
interface Auth {
  accessToken: string;
  instanceUrl: string;
  username: string;
  id: string;
  apiVersion?: string;
  devHubUsername?: string;
}
type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AdapterError(
      "SF_CONTRACT",
      "Salesforce 응답 객체 형식이 올바르지 않습니다.",
    );
  return value as Obj;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value))
    throw new AdapterError(
      "SF_CONTRACT",
      "Salesforce 응답 배열 형식이 올바르지 않습니다.",
    );
  return value;
};
export interface SfAdapterOptions {
  runner?: (args: string[], cwd?: string) => Promise<ProcessResult>;
  fetcher?: typeof fetch;
  apiVersion?: string;
}
export class SfCliAdapter implements SalesforceAdapter {
  readonly mode = "live" as const;
  #auth?: Auth;
  #version?: string;
  #identityFingerprint?: string;
  #describes = new Map<string, ObjectDescribe>();
  #options: SfAdapterOptions;
  constructor(
    readonly target: string,
    readonly sourceRoot?: string,
    options: SfAdapterOptions = {},
  ) {
    if (!target.trim() || target.includes("\0"))
      throw new AdapterError(
        "TARGET_REQUIRED",
        "명시적인 대상 Org 별칭 또는 사용자 이름이 필요합니다.",
      );
    this.#options = options;
  }
  private async cli(
    args: string[],
    allowFailure = false,
    explicitTarget = this.target,
  ): Promise<Obj> {
    const all = [...args, "--target-org", explicitTarget, "--json"];
    let output: ProcessResult;
    if (this.#options.runner)
      output = await this.#options.runner(all, this.sourceRoot);
    else {
      const command = await resolveSfCommand();
      output = await runProcess(
        command.executable,
        [...command.prefix, ...all],
        {
          cwd: this.sourceRoot,
          timeoutMs: 120000,
          env: { SF_DISABLE_TELEMETRY: "true", SF_AUTOUPDATE_DISABLE: "true" },
        },
      );
    }
    return parseCliJson(output, allowFailure);
  }
  private async authenticate(refresh = false): Promise<void> {
    if (this.#auth && !refresh) return;
    const result = await this.cli(["org", "display"]);
    if (
      typeof result.accessToken !== "string" ||
      typeof result.instanceUrl !== "string" ||
      typeof result.username !== "string" ||
      typeof result.id !== "string"
    )
      throw new AdapterError(
        "AUTH_CONTRACT",
        "SF 인증 응답에 필수 정보가 없습니다.",
      );
    const url = new URL(result.instanceUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/"
    )
      throw new AdapterError(
        "AUTH_URL",
        "인증된 Salesforce HTTPS 주소가 올바르지 않습니다.",
      );
    const auth = {
      accessToken: result.accessToken,
      instanceUrl: url.origin,
      username: result.username,
      id: result.id,
      devHubUsername: typeof result.devHubId === "string" ? result.devHubId : undefined,
      apiVersion:
        typeof result.apiVersion === "string" ? result.apiVersion : undefined,
    };
    if (
      this.#auth &&
      (this.#auth.id !== auth.id || this.#auth.username !== auth.username)
    ) {
      this.#describes.clear();
      this.#version = undefined;
    }
    this.#auth = auth;
    if (!this.#version) {
      const versions = array(
        await this.request("/services/data/", { raw: true }),
      );
      const supported = versions
        .map((v) => obj(v).version)
        .filter(
          (v): v is string => typeof v === "string" && /^\d+\.0$/.test(v),
        );
      let requested = this.#options.apiVersion;
      if (!requested && this.sourceRoot) {
        try {
          const project = JSON.parse(
            await readFile(
              path.join(this.sourceRoot, "sfdx-project.json"),
              "utf8",
            ),
          ) as Obj;
          if (typeof project.sourceApiVersion === "string")
            requested = project.sourceApiVersion;
        } catch {
          /* no configured API version */
        }
      }
      requested ??= auth.apiVersion;
      if (requested && !supported.includes(requested))
        throw new AdapterError(
          "API_VERSION",
          "선택한 API 버전을 대상 Org가 지원하지 않습니다. 프로젝트 설정은 자동 변경하지 않습니다.",
        );
      this.#version =
        requested ?? supported.sort((a, b) => Number(a) - Number(b)).at(-1);
      if (!this.#version)
        throw new AdapterError(
          "API_VERSION",
          "지원 API 버전을 확인하지 못했습니다.",
        );
    }
  }
  private async request(
    resource: string,
    options: { method?: string; body?: unknown; raw?: boolean } = {},
  ): Promise<unknown> {
    if (!this.#auth) await this.authenticate();
    const auth = this.#auth!;
    const relative = options.raw
      ? resource
      : `/services/data/v${this.#version}${resource}`;
    if (
      !relative.startsWith("/services/data/") ||
      relative.split("?")[0]!.includes("..") ||
      relative.startsWith("//")
    )
      throw new AdapterError("API_PATH", "허용되지 않은 API 경로입니다.");
    const method = options.method ?? "GET",
      read = method === "GET";
    for (let attempt = 0; attempt < (read ? 3 : 1); attempt++) {
      try {
        const response = await (this.#options.fetcher ?? fetch)(
          auth.instanceUrl + relative,
          {
            method,
            redirect: "error",
            headers: {
              Authorization: `Bearer ${auth.accessToken}`,
              "Content-Type": "application/json",
            },
            body:
              options.body === undefined
                ? undefined
                : JSON.stringify(options.body),
            signal: AbortSignal.timeout(30000),
          },
        );
        if (
          read &&
          [429, 502, 503, 504].includes(response.status) &&
          attempt < 2
        ) {
          await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
          continue;
        }
        const content = await response.text();
        if (content.length > 25 * 1024 * 1024)
          throw new AdapterError(
            "API_LIMIT",
            "API 응답이 허용 크기를 초과했습니다.",
            false,
            !read,
          );
        let payload: unknown;
        try {
          payload = content ? parseEvidenceJson(content) : null;
        } catch {
          throw new AdapterError(
            "API_JSON",
            "API JSON 응답을 해석할 수 없습니다.",
            false,
            !read,
          );
        }
        if (!response.ok) {
          const first = Array.isArray(payload) ? obj(payload[0] ?? {}) : {};
          const code =
            typeof first.errorCode === "string" ? first.errorCode : "API_ERROR";
          throw new AdapterError(
            code,
            `Salesforce API 요청 실패 (${response.status}, ${code}). 요청 범위와 권한을 확인하세요.`,
            read && response.status >= 500,
            !read && response.status >= 500,
          );
        }
        return payload;
      } catch (error) {
        if (error instanceof AdapterError) throw error;
        if (read && attempt < 2) {
          await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
          continue;
        }
        throw new AdapterError(
          "API_CONNECTION",
          "Salesforce 연결 결과를 확인하지 못했습니다.",
          read,
          !read,
        );
      }
    }
    throw new AdapterError(
      "API_CONNECTION",
      "Salesforce 연결에 실패했습니다.",
      true,
    );
  }
  private async rawQuery(
    soql: string,
    tooling = false,
  ): Promise<Record<string, Json>[]> {
    await this.authenticate();
    let next = `/${tooling ? "tooling/" : ""}query?q=${encodeURIComponent(soql)}`,
      raw = false;
    const rows: Record<string, Json>[] = [];
    let pages = 0;
    while (next) {
      if (++pages > 200)
        throw new AdapterError(
          "PAGE_LIMIT",
          "조회 페이지 제한을 초과했습니다.",
        );
      const response = obj(await this.request(next, { raw }));
      for (const row of array(response.records)) {
        const clean = { ...obj(row) };
        delete clean.attributes;
        rows.push(clean as Record<string, Json>);
      }
      if (response.done === true) break;
      if (
        typeof response.nextRecordsUrl !== "string" ||
        !response.nextRecordsUrl.startsWith(`/services/data/v${this.#version}/`)
      )
        throw new AdapterError(
          "QUERY_PAGE",
          "다음 조회 페이지를 검증하지 못했습니다.",
        );
      next = response.nextRecordsUrl;
      raw = true;
    }
    return rows;
  }
  async identity(): Promise<OrgIdentity> {
    await this.authenticate(true);
    const [org] = await this.rawQuery(
      "SELECT Id, Name, IsSandbox, OrganizationType FROM Organization LIMIT 1",
    );
    if (
      !org ||
      typeof org.Id !== "string" ||
      typeof org.IsSandbox !== "boolean"
    )
      throw new AdapterError(
        "ORG_UNVERIFIED",
        "Organization의 실제 ID와 IsSandbox를 확인하지 못했습니다.",
      );
    if (org.Id.slice(0, 15) !== this.#auth!.id.slice(0, 15))
      throw new AdapterError(
        "ORG_MISMATCH",
        "인증된 Org와 조회한 Org ID가 다릅니다.",
      );
    const fingerprint = JSON.stringify([org.Id, this.#auth!.username]);
    if (this.#identityFingerprint && this.#identityFingerprint !== fingerprint)
      throw new AdapterError(
        "ORG_CHANGED",
        "검증 후 Org 별칭의 실제 대상 또는 인증 사용자가 변경되었습니다. 새 계획으로 확인하세요.",
      );
    this.#identityFingerprint ??= fingerprint;
    let verifiedScratchOrgId: string | undefined;
    if (!org.IsSandbox && this.#auth!.devHubUsername && idPattern.test(org.Id)) {
      try {
        const result = await this.cli([
          "data", "query", "--query",
          `SELECT ScratchOrg, ExpirationDate FROM ActiveScratchOrg WHERE ScratchOrg = '${org.Id.slice(0, 15)}' LIMIT 2`,
        ], false, this.#auth!.devHubUsername);
        const rows = array(result.records).map(obj);
        if (rows.length === 1 && typeof rows[0]!.ScratchOrg === "string" &&
            rows[0]!.ScratchOrg.slice(0, 15) === org.Id.slice(0, 15) &&
            typeof rows[0]!.ExpirationDate === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(rows[0]!.ExpirationDate) &&
            rows[0]!.ExpirationDate >= new Date().toISOString().slice(0, 10)) {
          verifiedScratchOrgId = org.Id;
        }
      } catch {
        // A local scratch flag or Dev Hub alias alone never authorizes writes.
      }
    }
    return {
      mode: "live",
      alias: this.target,
      orgId: org.Id,
      username: this.#auth!.username,
      isSandbox: org.IsSandbox,
      ...(typeof org.OrganizationType === "string" && org.OrganizationType.length
        ? { organizationType: org.OrganizationType } : {}),
      ...(verifiedScratchOrgId ? { verifiedScratchOrgId } : {}),
      name: String(org.Name),
    };
  }
  async describe(object: string): Promise<ObjectDescribe> {
    assertIdentifier(object);
    await this.authenticate();
    const cached = this.#describes.get(object);
    if (cached) return cached;
    const d = obj(await this.request(`/sobjects/${object}/describe`));
    const result: ObjectDescribe = {
      name: String(d.name),
      createable: d.createable === true,
      updateable: d.updateable === true,
      deletable: d.deletable === true,
      fields: array(d.fields).map((value) => {
        const f = obj(value);
        return {
          name: String(f.name),
          type: String(f.type),
          length: typeof f.length === "number" ? f.length : undefined,
          precision: typeof f.precision === "number" ? f.precision : undefined,
          scale: typeof f.scale === "number" ? f.scale : undefined,
          nillable: f.nillable === true,
          defaultedOnCreate: f.defaultedOnCreate === true,
          createable: f.createable === true,
          updateable: f.updateable === true,
          calculated: f.calculated === true,
          restrictedPicklist: f.restrictedPicklist === true,
          defaultValue:
            f.defaultValue === undefined ? undefined : (f.defaultValue as Json),
          defaultValueFormula:
            typeof f.defaultValueFormula === "string"
              ? f.defaultValueFormula
              : undefined,
          dependentPicklist: f.dependentPicklist === true,
          controllerName:
            typeof f.controllerName === "string" ? f.controllerName : undefined,
          referenceTo: Array.isArray(f.referenceTo)
            ? f.referenceTo.map(String)
            : [],
          picklistValues: Array.isArray(f.picklistValues)
            ? f.picklistValues
                .map(obj)
                .filter((x) => x.active === true)
                .map((x) => String(x.value))
            : [],
        };
      }),
      childRelationships: Array.isArray(d.childRelationships)
        ? d.childRelationships
            .map(obj)
            .filter((x) => typeof x.field === "string")
            .map((x) => ({
              childSObject: String(x.childSObject),
              field: String(x.field),
              cascadeDelete: x.cascadeDelete === true,
            }))
        : [],
      recordTypes: Array.isArray(d.recordTypeInfos)
        ? d.recordTypeInfos
            .map(obj)
            .map((x) => ({
              id: String(x.recordTypeId),
              name: String(x.name),
              available: x.available === true,
            }))
        : [],
    };
    this.#describes.set(object, result);
    return result;
  }
  async constraints(objects: string[]): Promise<ConstraintInfo[]> {
    const output: ConstraintInfo[] = [];
    for (const object of objects) {
      const describe = await this.describe(object);
      output.push({
        object,
        category: "API 필드·관계·Record Type",
        detail: JSON.stringify(describe),
        source: "REST sObject Describe",
      });
      const queries: [string, string, boolean][] = [
        [
          "Validation Rule",
          `SELECT Id, ValidationName, Active, ErrorConditionFormula, ErrorMessage FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = ${soqlString(object)}`,
          true,
        ],
        [
          "Trigger",
          `SELECT Name, Body, ApiVersion, Status FROM ApexTrigger WHERE TableEnumOrId = ${soqlString(object)} AND Status = 'Active'`,
          true,
        ],
        [
          "Duplicate Rule",
          `SELECT Id, DeveloperName, SobjectType, IsActive FROM DuplicateRule WHERE SobjectType = ${soqlString(object)}`,
          false,
        ],
      ];
      for (const [category, query, tooling] of queries) {
        try {
          const rows = await this.rawQuery(query, tooling);
          output.push({
            object,
            category,
            detail: JSON.stringify(rows),
            source: tooling ? "Tooling API" : "REST query",
          });
        } catch (error) {
          output.push({
            object,
            category,
            detail: `조회 실패: ${error instanceof AdapterError ? error.code : "CONNECTION"}. 준비 오류를 해결하기 위해 해당 규칙을 개발자가 확인해야 합니다.`,
            source: tooling ? "Tooling API" : "REST query",
          });
        }
      }
      output.push({
        object,
        category: "화면 입력 제약",
        detail:
          "Describe는 API 저장 제약입니다. 화면 레이아웃 필수값·컴포넌트 검증은 수동 화면 경로에서 별도로 검토하세요.",
        source: "실행 경로 안내",
      });
    }
    try {
      const definitions = await this.rawQuery(
        "SELECT Id, DeveloperName, ActiveVersionId FROM FlowDefinition WHERE ActiveVersionId != null",
        true,
      );
      if (definitions.length > 100)
        output.push({
          object: "*",
          category: "Flow",
          detail: `활성 Flow ${definitions.length}개 중 첫 100개만 메타데이터를 조회합니다. 나머지 Flow의 영향은 별도 검토가 필요합니다.`,
          source: "Tooling API",
        });
      for (const def of definitions.slice(0, 100)) {
        const id = String(def.ActiveVersionId);
        if (!idPattern.test(id)) continue;
        const rows = await this.rawQuery(
          `SELECT Metadata FROM Flow WHERE Id = ${soqlString(id)}`,
          true,
        );
        const metadata = rows[0]?.Metadata;
        const serialized = JSON.stringify(metadata);
        for (const object of objects)
          if (serialized.includes(`"${object}"`))
            output.push({
              object,
              category: "Flow 조건",
              detail: JSON.stringify({ name: def.DeveloperName, metadata }),
              source: "Tooling API Flow Metadata",
            });
      }
    } catch (error) {
      output.push({
        object: "*",
        category: "Flow",
        detail: `활성 Flow 메타데이터 조회 실패: ${error instanceof AdapterError ? error.code : "CONNECTION"}. 관련 Flow 조건을 별도 검토하세요.`,
        source: "Tooling API",
      });
    }
    return output;
  }
  async deployedSource(
    file: SourceFile,
  ): Promise<{ content: string; apiVersion: string } | null> {
    assertIdentifier(file.name);
    const rows = await this.rawQuery(
      `SELECT Name, Body, ApiVersion FROM ${file.kind === "class" ? "ApexClass" : "ApexTrigger"} WHERE Name = ${soqlString(file.name)} AND NamespacePrefix = null`,
      true,
    );
    if (rows.length === 0) return null;
    if (rows.length !== 1 || typeof rows[0]!.Body !== "string")
      throw new AdapterError(
        "SOURCE_UNAVAILABLE",
        "배포본 소스를 읽을 수 없습니다.",
      );
    return {
      content: rows[0]!.Body,
      apiVersion: Number.isFinite(Number(rows[0]!.ApiVersion))
        ? Number(rows[0]!.ApiVersion).toFixed(1)
        : String(rows[0]!.ApiVersion),
    };
  }
  async query(
    query: QuerySpec,
    bindings: Record<string, string>,
  ): Promise<Record<string, Json>[]> {
    return this.rawQuery(
      buildSoql(query, await this.describe(query.object), bindings),
    );
  }
  async read(
    object: string,
    ids: string[],
    fields: string[],
  ): Promise<Record<string, Json>[]> {
    if (!ids.length) return [];
    if (ids.some((id) => !idPattern.test(id)))
      throw new AdapterError(
        "INVALID_ID",
        "Salesforce ID 형식이 올바르지 않습니다.",
      );
    const out: Record<string, Json>[] = [];
    for (let i = 0; i < ids.length; i += 200)
      out.push(
        ...(await this.query(
          {
            object,
            fields: [...new Set(["Id", ...fields])],
            where: [
              {
                field: "Id",
                op: "in",
                value: { kind: "value", value: ids.slice(i, i + 200) },
              },
            ],
            limit: 50000,
          },
          {},
        )),
      );
    return out;
  }
  async mutate(request: MutationRequest): Promise<MutationResult> {
    const identity = await this.identity();
    if (!isNonProductionOrg(identity))
      throw new AdapterError(
        "NON_PRODUCTION_REQUIRED",
        "Production 또는 유형 미확인 Org에는 쓸 수 없습니다. Sandbox, Developer Edition, 확인된 Scratch Org만 허용합니다.",
      );
    assertIdentifier(request.object);
    if (!request.records.length || request.records.length > 200)
      throw new AdapterError(
        "TRANSACTION_SIZE",
        "단일 sObject Collection 요청은 1~200개입니다. 여러 요청을 한 트랜잭션으로 처리하지 않습니다.",
      );
    const schema = await this.describe(request.object);
    if (
      request.verb === "insert"
        ? !schema.createable
        : request.verb === "update"
          ? !schema.updateable
          : !schema.deletable
    )
      throw new AdapterError(
        "OBJECT_PERMISSION",
        "선택한 오브젝트 동작 권한이 없습니다.",
      );
    const fields = new Map(schema.fields.map((f) => [f.name, f]));
    for (const record of request.records) {
      if (
        request.verb !== "insert" &&
        (!record.id || !idPattern.test(record.id))
      )
        throw new AdapterError("INVALID_ID", "수정·삭제할 실제 ID가 없습니다.");
      for (const name of Object.keys(record.fields)) {
        assertIdentifier(name);
        const f = fields.get(name);
        if (
          !f ||
          (request.verb === "insert" ? !f.createable : !f.updateable) ||
          f.calculated
        )
          throw new AdapterError(
            "FIELD_PERMISSION",
            `쓰기 가능한 필드가 아닙니다: ${name}`,
          );
      }
    }
    const resource =
      request.verb === "delete"
        ? `/composite/sobjects?ids=${request.records.map((r) => r.id).join(",")}&allOrNone=${request.allOrNone}`
        : "/composite/sobjects";
    const body =
      request.verb === "delete"
        ? undefined
        : {
            allOrNone: request.allOrNone,
            records: request.records.map((r) => ({
              attributes: { type: request.object },
              ...r.fields,
              ...(request.verb === "update" ? { Id: r.id } : {}),
            })),
          };
    const response = array(
      await this.request(resource, {
        method:
          request.verb === "insert"
            ? "POST"
            : request.verb === "update"
              ? "PATCH"
              : "DELETE",
        body,
      }),
    );
    if (response.length !== request.records.length)
      throw new AdapterError(
        "DML_CONTRACT",
        "레코드별 결과 수가 요청과 다릅니다. 실제 ID를 확인해야 합니다.",
        false,
        true,
      );
    return {
      transaction: "single",
      results: response.map((value, i) => {
        const r = obj(value);
        if (typeof r.success !== "boolean" || !Array.isArray(r.errors))
          throw new AdapterError(
            "DML_CONTRACT",
            "레코드별 응답을 해석하지 못했습니다.",
            false,
            true,
          );
        const id = typeof r.id === "string" ? r.id : request.records[i]!.id;
        if (
          (r.success && (!id || !idPattern.test(id) || r.errors.length > 0)) ||
          (!r.success && r.errors.length === 0) ||
          (request.verb !== "insert" &&
            typeof r.id === "string" &&
            r.id.slice(0, 15) !== request.records[i]!.id!.slice(0, 15))
        )
          throw new AdapterError(
            "DML_CONTRACT",
            "실제 ID 또는 레코드별 성공·오류 응답이 일치하지 않습니다.",
            false,
            true,
          );
        return {
          key: request.records[i]!.key,
          id,
          success: r.success,
          errors: r.errors
            .map(obj)
            .map((e) => ({
              code: String(e.statusCode ?? e.errorCode ?? "UNKNOWN"),
              message: redactSecrets(String(e.message ?? "상세 오류 없음"), [
                this.#auth!.accessToken,
              ]),
              fields: Array.isArray(e.fields)
                ? e.fields.map(String)
                : undefined,
            })),
        };
      }),
    };
  }
  async executeApex(
    script: string,
    correlationId: string,
  ): Promise<ApexResult> {
    if (!isNonProductionOrg(await this.identity()))
      throw new AdapterError(
        "NON_PRODUCTION_REQUIRED",
        "Production 또는 유형 미확인 Org에서는 Apex를 실행할 수 없습니다.",
      );
    const dir = await mkdtemp(path.join(os.tmpdir(), "sftw-apex-"));
    try {
      const file = path.join(dir, "approved.apex");
      await writeFile(file, script, { encoding: "utf8", mode: 0o600 });
      const result = await this.cli(
        ["apex", "run", "--file", file, "--api-version", this.#version!],
        true,
        this.#auth!.username,
      );
      return redactSecrets(parseApexResponse(result, correlationId), [
        this.#auth!.accessToken,
      ]);
    } catch (error) {
      if (
        error instanceof AdapterError &&
        [
          "PROCESS_TIMEOUT",
          "SF_JSON",
          "SF_CONTRACT",
          "SF_COMMAND_FAILED",
        ].includes(error.code)
      )
        error.unknown = true;
      throw error;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  async recoverApex(correlationId: string, logId: string): Promise<ApexResult> {
    if (!idPattern.test(logId))
      throw new AdapterError(
        "INVALID_ID",
        "기존 Apex Log ID가 올바르지 않습니다.",
      );
    const identity = await this.identity();
    const [metadata] = await this.rawQuery(
      `SELECT Id, LogUser.Username, StartTime, Status FROM ApexLog WHERE Id = ${soqlString(logId)}`,
      true,
    );
    const user = metadata?.LogUser;
    if (
      !metadata ||
      !user ||
      typeof user !== "object" ||
      Array.isArray(user) ||
      typeof user.Username !== "string" ||
      typeof metadata.StartTime !== "string" ||
      !Number.isFinite(Date.parse(metadata.StartTime)) ||
      typeof metadata.Status !== "string" ||
      metadata.Id !== logId
    )
      throw new AdapterError(
        "APEX_LOG_METADATA",
        "기존 로그의 실행 사용자·시각·상태를 확인하지 못했습니다.",
      );
    if (user.Username !== identity.username)
      throw new AdapterError(
        "APEX_LOG_USER",
        "기존 로그의 실행 사용자가 승인한 인증 사용자와 다릅니다.",
      );
    const result = array(
      await this.cli(
        [
          "apex",
          "get",
          "log",
          "--log-id",
          logId,
          "--api-version",
          this.#version!,
        ],
        false,
        this.#auth!.username,
      ),
    );
    if (result.length !== 1 || typeof obj(result[0]).log !== "string")
      throw new AdapterError(
        "APEX_LOG_CONTRACT",
        "명시한 기존 로그 한 개를 확인하지 못했습니다.",
      );
    return redactSecrets(
      parseRecoveredApexLog(String(obj(result[0]).log), correlationId, {
        id: logId,
        username: user.Username,
        startedAt: metadata.StartTime,
        status: metadata.Status,
      }),
      [this.#auth!.accessToken],
    );
  }
  async job(id: string): Promise<JobEvidence> {
    if (!idPattern.test(id))
      throw new AdapterError("INVALID_ID", "Job ID가 올바르지 않습니다.");
    const [row] = await this.rawQuery(
      `SELECT Id, Status, NumberOfErrors, JobItemsProcessed, TotalJobItems, ParentJobId, ExtendedStatus FROM AsyncApexJob WHERE Id = ${soqlString(id)}`,
    );
    if (!row)
      throw new AdapterError("JOB_NOT_FOUND", "Job 정보를 확인할 수 없습니다.");
    return {
      id,
      status: String(row.Status),
      errors: Number(row.NumberOfErrors),
      processed: Number(row.JobItemsProcessed),
      total: Number(row.TotalJobItems),
      parentJobId:
        typeof row.ParentJobId === "string" ? row.ParentJobId : undefined,
      done: ["Completed", "Aborted", "Failed"].includes(String(row.Status)),
      extendedStatus:
        typeof row.ExtendedStatus === "string" ? row.ExtendedStatus : undefined,
    };
  }
  async relatedRecords(
    binding: RecordBinding,
  ): Promise<{ object: string; id: string; field: string }[]> {
    const schema = await this.describe(binding.object),
      result: { object: string; id: string; field: string }[] = [];
    for (const relationship of schema.childRelationships ?? []) {
      const rows = await this.query(
        {
          object: relationship.childSObject,
          fields: ["Id"],
          where: [
            {
              field: relationship.field,
              op: "eq",
              value: { kind: "value", value: binding.id },
            },
          ],
          limit: 50000,
        },
        {},
      );
      for (const row of rows)
        result.push({
          object: relationship.childSObject,
          id: String(row.Id),
          field: relationship.field,
        });
    }
    return result;
  }
  async cancelJob(id: string): Promise<void> {
    if (!idPattern.test(id))
      throw new AdapterError("INVALID_ID", "Job ID가 올바르지 않습니다.");
    const result = await this.executeApex(
      `System.abortJob(${apexString(id)});`,
      "cancel-job",
    );
    if (!result.success)
      throw new AdapterError(
        "CANCEL_FAILED",
        result.exception?.message ?? "Job 취소 실패",
      );
  }
}
