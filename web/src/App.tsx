import { useCallback, useEffect, useState, type ReactNode } from "react";
import type {
  Assertion,
  InputValue,
  Plan,
  RecordSpec,
  Run,
  Scenario,
} from "../../src/core/model";
import { api, ApiError, bootstrap, fileBase64 } from "./api";
import { ScenarioResultTables, ValueContent } from "./components/ResultTables";
import { PlanReviewTables, ScenarioPlanDetails, operatorLabels } from "./components/PlanReview";
import { orgEnvironmentLabel } from "../../src/core/org-policy";
import {
  ScenarioSchema,
  RecordSpecSchema,
  AssertionSchema,
} from "../../src/core/model";

type Extra = Record<string, unknown>;
const modes: Record<Scenario["execution"], string> = {
  tool: "도구 실행",
  "human-ui": "사람 · 화면 입력",
  "human-import": "사람 · Data Loader",
  "human-apex": "사람 · Anonymous Apex",
};
const statuses: Record<string, string> = {
  MATCH: "✓ 일치",
  MISMATCH: "≠ 불일치",
  UNVERIFIABLE: "? 확인 불가",
  NOT_EXECUTED: "– 미실행",
  PENDING: "대기",
  PREPARING: "준비 중",
  PREPARED: "준비 완료",
  PREPARE_FAILED: "준비 실패",
  BLOCKED: "의존 작업 대기",
  RUNNING: "실행 중",
  WAITING_HUMAN: "사람 실행 대기",
  WAITING_ASYNC: "비동기 완료 대기",
  EXECUTED: "실행됨",
  UNKNOWN: "결과 불명",
  ERROR: "실행 오류",
  SUCCEEDED: "성공 확인",
  FAILED: "실패 확인",
  SENDING: "전달 중",
  NOT_SENT: "미전달",
  ANALYSIS_PENDING: "Claude Code 분석 대기",
  DRAFT: "계획 검토",
  APPROVED: "승인됨",
  PAUSED: "중단됨",
  COMPLETE: "관찰 완료",
};
const copy = <T,>(v: T): T => structuredClone(v);
const display = (v: unknown) =>
  typeof v === "string" ? v : (JSON.stringify(v, null, 2) ?? "없음");
const short = (v: string | undefined) => v?.slice(0, 10) ?? "—";
const stamp = (v: string) => new Date(v).toLocaleString("ko-KR");
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>
      {statuses[status] ?? status}
    </span>
  );
}
function Panel({
  title,
  children,
  aside,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
function JsonView({ value }: { value: unknown }) {
  return <pre className="json-view">{display(value)}</pre>;
}
function JsonEditor({
  label,
  value,
  onSave,
}: {
  label: string;
  value: unknown;
  onSave: (value: unknown) => void;
}) {
  const [text, setText] = useState(display(value)),
    [error, setError] = useState("");
  const signature = display(value);
  useEffect(() => setText(signature), [signature]);
  return (
    <details className="advanced">
      <summary>{label}</summary>
      <textarea
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        spellCheck={false}
      />
      <button
        className="small"
        onClick={() => {
          try {
            onSave(JSON.parse(text));
            setError("");
          } catch {
            setError("올바른 JSON 형식으로 입력해 주세요.");
          }
        }}
      >
        편집본에 반영
      </button>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </details>
  );
}
function ValueEditor({
  value,
  onChange,
  label,
}: {
  value: InputValue;
  onChange: (v: InputValue) => void;
  label: string;
}) {
  const type =
    value.kind === "value"
      ? typeof value.value === "boolean"
        ? "boolean"
        : typeof value.value === "number"
          ? "number"
          : typeof value.value === "object"
            ? "json"
            : "string"
      : value.kind;
  const [raw, setRaw] = useState(
    value.kind === "ref"
      ? value.key
      : value.kind === "value"
        ? display(value.value)
        : "",
  );
  const [invalid, setInvalid] = useState(false);
  const signature = JSON.stringify(value);
  useEffect(() => {
    setRaw(
      value.kind === "ref"
        ? value.key
        : value.kind === "value"
          ? display(value.value)
          : "",
    );
    setInvalid(false);
  }, [signature]);
  function commit(text: string) {
    try {
      const next: InputValue =
        type === "ref"
          ? { kind: "ref", key: text }
          : type === "number"
            ? { kind: "value", value: Number(text) }
            : type === "boolean"
              ? { kind: "value", value: text === "true" }
              : type === "json"
                ? { kind: "value", value: JSON.parse(text) }
                : { kind: "value", value: text };
      if (type === "number" && (!text.trim() || !Number.isFinite(Number(text))))
        throw Error();
      if (JSON.stringify(next) !== signature) onChange(next);
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  }
  return (
    <div className="value-editor">
      <select
        aria-label={`${label} 입력 의미`}
        value={type}
        onChange={(e) => {
          const t = e.target.value;
          onChange(
            t === "null" || t === "omit"
              ? { kind: t }
              : t === "ref"
                ? { kind: "ref", key: "" }
                : t === "number"
                  ? { kind: "value", value: 0 }
                  : t === "boolean"
                    ? { kind: "value", value: false }
                    : t === "json"
                      ? { kind: "value", value: {} }
                      : { kind: "value", value: "" },
          );
        }}
      >
        <option value="string">문자열</option>
        <option value="number">숫자</option>
        <option value="boolean">참/거짓</option>
        <option value="json">구조화 값</option>
        <option value="ref">레코드 참조</option>
        <option value="null">값 지우기 (null)</option>
        <option value="omit">필드 생략</option>
      </select>
      {type === "boolean" ? (
        <select
          aria-label={label}
          value={raw}
          onChange={(e) => commit(e.target.value)}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : type !== "null" && type !== "omit" ? (
        <textarea
          aria-label={label}
          rows={1}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={() => commit(raw)}
          spellCheck={false}
          aria-invalid={invalid}
        />
      ) : (
        <span className="muted">
          {type === "null" ? "저장된 값을 비웁니다" : "전송하지 않습니다"}
        </span>
      )}
      {invalid && <span className="error-text">형식을 확인하세요.</span>}
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false),
    [runs, setRuns] = useState<Run[]>([]),
    [run, setRun] = useState<Run>(),
    [draft, setDraft] = useState<Plan>(),
    [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState(() => sessionStorage.getItem("sftw-tab") || "scenarios"),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [actor, setActor] = useState(""),
    [selection, setSelection] = useState(""),
    [extra, setExtra] = useState<Extra>({}),
    [cleanupPreview, setCleanupPreview] = useState<Extra>();
  const [excelPreview, setExcelPreview] = useState<Extra>(),
    [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [reviewed, setReviewed] = useState(false),
    [approvalScope, setApprovalScope] = useState("execute");
  const [cleanupReviewed, setCleanupReviewed] = useState(false);
  const [resultFilter, setResultFilter] = useState("all");
  const [newSource, setNewSource] = useState(""),
    [newTarget, setNewTarget] = useState(""),
    [newMode, setNewMode] = useState("fake");
  const [humanScenario, setHumanScenario] = useState(""),
    [humanNotes, setHumanNotes] = useState(""),
    [humanExecutedAt, setHumanExecutedAt] = useState(""),
    [humanBindings, setHumanBindings] = useState(""),
    [manualValues, setManualValues] = useState("{}");
  const [manualBundleId, setManualBundleId] = useState(""),
    [manualLogs, setManualLogs] = useState("");
  const [reviewNotes, setReviewNotes] = useState(""),
    [reviewVerdict, setReviewVerdict] = useState("needs-review");
  const [importPhase, setImportPhase] = useState("fixture"),
    [bundleId, setBundleId] = useState(""),
    [importScenario, setImportScenario] = useState(""),
    [mappingText, setMappingText] = useState("");
  const [candidates, setCandidates] = useState<
    { path: string; name: string; methods: string[]; matches: string[] }[]
  >([]);
  const [candidatePaths, setCandidatePaths] = useState<string[]>([]);
  const [aiText, setAiText] = useState(""),
    [analysisNote, setAnalysisNote] = useState("");
  const sync = useCallback(
    (r: Run, force = false) => {
      setRun(r);
      sessionStorage.setItem("sftw-run", r.run_id);
      if (force || !dirty) {
        setDraft(r.plan ? copy(r.plan) : undefined);
        setDirty(false);
      }
    },
    [dirty],
  );
  const loadList = useCallback(async () => {
    const r = await api<{ runs: Run[] }>("/api/runs");
    setRuns(r.runs);
    return r.runs;
  }, []);
  const act = useCallback(
    async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(label);
      setError("");
      setNotice("");
      try {
        return await fn();
      } catch (e) {
        const x = e as Error;
        if (
          e instanceof ApiError &&
          Array.isArray(e.details) &&
          e.details.every(
            (item) =>
              item && typeof item === "object" && typeof item.path === "string",
          )
        ) {
          setCandidates(
            e.details as {
              path: string;
              name: string;
              methods: string[];
              matches: string[];
            }[],
          );
          setCandidatePaths([]);
        }
        setError(
          e instanceof ApiError
            ? `${e.code}: ${e.message}${e.action ? " " + e.action : ""}`
            : x.message,
        );
        return undefined;
      } finally {
        setBusy("");
      }
    },
    [],
  );
  useEffect(() => {
    void act("연결 확인", async () => {
      await bootstrap();
      const list = await loadList();
      setReady(true);
      const remembered = sessionStorage.getItem("sftw-run");
      const chosen = list.find((r) => r.run_id === remembered) ?? list[0];
      if (chosen) {
        const full = await api<Run>(`/api/runs/${chosen.run_id}`);
        setRun(full);
        setDraft(full.plan ? copy(full.plan) : undefined);
      }
    });
  }, [act, loadList]);
  useEffect(() => {
    if (!run) return;
    const id = setInterval(() => {
      if (!busy)
        void api<Run>(`/api/runs/${run.run_id}`)
          .then((r) => sync(r))
          .catch(() => {});
    }, 2500);
    return () => clearInterval(id);
  }, [run?.run_id, busy, sync]);
  useEffect(() => {
    setReviewed(false);
    setCleanupPreview(undefined);
    setCleanupReviewed(false);
  }, [run?.run_id, run?.plan?.hash, dirty]);
  useEffect(() => { sessionStorage.setItem("sftw-tab", tab); }, [tab]);
  async function selectRun(id: string) {
    if (busy) return;
    if (
      dirty &&
      !confirm("저장하지 않은 편집본을 버리고 다른 실행을 여시겠습니까?")
    )
      return;
    await act("실행 열기", async () => {
      const r = await api<Run>(`/api/runs/${id}`);
      sync(r, true);
      sessionStorage.setItem("sftw-run", id);
      setExtra({});
      setExcelPreview(undefined);
      setTab(r.assertions.length ? "execute" : "scenarios");
    });
  }
  async function command(
    command: string,
    payload: Extra = {},
    label = command,
  ) {
    if (!run) return;
    return act(label, async () => {
      if (command === "analyze") setCandidates([]);
      const response = await api<Run | Extra>(
        `/api/runs/${run.run_id}/command`,
        {
          command,
          version:
            command === "edit"
              ? (payload.plan as Plan).version
              : (run.plan?.version ?? 0),
          hash:
            command === "edit"
              ? (payload.plan as Plan).hash
              : (run.plan?.hash ?? ""),
          ...(["approve", "cleanup-approve", "review", "restore-approve", "cancel-approve", "confirm-ownership"].includes(command) ? { actor: "로컬 브라우저 사용자" } : {}),
          ...payload,
        },
      );
      const data = response as Extra;
      if (
        command === "manual-instructions" &&
        typeof data.bundleId === "string"
      )
        setManualBundleId(data.bundleId);
      const resultRun = (data.run ?? (data.run_id ? response : undefined)) as
        Run | undefined;
      if (resultRun)
        sync(
          resultRun,
          command === "edit" ||
            command === "excel-apply" ||
            command === "rerun",
        );
      else sync(await api<Run>(`/api/runs/${run.run_id}`));
      setExtra(
        Object.fromEntries(
          Object.entries(data).filter(([key]) => key !== "run"),
        ),
      );
      await loadList();
      setNotice(`${label} 요청이 처리되었습니다.`);
      return data;
    });
  }
  async function requestPause() {
    if (!run) return;
    try {
      const response = await api<{ run: Run }>(
        `/api/runs/${run.run_id}/command`,
        {
          command: "pause",
          version: run.plan?.version ?? 0,
          hash: run.plan?.hash ?? "",
        },
      );
      sync(response.run);
      setNotice(
        "로컬 중단을 요청했습니다. 이미 전달된 Org 작업은 취소하지 않습니다.",
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "중단 요청을 전달하지 못했습니다.",
      );
    }
  }
  function change(fn: (p: Plan) => void) {
    if (!draft) return;
    const d = copy(draft);
    fn(d);
    setDraft(d);
    setDirty(true);
  }
  async function demo() {
    await act("오프라인 예제 생성", async () => {
      const r = await api<Run>("/api/demo", {});
      sync(r, true);
      await loadList();
      setTab("scenarios");
      setNotice(
        "명시적인 오프라인 예제입니다. 실제 Salesforce Org에 연결하지 않습니다.",
      );
    });
  }
  async function newRun() {
    await act("새 실행 생성", async () => {
      const r = await api<Run>("/api/runs", {
        mode: newMode,
        target: newTarget,
        sourceRoot: newSource,
        selection,
      });
      sync(r, true);
      await loadList();
      setNotice("Claude Code에서 분석 컨텍스트를 읽고 계획을 제출해 주세요.");
    });
  }
  function newScenario() {
    change((p) => {
      const id = `scenario-${crypto.randomUUID().slice(0, 8)}`;
      p.scenarios.push(
        ScenarioSchema.parse({
          id,
          title: "새 시나리오",
          purpose: "",
          rationale:
            "개발자 직접 추가 — Claude Code에서 동작과 기대값 구체화 필요",
          sourceRefs: [],
          selected: false,
          execution: "tool",
          dependsOn: [],
          preconditions: [],
          actions: [],
          observation: {
            pollMs: 1000,
            timeoutMs: 60000,
            durationRequirement: false,
            followupQueries: [],
          },
        }),
      );
    });
  }
  const p = draft,
    approved =
      run?.approvals.some(
        (a) =>
          a.planHash === run.plan?.hash &&
          (a.scope === "execute" || a.scope === "prepare"),
      ) && !dirty;
  const selected = p?.scenarios.filter((s) => s.selected) ?? [],
    completed = Object.values(run?.scenarios ?? {}).filter(
      (s) => s.status === "EXECUTED",
    ).length;
  const executeApproved = !dirty && !!run?.approvals.some(a => a.planHash === run.plan?.hash && a.scope === "execute");
  const existingApproved = !p?.policies.existingMutation || !!run?.approvals.some(a => a.planHash === run.plan?.hash && a.scope === "existing");
  const states = selected.map(s => run?.scenarios[s.id]?.status ?? "PENDING");
  const readyTool = selected.some(s => s.execution === "tool" && run?.scenarios[s.id]?.status === "PREPARED" && s.dependsOn.every(id => run?.scenarios[id]?.status === "EXECUTED"));
  const needsPreparation = selected.some(s => ["PENDING", "BLOCKED"].includes(run?.scenarios[s.id]?.status ?? "PENDING") && s.dependsOn.every(id => ["PREPARED", "EXECUTED", "WAITING_HUMAN"].includes(run?.scenarios[id]?.status ?? "PENDING")));
  const waitingAsync = states.includes("WAITING_ASYNC");
  const waitingHuman = states.includes("WAITING_HUMAN");
  const hasUnknown = !!run?.operations.some(o => ["UNKNOWN", "SENDING"].includes(o.state));
  const hasComparison = !!run?.assertions.length;
  const needsCollection = !hasComparison || run?.status === "실행 결과 수집 대기" || selected.some(s => ["EXECUTED", "ERROR"].includes(run?.scenarios[s.id]?.status ?? "") && (!run?.assertions.some(a => a.scenarioId === s.id) || run.assertions.some(a => a.scenarioId === s.id && a.status === "NOT_EXECUTED")));
  const nextAction = !p || dirty || !approved || !existingApproved ? "plan"
    : run?.paused ? "resume" : hasUnknown ? "reconcile"
    : readyTool ? (executeApproved ? "execute" : "plan")
    : needsPreparation ? "prepare" : waitingAsync ? "observe" : waitingHuman ? "human"
    : states.some(x => ["PREPARE_FAILED", "BLOCKED"].includes(x)) ? "repair"
    : needsCollection ? "collect" : run?.review ? "reports" : "review";
  const nextCopy: Record<string, [string, string]> = {
    plan: ["테스트 계획을 확인해 주세요", dirty ? "편집한 내용을 저장한 뒤, 변경된 계획을 승인하세요." : approved && !executeApproved ? "지금은 준비까지만 승인되어 있습니다. 도구 실행을 하려면 승인 범위를 변경하세요." : "선택한 시나리오와 데이터를 확인하고 승인하면 시작할 수 있어요."],
    prepare: ["테스트할 데이터를 준비할 차례예요", "준비에 필요한 레코드만 만들고, 실제 저장된 값을 다시 읽습니다."],
    execute: ["준비 완료. 테스트를 실행할 수 있어요", "이미 승인한 동작을 실행합니다. 추가 승인은 필요하지 않아요."],
    observe: ["Salesforce 비동기 작업을 기다리고 있어요", "Job 완료와 필요한 후속 처리를 관찰한 뒤 결과를 비교하세요."],
    human: ["Salesforce에서 직접 실행할 차례예요", "아래 안내대로 실행한 후 완료를 알려 주세요. 실제 데이터는 다시 조회합니다."],
    collect: ["실제 결과를 비교해 보세요", "Org에서 실행 후 값을 조회하고, 승인한 기대값과 비교합니다."],
    repair: ["준비 오류를 확인해 주세요", "아래 오류를 Claude Code에 전달해 계획을 수정할 수 있어요. 실패한 준비를 자동 반복하지 않습니다."],
    reports: ["결과를 저장하고 마무리할 차례예요", "보고서를 내려받고, 테스트 데이터를 보존할지 정리할지 선택하세요."],
    review: ["비교 결과를 확인해 주세요", "아래 표를 확인한 뒤 최종 판정을 남기고 보고서를 저장하세요."],
    resume: ["실행이 일시 중단되어 있어요", "중단 지점부터 이어갑니다. 이미 전달된 쓰기를 자동으로 반복하지 않습니다."],
    reconcile: ["실행 결과를 먼저 확인해야 해요", "결과 불명 작업을 아래에서 조정하세요. 같은 동작을 다시 보내지 않습니다."],
  };
  const changes = p && run?.plan ? planChanges(run.plan, p) : [];
  const download = (name: string) =>
    `/api/runs/${run?.run_id}/files/${encodeURIComponent(name)}`;
  const locked = !!busy || !ready;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-icon">tƒ</span>
          <span>
            Testforce<span className="brand-sub">SALESFORCE TESTING</span>
          </span>
        </a>
        <div className="workspace-label">로컬 워크스페이스</div>
        {runs.length > 0 && <label className="run-switcher">현재 테스트<select aria-label="현재 테스트" disabled={locked} value={run?.run_id ?? ""} onChange={e => void selectRun(e.target.value)}>{runs.map(r => <option value={r.run_id} key={r.run_id}>{r.plan?.source.selection ?? r.source?.selection ?? r.target} · {short(r.run_id)}</option>)}</select></label>}
        <nav aria-label="작업 단계">
          {[
            ["scenarios", "01", "테스트 계획"],
            ["inputs", "02", "데이터 편집"],
            ["execute", "03", "실행 결과"],
            ["artifacts", "04", "보고서 · 정리"],
            ["history", "↺", "실행 기록"],
          ].map(([id, n, label]) => (
            <button
              key={id}
              className={tab === id ? "nav-item active" : "nav-item"}
              aria-current={tab === id ? "step" : undefined}
              onClick={() => setTab(id)}
            >
              <span>{n}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="local-dot" />내 컴퓨터에서 실행
          <p>AI 분석은 현재 Claude Code 세션에서 진행합니다.</p>
          <button
            className="outline"
            disabled={locked}
            onClick={() => void demo()}
          >
            오프라인 예제 열기
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className={`env-pill ${run?.mode === "live" ? "live" : ""}`}>
              {orgEnvironmentLabel(run?.plan?.org)}
            </span>
            <strong>{run?.plan?.org.name ?? "테스트 워크벤치"}</strong>
            <span className="identity">
              {run?.plan?.org.username ?? "사용자·Org 확인 대기"}
            </span>
          </div>
          <div className="topbar-meta">
            <span>
              실행 <code title={run?.run_id}>{short(run?.run_id)}</code>
            </span>
            <span>계획 v{run?.plan?.version ?? "—"}</span>
            <span className={approved ? "approved" : "approval-wait"}>
              {approved
                ? "✓ 승인됨"
                : dirty
                  ? "편집 중 · 재승인 필요"
                  : "승인 대기"}
            </span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">SALESFORCE TESTFORCE</p>
              <h1>
                {tab === "scenarios"
                  ? "무엇을 테스트할까요?"
                  : tab === "inputs"
                    ? "데이터와 기대값 편집"
                    : tab === "execute"
                      ? "무엇이 달라졌나요?"
                      : tab === "artifacts"
                        ? "보고서와 데이터 정리"
                        : "테스트의 기록"}
              </h1>
              <p className="lead">
                {tab === "scenarios"
                  ? "Claude가 만든 테스트 계획을 확인하고, 한 번 승인하면 준비를 시작할 수 있어요."
                  : tab === "inputs"
                    ? "준비 데이터와 테스트 동작을 구분합니다. 변경을 저장하면 이전 승인은 해제됩니다."
                    : tab === "execute"
                      ? "실행 전·후 값을 나란히 보고, 기대한 결과와 비교하세요."
                      : tab === "artifacts"
                        ? "입력 계획, 실행 직전 상태, 실행 후 상태를 구분해 보관합니다."
                        : "이전 실행을 이어가거나, 새 실행 ID로 다시 테스트할 수 있습니다."}
              </p>
            </div>
            <button
              disabled={locked}
              className="quiet"
              onClick={() =>
                void act("새로고침", async () => {
                  await loadList();
                  if (run) sync(await api<Run>(`/api/runs/${run.run_id}`));
                })
              }
            >
              ↻ 새로고침
            </button>
          </div>
          {error && (
            <div className="alert error" role="alert">
              <strong>요청을 완료하지 못했습니다.</strong>
              <div>{error}</div>
              <button className="quiet" onClick={() => setError("")}>
                닫기
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              {notice}
            </div>
          )}
          {busy && (
            <div className="activity" role="status">
              <span className="spinner" />
              {busy} 처리 중…
            </div>
          )}
          {!ready && (
            <Panel title="로컬 세션에 연결">
              <p>
                서버를 시작한 터미널의 브라우저 링크를 열어 주세요. 로컬 접근
                토큰이 필요합니다.
              </p>
              <code>npm start -- --workspace &quot;프로젝트 경로&quot;</code>
            </Panel>
          )}
          {dirty && (
            <div className="edit-banner">
              <div>
                <strong>저장하지 않은 계획 변경 {changes.length}건</strong>
                <p>
                  이 편집본은 실행 권한이 없습니다. 변경을 저장한 뒤 다시
                  검토하고 승인하세요.
                </p>
              </div>
              <button
                disabled={locked}
                onClick={() =>
                  void command("edit", { plan: p }, "계획 변경 저장")
                }
              >
                변경 저장
              </button>
              <button
                className="quiet"
                onClick={() => {
                  setDraft(run?.plan ? copy(run.plan) : undefined);
                  setDirty(false);
                }}
              >
                편집 취소
              </button>
              <details>
                <summary>변경점 보기</summary>
                {changes.map((c, i) => (
                  <p key={i}>{c}</p>
                ))}
              </details>
            </div>
          )}
          {run && tab !== "history" && <div className="journey" aria-label="테스트 진행 단계">{[
            ["scenarios", "계획 확인", !!approved], ["execute", "데이터 준비", states.length > 0 && states.every(x => !["PENDING", "PREPARING", "PREPARE_FAILED", "BLOCKED"].includes(x))],
            ["execute", "테스트 실행", selected.length > 0 && completed === selected.length], ["execute", "결과 비교", hasComparison], ["artifacts", "보고서 · 정리", !!run.review && run.cleanup.decision !== "pending"],
          ].map(([target, label, done], i) => <button key={String(label)} className={done ? "journey-step done" : "journey-step"} onClick={() => setTab(String(target))}><span>{done ? "✓" : i + 1}</span>{label}</button>)}</div>}
          {tab === "history" && (
            <>
              <Panel title="새 실행">
                <div className="form-grid">
                  <label>
                    소스 프로젝트 경로
                    <input
                      value={newSource}
                      onChange={(e) => setNewSource(e.target.value)}
                      placeholder="C:\업무 프로젝트\source"
                    />
                  </label>
                  <label>
                    연결 방식
                    <select
                      value={newMode}
                      onChange={(e) => setNewMode(e.target.value)}
                    >
                      <option value="fake">오프라인 Fake Adapter</option>
                      <option value="live">실제 비운영 Org (승인 후 쓰기)</option>
                    </select>
                  </label>
                  <label>
                    명시적 Org 별칭
                    <input
                      value={newTarget}
                      onChange={(e) => setNewTarget(e.target.value)}
                    />
                  </label>
                  <label>
                    분석 대상
                    <input
                      value={selection}
                      onChange={(e) => setSelection(e.target.value)}
                      placeholder="클래스·트리거·메서드·Git 범위"
                    />
                  </label>
                </div>
                <button
                  disabled={locked || !newSource || !newTarget}
                  onClick={() => void newRun()}
                >
                  실행 만들기
                </button>
              </Panel>
              <Panel title="저장된 실행">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>실행</th>
                        <th>연결</th>
                        <th>대상</th>
                        <th>상태</th>
                        <th>수정 시각</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r) => (
                        <tr key={r.run_id}>
                          <td>
                            <code>{r.run_id}</code>
                          </td>
                          <td>{r.mode === "fake" ? "오프라인" : "실제 Org"}</td>
                          <td>{r.target}</td>
                          <td>{statuses[r.status] ?? r.status}</td>
                          <td>{stamp(r.updatedAt)}</td>
                          <td>
                            <button
                              className="small"
                              onClick={() => void selectRun(r.run_id)}
                            >
                              열기
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}
          {!run && ready && tab !== "history" && (
            <Panel title="첫 테스트를 시작하세요">
              <p>
                먼저 오프라인 예제로 전체 흐름을 확인하거나, 실행 기록에서 소스
                프로젝트와 Org를 지정하세요.
              </p>
              <div className="button-row">
                <button onClick={() => void demo()} disabled={locked}>
                  오프라인 예제 열기
                </button>
                <button className="outline" onClick={() => setTab("history")}>
                  새 실행 설정
                </button>
              </div>
            </Panel>
          )}
          {run && tab === "scenarios" && (
            <>
              <div className="metrics">
                <div>
                  <span>선택한 시나리오</span>
                  <strong>
                    {selected.length}
                    <small> / {p?.scenarios.length ?? 0}</small>
                  </strong>
                </div>
                <div>
                  <span>준비 / 동작 레코드</span>
                  <strong>
                    {p?.records.filter((r) => r.stage === "fixture").length ??
                      0}
                    <small>
                      {" "}
                      /{" "}
                      {p?.records.filter((r) => r.stage === "action").length ??
                        0}
                    </small>
                  </strong>
                </div>
                <div>
                  <span>비교 조건</span>
                  <strong>{p?.expectations.length ?? 0}</strong>
                </div>
                <div>
                  <span>데이터 처리</span>
                  <strong className="metric-text">
                    {run.cleanup.decision === "pending"
                      ? "사용자 선택 대기"
                      : run.cleanup.decision === "keep"
                        ? "보존"
                        : "정리"}
                  </strong>
                </div>
              </div>
              <details className="source-disclosure" open={!p}>
                <summary>분석 대상 · 소스 확인 <span>{run.source?.selection ?? "Claude Code에서 대상 분석"}</span></summary>
              <Panel
                title="코드 분석"
                aside={<span className="muted">현재 로컬 소스 기준</span>}
              >
                <div className="inline-form">
                  <input
                    aria-label="분석 대상"
                    value={selection}
                    onChange={(e) => setSelection(e.target.value)}
                    placeholder={
                      run.source?.selection ??
                      "클래스, 메서드, 기능 설명 또는 커밋 범위"
                    }
                  />
                  <button
                    className="outline"
                    disabled={locked || dirty}
                    onClick={() =>
                      void command(
                        "analyze",
                        { selection: selection || run.source?.selection },
                        "분석 컨텍스트 생성",
                      )
                    }
                  >
                    컨텍스트 준비
                  </button>
                </div>
                {candidates.length > 0 && (
                  <div className="import-preview">
                    <h3>분석 대상 후보를 선택하세요</h3>
                    {candidates.map((candidate, i) => (
                      <div key={`${candidate.path}-${i}`}>
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={candidatePaths.includes(candidate.path)}
                            onChange={(e) =>
                              setCandidatePaths(
                                e.target.checked
                                  ? [
                                      ...new Set([
                                        ...candidatePaths,
                                        candidate.path,
                                      ]),
                                    ]
                                  : candidatePaths.filter(
                                      (p) => p !== candidate.path,
                                    ),
                              )
                            }
                          />
                          {candidate.path} · {candidate.matches?.join(", ")}
                        </label>
                        {candidate.methods?.length === 1 && (
                          <button
                            className="small outline"
                            disabled={locked}
                            onClick={() => {
                              const signature = `${candidate.name}.${candidate.methods[0]}`;
                              setSelection(signature);
                              void command(
                                "analyze",
                                { selection: signature },
                                "메서드 시그니처 선택",
                              );
                            }}
                          >
                            {candidate.methods[0]} 선택
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      disabled={locked || candidatePaths.length === 0}
                      onClick={() =>
                        void command(
                          "analyze",
                          { selection, selectedPaths: candidatePaths },
                          "소스 후보 선택",
                        )
                      }
                    >
                      선택한 소스로 컨텍스트 준비
                    </button>
                  </div>
                )}
                {run.analysisRequest && (
                  <div className="analysis-status">
                    <span className="pulse-dot" />
                    <div>
                      <strong>
                        {p
                          ? "계획 제출됨 · 추가 수정은 Claude Code에서"
                          : "Claude Code의 분석 응답을 기다립니다"}
                      </strong>
                      <p>
                        현재 세션에서{" "}
                        <code>/testforce</code>를
                        호출하세요. 브라우저는 별도 AI 서비스를 호출하지
                        않습니다.
                      </p>
                      <details>
                        <summary>요청 식별 정보</summary>
                        <JsonView value={run.analysisRequest} />
                      </details>
                    </div>
                  </div>
                )}
                <details>
                  <summary>소스와 배포본 확인</summary>
                  <p>
                    커밋 {run.source?.gitCommit ?? "Git 정보 없음"} · 미커밋
                    변경 {run.source?.dirty ? "있음" : "없음"}
                  </p>
                  {run.source?.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                  {run.sourceCheck ? (
                    <div className="table-scroll"><table><thead><tr><th>배포본 비교 파일</th><th>확인 결과</th></tr></thead><tbody>{run.sourceCheck.files.map(f => <tr key={f.path}><td>{f.path}</td><td>{f.matches ? "✓ 로컬과 일치" : "≠ 확인 필요"} · {f.reason}</td></tr>)}</tbody></table></div>
                  ) : (
                    <p>
                      실행 전 엔진이 직접 대상과 확인 범위의 배포본을
                      비교합니다. 아직 확인하지 않았습니다.
                    </p>
                  )}
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>파일</th>
                          <th>API 버전</th>
                          <th>소스 해시</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(run.source?.files ?? p?.source.files ?? []).map(
                          (f) => (
                            <tr key={f.path}>
                              <td>{f.path}</td>
                              <td>{f.apiVersion}</td>
                              <td>
                                <code>{short(f.hash)}</code>
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </details>
              </Panel>
              </details>
              {p && (
                <>
                  <Panel
                    title="시나리오"
                    aside={
                      <div className="button-row">
                        <button
                          className="small quiet"
                          onClick={() =>
                            change((p) =>
                              p.scenarios.forEach((s) => {
                                s.selected = true;
                              }),
                            )
                          }
                        >
                          모두 선택
                        </button>
                        <button
                          className="small quiet"
                          onClick={() =>
                            change((p) =>
                              p.scenarios.forEach((s) => {
                                s.selected = false;
                              }),
                            )
                          }
                        >
                          선택 해제
                        </button>
                        <button className="small outline" onClick={newScenario}>
                          + 직접 추가
                        </button>
                      </div>
                    }
                  >
                    <div className="bulk-action">
                      <label>
                        전체 실행 방식
                        <select
                          aria-label="전체 실행 방식"
                          value=""
                          onChange={(e) =>
                            change((p) =>
                              p.scenarios.forEach((s) => {
                                s.execution = e.target
                                  .value as Scenario["execution"];
                              }),
                            )
                          }
                        >
                          <option value="" disabled>
                            방식 선택
                          </option>
                          {Object.entries(modes).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {p.scenarios.map((s, index) => (
                      <article
                        className={`scenario-card ${s.selected ? "selected" : ""}`}
                        key={s.id}
                      >
                        <div className="scenario-head">
                          <input
                            type="checkbox"
                            aria-label={`${s.title} 선택`}
                            checked={s.selected}
                            onChange={(e) =>
                              change((p) => {
                                p.scenarios[index]!.selected = e.target.checked;
                              })
                            }
                          />
                          <div>
                            <span className="mono muted">시나리오 {index + 1}</span>
                            <input
                              className="scenario-title"
                              aria-label={`${s.id} 제목`}
                              value={s.title}
                              onChange={(e) =>
                                change((p) => {
                                  p.scenarios[index]!.title = e.target.value;
                                })
                              }
                            />
                          </div>
                          <select
                            aria-label={`${s.id} 실행 방식`}
                            value={s.execution}
                            onChange={(e) =>
                              change((p) => {
                                p.scenarios[index]!.execution = e.target
                                  .value as Scenario["execution"];
                              })
                            }
                          >
                            {Object.entries(modes).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </div>
                        <label>
                          목적
                          <textarea
                            rows={2}
                            value={s.purpose}
                            onChange={(e) =>
                              change((p) => {
                                p.scenarios[index]!.purpose = e.target.value;
                              })
                            }
                          />
                        </label>
                        <details className="rationale-details"><summary>추천 근거와 관련 코드</summary>
                        <p className="rationale">
                          <strong>추천 근거</strong> {s.rationale}
                        </p>
                        <div className="source-chips">
                          {s.sourceRefs.map((r, i) => (
                            <span key={i}>
                              {r.path} · {r.symbol}
                              {r.line ? `:${r.line}` : ""}
                            </span>
                          ))}
                        </div>
                        </details>
                        <details>
                          <summary>
                            전제조건 · 실행 동작 · 관찰 범위 ({s.actions.length}
                            개 동작)
                          </summary>
                          <ScenarioPlanDetails scenario={s} />
                        </details>
                        <JsonEditor
                          label={`${s.id} 구조 편집`}
                          value={s}
                          onSave={(v) =>
                            change((p) => {
                              p.scenarios[index] = ScenarioSchema.parse(v);
                            })
                          }
                        />
                      </article>
                    ))}
                    <details className="advanced">
                      <summary>자연어로 추가 · 수정하기</summary>
                      <textarea
                        aria-label="Claude Code에 전달할 수정 요청"
                        value={analysisNote}
                        onChange={(e) => setAnalysisNote(e.target.value)}
                        placeholder="원하는 시나리오나 기대 결과 변경을 적어 주세요."
                      />
                      <p>
                        이 문장을 Claude Code 세션에 보내면 Skill이 현재 버전에
                        맞는 계획 변경안을 제출합니다. 자동 승인은 수행하지
                        않습니다.
                      </p>
                      <button
                        className="small"
                        disabled={!analysisNote}
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(
                              `/testforce 실행 ${run.run_id} 수정: ${analysisNote}`,
                            )
                            .then(() =>
                              setNotice(
                                "Claude Code에 전달할 요청을 복사했습니다.",
                              ),
                            )
                            .catch(() =>
                              setError(
                                "클립보드 접근이 차단되었습니다. 문장을 직접 선택해 복사해 주세요.",
                              ),
                            )
                        }
                      >
                        터미널 요청 복사
                      </button>
                    </details>
                  </Panel>
                  <Panel title="계획 검토 및 승인">
                    <p>
                      기대 결과는 로컬 코드 분석을 바탕으로 작성한 초안입니다.
                      업무 요구사항의 정확성은 개발자가 검토합니다.
                    </p>
                    <div className="review-grid">
                      <div>
                        <span>대상 Org ID</span>
                        <code>{p.org.orgId}</code>
                      </div>
                      <div>
                        <span>실행 사용자</span>
                        <strong>{p.org.username}</strong>
                      </div>
                      <div>
                        <span>준비 범위</span>
                        <strong>
                          {
                            p.records.filter((r) => r.stage === "fixture")
                              .length
                          }
                          개 입력 레코드
                        </strong>
                      </div>
                      <div>
                        <span>기존 데이터 영향</span>
                        <strong>
                          {p.policies.existingMutation
                            ? "별도 기존 데이터 승인 필요"
                            : "기본 수정·삭제 금지"}
                        </strong>
                      </div>
                    </div>
                    <details className="plan-review-details">
                      <summary>준비 데이터 · 실행 동작 · 기대값 확인</summary>
                      <PlanReviewTables plan={p} />
                      {selected.map(s => <div key={s.id}><h3>{s.title}</h3><ScenarioPlanDetails scenario={s} /></div>)}
                      <details className="advanced"><summary>기술 상세 · 전체 승인 계획</summary><JsonView value={p} /></details>
                    </details>
                    {approved && <div className="approval-complete" role="status"><strong>✓ 이 계획은 승인되어 있어요.</strong><p>같은 범위의 준비·실행에는 다시 승인할 필요가 없습니다.</p><button onClick={() => setTab("execute")}>실행 결과로 이동 →</button></div>}
                    <details className="approval-options" open={!approved}><summary>{approved ? "승인 범위 추가·변경" : "승인 범위 확인"}</summary>
                    <div className="approval-form">
                      <label>
                        승인 범위
                        <select
                          aria-label="승인 범위"
                          value={approvalScope}
                          onChange={(e) => setApprovalScope(e.target.value)}
                        >
                          <option value="prepare">준비까지만</option>
                          <option value="execute">준비 후 도구 실행까지</option>
                          <option value="existing">
                            표시된 기존 데이터 변경 별도 승인
                          </option>
                        </select>
                      </label>
                    </div>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={reviewed}
                        onChange={(e) => setReviewed(e.target.checked)}
                        disabled={dirty || locked}
                      />
                      계획과 변경 범위를 확인했습니다.
                    </label>
                    <div className="button-row">
                      <button
                        disabled={locked || dirty || !reviewed || selected.length === 0}
                        onClick={() =>
                          void command(
                            "approve",
                            { scope: approvalScope, reviewed },
                            "계획 승인",
                          )
                        }
                      >
                        이 계획 승인
                      </button>
                      <span className="muted mono">
                        계획 해시 {short(run.plan?.hash)}
                      </span>
                    </div>
                    </details>
                    {run.approvals.length > 0 && (
                      <details>
                        <summary>승인 이력</summary>
                        <div className="table-scroll"><table><thead><tr><th>계획</th><th>승인 범위</th><th>상태</th></tr></thead><tbody>{run.approvals.map(a => <tr key={a.id}><td>v{a.planVersion}</td><td>{{prepare: "준비까지만", execute: "준비와 도구 실행", existing: "기존 데이터 변경", cleanup: "정리", restore: "복구", "cancel-job": "Job 취소"}[a.scope]}</td><td>{a.planHash === run.plan?.hash ? "현재 계획" : "이전 계획"}</td></tr>)}</tbody></table></div>
                      </details>
                    )}
                  </Panel>
                </>
              )}
            </>
          )}
          {run && tab === "inputs" && p && (
            <>
              <Panel
                title="계획 Excel"
                aside={
                  <span className="muted">도구에서 내보낸 양식만 지원</span>
                }
              >
                <div className="button-row">
                  <button
                    disabled={locked || dirty}
                    onClick={() =>
                      void command("excel-export", {}, "계획 Excel 생성")
                    }
                  >
                    계획 Excel 생성
                  </button>
                  <a
                    className="button outline"
                    href={download("test-plan.xlsx")}
                    download
                  >
                    test-plan.xlsx 다운로드
                  </a>
                  <label className="file-button">
                    수정 Excel 불러오기
                    <input
                      aria-label="수정 Excel 불러오기"
                      type="file"
                      accept=".xlsx"
                      disabled={locked || dirty}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f)
                          void act("Excel 읽기", async () => {
                            const b = await fileBase64(f);
                            const result = await command(
                              "excel-import",
                              { base64: b },
                              "Excel 변경 검토",
                            );
                            if (result) {
                              setExcelPreview(
                                (result.preview ?? result) as Extra,
                              );
                              setResolutions({});
                            }
                          });
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <p className="muted">
                  행 정렬은 논리키로 추적합니다. 승인·실제 ID·증거는 Excel에서
                  가져오지 않습니다.
                </p>
                {excelPreview && (
                  <div className="import-preview">
                    <h3>Excel 변경 검토</h3>
                    <div className="table-scroll"><table><thead><tr><th>변경 항목</th><th>기존 값</th><th>Excel 편집값</th></tr></thead><tbody>{((excelPreview.changes ?? []) as Extra[]).map((c, i) => <tr key={i}><td>{String(c.path)}</td><td><ValueContent value={c.before} missingLabel="기존 값 없음" /></td><td><ValueContent value={c.after} missingLabel="제거됨" /></td></tr>)}</tbody></table></div>
                    {getAmbiguities(excelPreview).map((item, i) => {
                      const id = String(
                        item.id ??
                          `${item.recordKey ?? item.key ?? ""}.${item.field ?? ""}`,
                      );
                      return (
                        <label key={i}>
                          {String(
                            item.key ?? item.recordKey ?? item.path ?? id,
                          )}{" "}
                          · {String(item.field ?? "빈칸")}
                          <select
                            value={resolutions[id] ?? ""}
                            onChange={(e) =>
                              setResolutions({
                                ...resolutions,
                                [id]: e.target.value,
                              })
                            }
                          >
                            <option value="">빈칸 의미를 선택하세요</option>
                            <option value="keep">기존 요청 유지</option>
                            <option value="omit">필드 생략</option>
                            <option value="null">값 지우기 (null)</option>
                            <option value="empty">빈 문자열</option>
                          </select>
                        </label>
                      );
                    })}
                    <button
                      disabled={
                        locked ||
                        getAmbiguities(excelPreview).some(
                          (item) =>
                            !resolutions[
                              String(
                                item.id ??
                                  `${item.recordKey ?? item.key ?? ""}.${item.field ?? ""}`,
                              )
                            ],
                        )
                      }
                      onClick={() =>
                        void command(
                          "excel-apply",
                          { resolutions },
                          "Excel 계획 변경 저장",
                        ).then((r) => {
                          if (r) setExcelPreview(undefined);
                        })
                      }
                    >
                      검증 후 새 계획으로 저장
                    </button>
                  </div>
                )}
              </Panel>
              <Panel title="준비 데이터와 테스트 입력">
                <p>
                  준비(Fixture)는 실행 전 상태입니다. Insert Trigger의 대상
                  Insert는 테스트 동작에 남겨 두세요.
                </p>
                <div className="record-toolbar">
                  <button
                    className="small outline"
                    onClick={() =>
                      change((p) =>
                        p.records.push({
                          key: `record-${crypto.randomUUID().slice(0, 8)}`,
                          scenarioId: p.scenarios[0]?.id ?? "",
                          object: "",
                          stage: "fixture",
                          ownership: "created",
                          fields: {},
                          dependsOn: [],
                          intentionalInvalid: false,
                          existingImpactIds: [],
                        }),
                      )
                    }
                  >
                    + 레코드 추가
                  </button>
                </div>
                {p.records.map((r, index) => (
                  <article className="record-card" key={r.key}>
                    <div className="record-head">
                      <span className={`stage ${r.stage}`}>
                        {r.stage === "fixture" ? "준비" : "테스트 동작"}
                      </span>
                      <strong>{r.object}</strong>
                      <code>{r.key}</code>
                      <span className="spacer" />
                      <button
                        className="small quiet danger"
                        onClick={() =>
                          change((p) => {
                            p.records.splice(index, 1);
                          })
                        }
                      >
                        행 삭제
                      </button>
                    </div>
                    <div className="form-grid compact">
                      <label>
                        논리키
                        <input
                          value={r.key}
                          onChange={(e) =>
                            change((p) => {
                              p.records[index]!.key = e.target.value;
                            })
                          }
                        />
                      </label>
                      <label>
                        오브젝트 API 이름
                        <input
                          value={r.object}
                          onChange={(e) =>
                            change((p) => {
                              p.records[index]!.object = e.target.value;
                            })
                          }
                        />
                      </label>
                      <label>
                        시나리오
                        <select
                          value={r.scenarioId}
                          onChange={(e) =>
                            change((p) => {
                              p.records[index]!.scenarioId = e.target.value;
                            })
                          }
                        >
                          {p.scenarios.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        단계
                        <select
                          value={r.stage}
                          onChange={(e) =>
                            change((p) => {
                              p.records[index]!.stage = e.target
                                .value as RecordSpec["stage"];
                            })
                          }
                        >
                          <option value="fixture">준비 데이터</option>
                          <option value="action">테스트 동작 입력</option>
                        </select>
                      </label>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Salesforce 필드</th>
                            <th>입력 의미와 값</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(r.fields).map(([field, value]) => (
                            <tr key={field}>
                              <td>
                                <code>{field}</code>
                              </td>
                              <td>
                                <ValueEditor
                                  value={value}
                                  label={`${r.key}.${field}`}
                                  onChange={(v) =>
                                    change((p) => {
                                      p.records[index]!.fields[field] = v;
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <button
                                  className="quiet small"
                                  aria-label={`${r.key}.${field} 제거`}
                                  onClick={() =>
                                    change((p) => {
                                      delete p.records[index]!.fields[field];
                                    })
                                  }
                                >
                                  ×
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <FieldAdder
                      onAdd={(field) =>
                        change((p) => {
                          p.records[index]!.fields[field] = {
                            kind: "value",
                            value: "",
                          };
                        })
                      }
                    />
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={r.intentionalInvalid}
                        onChange={(e) =>
                          change((p) => {
                            p.records[index]!.intentionalInvalid =
                              e.target.checked;
                          })
                        }
                      />
                      의도적인 오류 입력 — 자동 보정하지 않음
                    </label>
                    <JsonEditor
                      label={`${r.key} 관계·소유 구분 편집`}
                      value={r}
                      onSave={(v) =>
                        change((p) => {
                          p.records[index] = RecordSpecSchema.parse(v);
                        })
                      }
                    />
                  </article>
                ))}
              </Panel>
              <Panel title="테스트 동작의 변경값">
                <p>
                  Update의 변경값은 준비 레코드와 별도로 보관합니다. 변경 전
                  Fixture를 덮어쓰지 않습니다.
                </p>
                {p.scenarios.flatMap((scenario, si) =>
                  scenario.actions
                    .filter((a) => a.verb === "update")
                    .map((action) => {
                      const ai = scenario.actions.indexOf(action);
                      return (
                        <article
                          className="record-card"
                          key={`${scenario.id}-${action.id}`}
                        >
                          <h3>
                            {scenario.title} · {action.id}
                          </h3>
                          {action.recordKeys.map((key) => (
                            <div key={key}>
                              <h4>{key}</h4>
                              <div className="table-scroll">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>변경할 필드</th>
                                      <th>실행 시 전송할 값</th>
                                      <th />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {Object.entries(
                                      action.fieldOverrides?.[key] ?? {},
                                    ).map(([field, value]) => (
                                      <tr key={field}>
                                        <td>
                                          <code>{field}</code>
                                        </td>
                                        <td>
                                          <ValueEditor
                                            label={`${action.id}.${key}.${field}`}
                                            value={value}
                                            onChange={(v) =>
                                              change((p) => {
                                                p.scenarios[si]!.actions[
                                                  ai
                                                ]!.fieldOverrides[key]![field] =
                                                  v;
                                              })
                                            }
                                          />
                                        </td>
                                        <td>
                                          <button
                                            className="small quiet"
                                            onClick={() =>
                                              change((p) => {
                                                delete p.scenarios[si]!.actions[
                                                  ai
                                                ]!.fieldOverrides[key]![field];
                                              })
                                            }
                                          >
                                            제거
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <FieldAdder
                                onAdd={(field) =>
                                  change((p) => {
                                    const a = p.scenarios[si]!.actions[ai]!;
                                    a.fieldOverrides ??= {};
                                    a.fieldOverrides[key] ??= {};
                                    a.fieldOverrides[key]![field] = {
                                      kind: "value",
                                      value: "",
                                    };
                                  })
                                }
                              />
                            </div>
                          ))}
                        </article>
                      );
                    }),
                )}
                {!p.scenarios.some((s) =>
                  s.actions.some((a) => a.verb === "update"),
                ) && (
                  <p className="muted">현재 계획에 Update 동작이 없습니다.</p>
                )}
              </Panel>
              <Panel title="기대 결과">
                <p>
                  승인한 선언적 조건을 실행 후 실제 증거와 비교합니다. 조건이
                  없으면 자동 통과하지 않습니다.
                </p>
                {p.expectations.map((a, index) => (
                  <article className="assertion-card" key={a.id}>
                    <div className="form-grid">
                      <label>
                        검사 이름
                        <input
                          value={a.label}
                          onChange={(e) =>
                            change((p) => {
                              p.expectations[index]!.label = e.target.value;
                            })
                          }
                        />
                      </label>
                      <label>
                        비교
                        <select
                          value={a.operator}
                          onChange={(e) =>
                            change((p) => {
                              p.expectations[index]!.operator = e.target
                                .value as Assertion["operator"];
                            })
                          }
                        >
                          {[
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
                          ].map((op) => (
                            <option key={op} value={op}>{operatorLabels[op] ?? op}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="mono muted">
                      {a.subject.kind} · {a.subject.key ?? a.scenarioId} ·{" "}
                      {a.subject.field ?? "전체 값"}
                    </p>
                    <ValueEditor
                      label={`${a.id} 기대값`}
                      value={
                        a.expected === undefined
                          ? { kind: "omit" }
                          : a.expected === null
                            ? { kind: "null" }
                            : { kind: "value", value: a.expected }
                      }
                      onChange={(v) =>
                        change((p) => {
                          if (v.kind === "omit")
                            delete p.expectations[index]!.expected;
                          else if (v.kind === "null")
                            p.expectations[index]!.expected = null;
                          else if (v.kind === "value")
                            p.expectations[index]!.expected = v.value;
                        })
                      }
                    />
                    <JsonEditor
                      label={`${a.id} 비교 조건 편집`}
                      value={a}
                      onSave={(v) =>
                        change((p) => {
                          p.expectations[index] = AssertionSchema.parse(v);
                        })
                      }
                    />
                    <button
                      className="quiet small danger"
                      onClick={() =>
                        change((p) => {
                          p.expectations.splice(index, 1);
                        })
                      }
                    >
                      검사 삭제
                    </button>
                  </article>
                ))}
                <button
                  className="outline small"
                  onClick={() =>
                    change((p) =>
                      p.expectations.push({
                        id: `check-${crypto.randomUUID().slice(0, 8)}`,
                        scenarioId: p.scenarios[0]?.id ?? "",
                        label: "새 수동 관찰",
                        subject: { kind: "manual" },
                        operator: "eq",
                        expected: "",
                        tolerance: 0,
                        unordered: false,
                        valueType: "auto",
                        timezone: "UTC",
                      }),
                    )
                  }
                >
                  + 기대 결과 추가
                </button>
              </Panel>
            </>
          )}
          {run && tab === "execute" && (
            <>
              <section className="next-action" aria-label="다음 작업">
                <div><span className="eyebrow">다음 작업</span><h2>{nextCopy[nextAction]![0]}</h2><p>{nextCopy[nextAction]![1]}</p></div>
                <div className="button-row">
                  {["plan", "repair"].includes(nextAction) && <button onClick={() => setTab("scenarios")}>계획 확인하기 →</button>}
                  {nextAction === "prepare" && <button disabled={locked || dirty || !approved || run.paused} onClick={() => void command("prepare", {}, "데이터 준비")}>데이터 준비</button>}
                  {nextAction === "execute" && <button disabled={locked || dirty || !executeApproved || run.paused} onClick={() => void command("execute", {}, "승인된 도구 실행")}>테스트 실행</button>}
                  {nextAction === "observe" && <button disabled={locked || dirty} onClick={() => void command("observe", {}, "비동기 완료 관찰")}>완료 상태 확인</button>}
                  {nextAction === "collect" && <button disabled={locked || dirty} onClick={() => void command("collect", {}, "실제 결과 수집·비교")}>결과 비교</button>}
                  {nextAction === "resume" && <button disabled={locked} onClick={() => void command("resume", {}, "실행 재개")}>중단 지점에서 재개</button>}
                  {nextAction === "reports" && <button onClick={() => setTab("artifacts")}>보고서 · 정리로 이동 →</button>}
                  {nextAction === "review" && <button className="outline" onClick={() => document.getElementById("developer-review")?.scrollIntoView({behavior: "smooth"})}>최종 판정 남기기 ↓</button>}
                </div>
              </section>
              <details className="execution-controls"><summary>단계별 실행 · 새로 수집 · 중단</summary>
                <div className="button-row">
                  <button className="outline" disabled={locked || dirty || !approved || !existingApproved || run.paused} onClick={() => void command("prepare", {}, "데이터 준비")}>1. 데이터 준비</button>
                  <button className="outline" disabled={locked || dirty || !executeApproved || !existingApproved || !readyTool || run.paused} onClick={() => void command("execute", {}, "승인된 도구 실행")}>2. 도구 실행</button>
                  <button className="outline" disabled={locked || dirty || !p} onClick={() => void command("collect", {}, "실제 결과 수집·비교")}>3. 결과 수집·비교</button>
                  {waitingAsync && <button className="outline" disabled={locked || dirty} onClick={() => void command("observe", {}, "비동기 완료 관찰")}>비동기 완료 관찰</button>}
                  <button className="quiet" disabled={!ready || (run.paused && !!busy)} onClick={() => run.paused ? void command("resume", {}, "실행 재개") : void requestPause()}>{run.paused ? "▶ 중단 지점에서 재개" : "Ⅱ 로컬 실행 중단"}</button>
                </div>
                <p className="muted">이미 시작된 Salesforce Job은 로컬 중단으로 취소되지 않습니다.</p>
              </details>
              {hasComparison && needsCollection && <p className="alert">실행 후 값을 새로 수집해야 합니다. 아래 표에는 이전에 수집한 비교 결과가 표시됩니다.</p>}
              <Panel title="시나리오별 결과" aside={<label className="filter-label">표시<select aria-label="결과 필터" value={resultFilter} onChange={e => setResultFilter(e.target.value)}><option value="all">모든 시나리오</option><option value="attention">확인이 필요한 시나리오</option></select></label>}>
                {p?.scenarios
                  .filter((s) => s.selected)
                  .filter(s => resultFilter === "all" || !run.assertions.some(a => a.scenarioId === s.id) || run.assertions.some(a => a.scenarioId === s.id && a.status !== "MATCH") || ["ERROR", "UNKNOWN", "PREPARE_FAILED", "BLOCKED", "WAITING_ASYNC", "WAITING_HUMAN"].includes(run.scenarios[s.id]?.status ?? ""))
                  .map((s) => {
                    const state = run.scenarios[s.id];
                    return (
                      <article className="execution-card" key={s.id}>
                        <div className="panel-heading">
                          <h3>{s.title}</h3>
                          <Badge status={state?.status ?? "PENDING"} />
                        </div>
                        <p>
                          {modes[s.execution]} · {state?.message ?? statuses[state?.status ?? "PENDING"] ?? "실행 대기"}
                        </p>
                        {s.execution !== "tool" && (
                          <div className="button-row">
                            <button
                              className="outline small"
                              disabled={locked || dirty || !approved}
                              onClick={() =>
                                void command(
                                  "manual-instructions",
                                  { scenarioId: s.id },
                                  "승인된 수동 실행 자료 생성",
                                )
                              }
                            >
                              승인 스크립트·안내서 생성
                            </button>
                          </div>
                        )}
                        {s.execution !== "tool" && (
                          <details open>
                            <summary>사람 실행 안내</summary>
                            <ol>
                              <li>
                                승인된 준비 데이터가 완료되고 전제조건이
                                확인되었는지 검토합니다.
                              </li>
                              <li>
                                {s.execution === "human-ui"
                                  ? "아래 승인한 값으로 Salesforce 화면에서 입력·저장합니다."
                                  : s.execution === "human-import"
                                    ? "아래 Data Loader 파일 생성을 이용합니다. 부모의 실제 ID 연결 후 자식 파일을 생성합니다."
                                    : "아래 승인한 Anonymous Apex 스크립트를 확인하고 사용자 Org에서 실행합니다."}
                              </li>
                              <li>
                                실제 사용자·경로·관찰 내용을 아래 완료 보고에
                                기록합니다. ID를 추정하지 않습니다.
                              </li>
                            </ol>
                            <ScenarioPlanDetails scenario={s} />
                            <PlanReviewTables plan={{ ...p, scenarios: p.scenarios.map(item => ({ ...item, selected: item.id === s.id })) }} />
                          </details>
                        )}
                        {state?.jobs.map((job) => (
                          <div className="job" key={job.id}>
                            <code>{job.id}</code>
                            <strong>{job.status}</strong>
                            <span>
                              처리 {job.processed} / {job.total} · 오류{" "}
                              {job.errors}
                            </span>
                            <span>
                              {job.done
                                ? "Job 완료 관찰"
                                : "Job 등록됨 · 완료 관찰 필요"}
                            </span>
                          </div>
                        ))}
                        <ScenarioResultTables run={run} scenario={s} />
                      </article>
                    );
                  })}
              </Panel>
              {run.operations.some(
                (o) => o.state === "UNKNOWN" || o.state === "SENDING",
              ) && (
                <ReconcilePanel
                  operations={run.operations.filter(
                    (o) => o.state === "UNKNOWN" || o.state === "SENDING",
                  )}
                  busy={locked}
                  submit={(opId, notes, bindings, actor, logId) =>
                    void command(
                      "reconcile",
                      { opId, notes, bindings, actor, logId },
                      "결과 불명 작업 조정",
                    )
                  }
                />
              )}
              {!!extra.bundle && <ImportDownloads runId={run.run_id} bundleId={String(extra.bundleId ?? bundleId)} bundle={extra.bundle as Extra} />}
              {p?.scenarios.some(
                (s) =>
                  s.execution !== "tool" &&
                  s.actions.some(
                    (a) => a.kind === "service" || a.kind === "batch",
                  ),
              ) && (
                <Panel title="수동 Service·Batch 로그 증거">
                  <p>
                    생성한 스크립트를 실행한 뒤 이미 존재하는 ApexLog ID를
                    연결합니다. 상관 ID·사용자·시각·스크립트 해시를 엔진이
                    검증합니다. TraceFlag를 만들거나 변경하지 않습니다. 로그가
                    없거나 잘린 경우 반환값·Job은 확인 불가로 남습니다.
                  </p>
                  <label>
                    수동 실행 자료 묶음 ID
                    <input
                      value={manualBundleId}
                      onChange={(e) => setManualBundleId(e.target.value)}
                      placeholder="bundle-…"
                    />
                  </label>
                  <label>
                    동작 ID=기존 ApexLog ID
                    <textarea
                      value={manualLogs}
                      onChange={(e) => setManualLogs(e.target.value)}
                      rows={2}
                      placeholder="service-action=07L…"
                    />
                  </label>
                  <p className="muted">
                    {p.scenarios
                      .filter((s) => s.execution !== "tool")
                      .flatMap((s) =>
                        s.actions
                          .filter(
                            (a) => a.kind === "service" || a.kind === "batch",
                          )
                          .map((a) => `${s.title}: ${a.id}`),
                      )
                      .join(" · ")}
                  </p>
                  <button
                    className="outline"
                    disabled={
                      locked || !manualBundleId.trim() || !manualLogs.trim()
                    }
                    onClick={() => {
                      try {
                        const logs = Object.fromEntries(
                          parseMapping(manualLogs).map((m) => [m.key, m.id]),
                        );
                        void command(
                          "manual-evidence",
                          { bundleId: manualBundleId.trim(), logs },
                          "기존 수동 Apex 로그 관찰",
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    기존 로그에서 반환값·Job 읽기
                  </button>
                  <p className="muted">
                    로그 수집만으로 사람 실행 완료 보고를 대신하지 않습니다.
                    아래에서 실제 실행 사용자와 경로를 기록하세요.
                  </p>
                </Panel>
              )}
              {selected.some(s => s.execution !== "tool") && <Panel title="사람 실행 완료 보고">
                <p>
                  완료 보고는 사용자가 실행했다고 보고한 사실입니다. 실제 성공은
                  ID 연결과 Org 재조회로 확인합니다.
                </p>
                <div className="form-grid">
                  <label>
                    시나리오
                    <select
                      value={humanScenario}
                      onChange={(e) => setHumanScenario(e.target.value)}
                    >
                      <option value="">선택하세요</option>
                      {p?.scenarios
                        .filter((s) => s.execution !== "tool")
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    실제 실행 사용자
                    <input
                      value={actor}
                      onChange={(e) => setActor(e.target.value)}
                    />
                  </label>
                </div>
                <label>
                  사용자가 보고한 실제 실행 시각 (선택)
                  <input
                    type="datetime-local"
                    value={humanExecutedAt}
                    onChange={(e) => setHumanExecutedAt(e.target.value)}
                  />
                </label>
                <p className="muted">
                  브라우저의 현지 시간대로 입력합니다. 정확한 시각을 모르면 비워
                  두세요. 완료 보고를 제출한 시각과 별도로 저장합니다.
                </p>
                <label>
                  실행 경로·시각·관찰 내용
                  <textarea
                    value={humanNotes}
                    onChange={(e) => setHumanNotes(e.target.value)}
                    rows={3}
                  />
                </label>
                <label>
                  명시적 실제 ID 연결 (한 줄에 논리키=Salesforce ID)
                  <textarea
                    value={humanBindings}
                    onChange={(e) => setHumanBindings(e.target.value)}
                    rows={2}
                    placeholder="record-key=001…"
                  />
                </label>
                <details>
                  <summary>수동 관찰 값 입력</summary>
                  <p>
                    검사 ID를 키로 JSON 값을 입력합니다. 화면 관찰은 DB 증거와
                    분리합니다.
                  </p>
                  <textarea
                    aria-label="수동 관찰 값"
                    value={manualValues}
                    onChange={(e) => setManualValues(e.target.value)}
                    rows={3}
                  />
                </details>
                <button
                  disabled={locked || !humanScenario || !actor}
                  onClick={() => {
                    try {
                      void command(
                        "human",
                        {
                          scenarioId: humanScenario,
                          actor,
                          path:
                            p?.scenarios.find((s) => s.id === humanScenario)
                              ?.execution ?? "",
                          notes: humanNotes,
                          executedAt: humanExecutedAt
                            ? new Date(humanExecutedAt).toISOString()
                            : undefined,
                          bindings: parseMapping(humanBindings),
                          observations: JSON.parse(manualValues),
                        },
                        "사람 실행 보고",
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  완료 사실 기록
                </button>
              </Panel>}
              {selected.some(s => s.execution === "human-import") && <Panel title="Data Loader 수동 Import">
                <div className="form-grid">
                  <label>
                    파일 단계
                    <select
                      value={importPhase}
                      onChange={(e) => setImportPhase(e.target.value)}
                    >
                      <option value="fixture">준비 데이터</option>
                      <option value="action">테스트 동작</option>
                    </select>
                  </label>
                  <label>
                    시나리오
                    <select
                      value={importScenario}
                      onChange={(e) => setImportScenario(e.target.value)}
                    >
                      <option value="">선택된 모든 시나리오</option>
                      {p?.scenarios.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  disabled={locked || dirty || !approved}
                  onClick={() =>
                    void command(
                      "import-generate",
                      {
                        phase: importPhase,
                        ...(importScenario
                          ? { scenarioId: importScenario }
                          : {}),
                      },
                      "Import 파일 생성",
                    ).then((r) => {
                      const b = (r?.bundle ?? r) as Extra | undefined;
                      if (r?.bundleId || b?.bundleId || b?.id)
                        setBundleId(
                          String(r?.bundleId ?? b?.bundleId ?? b?.id),
                        );
                    })
                  }
                >
                  승인 데이터로 파일 생성
                </button>
                <label>
                  Import 묶음 ID
                  <input
                    value={bundleId}
                    onChange={(e) => setBundleId(e.target.value)}
                  />
                </label>
                <label>
                  연결이 불명확한 행의 명시적 ID (논리키=ID)
                  <textarea
                    value={mappingText}
                    onChange={(e) => setMappingText(e.target.value)}
                    rows={2}
                  />
                </label>
                <div className="button-row">
                  {(["success", "failure"] as const).map((kind) => (
                    <label className="file-button" key={kind}>
                      {kind === "success"
                        ? "성공 CSV 불러오기"
                        : "실패 CSV 불러오기"}
                      <input
                        type="file"
                        accept=".csv"
                        disabled={locked || !bundleId}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f)
                            void act("Import 결과 읽기", async () => {
                              if (f.size > 10 * 1024 * 1024)
                                throw Error("파일은 10 MB 이하여야 합니다.");
                              await command(
                                "import-results",
                                {
                                  bundleId,
                                  csv: await f.text(),
                                  kind,
                                  mappings: Object.fromEntries(
                                    parseMapping(mappingText).map((m) => [
                                      m.key,
                                      m.id,
                                    ]),
                                  ),
                                },
                                "Import 결과 연결",
                              );
                            });
                          e.target.value = "";
                        }}
                      />
                    </label>
                  ))}
                </div>
                <p className="muted">
                  행 순서나 같은 Name으로 추정하지 않습니다. 불명확한 연결은
                  사용자 ID 입력과 실제 재조회 후 처리합니다.
                </p>
              </Panel>}
              <div id="developer-review"><Panel title="AI 해석과 개발자 판정">
                <h3>AI 의견</h3>
                {run.aiNotes.length === 0 ? (
                  <p className="muted">
                    현재 Claude Code가 증거를 읽고 해석을 추가할 수 있습니다.
                  </p>
                ) : (
                  run.aiNotes.map((n, i) => (
                    <blockquote key={i}>
                      <p>{n.text}</p>
                      <small>
                        {stamp(n.at)} · {n.evidenceRefs.join(", ")}
                      </small>
                    </blockquote>
                  ))
                )}
                <details>
                  <summary>분석 메모 추가</summary>
                  <textarea
                    value={aiText}
                    onChange={(e) => setAiText(e.target.value)}
                    rows={3}
                  />
                  <button
                    className="small"
                    disabled={locked || !aiText.trim()}
                    onClick={() =>
                      void command(
                        "ai-note",
                        {
                          text: aiText,
                          evidenceRefs: run.assertions.flatMap((a) =>
                            a.evidenceRef ? [a.evidenceRef] : [],
                          ),
                        },
                        "분석 메모 저장",
                      ).then(() => setAiText(""))
                    }
                  >
                    사실과 분리해 메모 저장
                  </button>
                </details>
                <h3>개발자 최종 판정</h3>
                <p>
                  {run.review
                    ? `${({accepted: "수용", rejected: "미수용", "needs-review": "추가 검토 필요"})[run.review.verdict]} · ${run.review.notes || "메모 없음"}`
                    : "개발자 검토 대기"}
                </p>
                <div className="form-grid">
                  <label>
                    판정
                    <select
                      aria-label="판정"
                      value={reviewVerdict}
                      onChange={(e) => setReviewVerdict(e.target.value)}
                    >
                      <option value="needs-review">추가 검토 필요</option>
                      <option value="accepted">수용</option>
                      <option value="rejected">미수용</option>
                    </select>
                  </label>
                </div>
                <label>
                  판정 메모
                  <textarea
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    rows={3}
                  />
                </label>
                <button
                  disabled={locked || run.assertions.length === 0}
                  onClick={() =>
                    void command(
                      "review",
                      { verdict: reviewVerdict, notes: reviewNotes },
                      "개발자 판정 저장",
                    )
                  }
                >
                  개발자 판정 저장
                </button>
              </Panel></div>
            </>
          )}
          {run && tab === "artifacts" && (
            <>
              <Panel title="보고서와 재현 자료">
                <p>
                  {run.review
                    ? "개발자 검토 기록을 포함합니다."
                    : "개발자 검토 대기 상태의 보고서를 생성합니다."}{" "}
                  {run.mode === "fake"
                    ? "모든 결과는 오프라인 시뮬레이션으로 표시합니다."
                    : ""}
                </p>
                <button
                  disabled={locked}
                  onClick={() =>
                    void command("reports", {}, "MD·Excel 보고서 생성")
                  }
                >
                  MD·Excel 보고서 생성
                </button>
                <div className="artifact-grid">
                  {[
                    [
                      "test-report.md",
                      "한국어 사실 보고서",
                      "시나리오별 관찰, 차이, 검토와 정리",
                    ],
                    [
                      "test-results.xlsx",
                      "결과 Excel",
                      "입력 / before / after / 기대 결과",
                    ],
                    [
                      "test-plan.xlsx",
                      "계획 Excel",
                      "검토·수정 가능한 입력 양식",
                    ],
                    [
                      "plan.json",
                      "구조화 계획",
                      "승인 버전과 해시가 연결된 계획",
                    ],
                  ].map(([file, title, description]) => (
                    <a
                      key={file}
                      className="artifact-card"
                      href={download(file)}
                      download
                    >
                      <span className="file-type">
                        {file.split(".").at(-1)?.toUpperCase()}
                      </span>
                      <strong>{title}</strong>
                      <span>{description}</span>
                      <code>{file} ↓</code>
                    </a>
                  ))}
                </div>
              </Panel>
              <Panel title="데이터 보존 또는 정리">
                <p>
                  매 실행마다 직접 선택합니다. 선택 전에는 데이터를 남겨 둡니다.
                  정리는 완전한 트랜잭션 롤백이 아닙니다.
                </p>
                <div className="retention-status">
                  현재 선택:{" "}
                  <strong>
                    {run.cleanup.decision === "pending"
                      ? "선택 대기"
                      : run.cleanup.decision === "keep"
                        ? "보존"
                        : "정리"}
                  </strong>{" "}
                  · 정리 상태:{" "}
                  {
                    {
                      pending: "대기",
                      kept: "보존됨",
                      complete: "정리 완료",
                      partial: "부분 정리",
                      "needs-review": "확인 필요",
                    }[run.cleanup.status]
                  }
                </div>
                <div className="button-row">
                  <button
                    className="outline"
                    disabled={locked}
                    onClick={() => void command("keep", {}, "데이터 보존")}
                  >
                    데이터 보존
                  </button>
                  <button
                    className="outline"
                    disabled={locked}
                    onClick={() =>
                      void command(
                        "cleanup-preview",
                        {},
                        "정리 대상 확인",
                      ).then((r) => {
                        if (r) { setCleanupPreview((r.preview ?? r) as Extra); setCleanupReviewed(false); }
                      })
                    }
                  >
                    정리 대상 확인
                  </button>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>논리키</th>
                        <th>오브젝트</th>
                        <th>실제 ID</th>
                        <th>소유 구분</th>
                        <th>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.values(run.bindings).map((b) => (
                        <tr key={b.key}>
                          <td>{b.key}</td>
                          <td>{b.object}</td>
                          <td>
                            <code>{b.id}</code>
                          </td>
                          <td>
                            {b.ownership === "created"
                              ? "이번 실행 생성"
                              : b.ownership === "existing"
                                ? "기존 참조"
                                : "연결 불명확"}
                          </td>
                          <td>{b.deleted ? "삭제 확인" : "남아 있음"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {cleanupPreview && (
                  <div className="cleanup-preview">
                    <h3>삭제 대상과 충돌 검토</h3>
                    <CleanupTable preview={cleanupPreview} />
                    <label className="check-label"><input type="checkbox" checked={cleanupReviewed} onChange={e => setCleanupReviewed(e.target.checked)} />삭제할 테스트 데이터를 확인했습니다.</label>
                    <p className="muted">다른 사용자의 변경이나 진행 중 작업이 발견되면 정리가 중단됩니다.</p>
                    <button className="danger-button" disabled={locked || !cleanupReviewed || !cleanupPreview.detailsHash || ((cleanupPreview.conflicts as unknown[] | undefined)?.length ?? 0) > 0}
                      onClick={() => void command("cleanup-approve", { reviewed: cleanupReviewed, detailsHash: cleanupPreview.detailsHash }, "현재 정리 범위 승인").then(r => { if (r) return command("cleanup", {}, "승인된 데이터 정리").then(done => { if (done) { setCleanupPreview(undefined); setCleanupReviewed(false); } }); })}>
                      확인한 데이터 삭제
                    </button>
                  </div>
                )}
                {run.cleanup.results.length > 0 && (
                  <details open>
                    <summary>정리 결과</summary>
                    <div className="table-scroll"><table><thead><tr><th>레코드</th><th>ID</th><th>정리 결과</th></tr></thead><tbody>{run.cleanup.results.map(r => <tr key={r.key}><td>{r.key}</td><td>{r.id}</td><td>{r.success ? "✓ 삭제 완료" : r.error ?? "확인 필요"}</td></tr>)}</tbody></table></div>
                  </details>
                )}
              </Panel>
              <AdditionalSafetyControls
                run={run}
                busy={locked}
                command={command}
              />
              <Panel title="중단·재실행">
                <p>
                  중단 지점 재개는 같은 실행 ID를 사용합니다. 다시 테스트하면 새
                  실행 ID로 이전 결과와 연결합니다. 결과 불명 쓰기는 자동
                  반복하지 않습니다.
                </p>
                <div className="button-row">
                  <button
                    className="outline"
                    disabled={locked}
                    onClick={() => void command("resume", {}, "실행 재개")}
                  >
                    같은 실행 재개
                  </button>
                  <button
                    className="outline"
                    disabled={locked || dirty}
                    onClick={() => void command("rerun", {}, "새 실행 생성")}
                  >
                    새 실행 ID로 재실행
                  </button>
                </div>
              </Panel>
              <Panel title="작업 이력">
                <details>
                  <summary>실제 동작의 전송 상태와 응답</summary>
                  <JsonView value={run.operations} />
                </details>
                <ol className="timeline">
                  {[...run.events]
                    .reverse()
                    .slice(0, 30)
                    .map((e, i) => (
                      <li key={i}>
                        <time>{stamp(e.at)}</time>
                        <strong>{e.type}</strong>
                        <p>{e.message}</p>
                      </li>
                    ))}
                </ol>
              </Panel>
            </>
          )}
          <footer>
            Testforce · 내 컴퓨터에 기록 저장 · Production 쓰기 차단
          </footer>
        </main>
      </div>
    </div>
  );
}
function parseMapping(text: string) {
  return text
    .split(/\r?\n/)
    .filter((s) => s.trim())
    .map((line) => {
      const match =
        /^([A-Za-z0-9_.-]+)\s*=\s*([A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?)$/.exec(
          line.trim(),
        );
      if (!match)
        throw Error(
          "ID 연결은 논리키=15자리 또는 18자리 Salesforce ID 형식이어야 합니다.",
        );
      return { key: match[1], id: match[2] };
    });
}
function getAmbiguities(v: Extra): Extra[] {
  const p = (v.preview ?? v) as Extra;
  return (p.ambiguities ?? p.ambiguousCells ?? []) as Extra[];
}
function planChanges(before: Plan, after: Plan): string[] {
  const changes: string[] = [];
  for (const name of ["scenarios", "records", "expectations"] as const) {
    const old = new Map<string, unknown>(
      before[name].map((v) => ["key" in v ? v.key : v.id, v]),
    );
    for (const item of after[name]) {
      const key = "key" in item ? item.key : item.id;
      if (!old.has(key)) changes.push(`${name} ${key}: 추가`);
      else if (JSON.stringify(old.get(key)) !== JSON.stringify(item))
        changes.push(`${name} ${key}: 변경`);
      old.delete(key);
    }
    for (const key of old.keys()) changes.push(`${name} ${key}: 삭제`);
  }
  return changes;
}
function FieldAdder({ onAdd }: { onAdd: (field: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="inline-form field-adder">
      <input
        aria-label="추가할 필드 API 이름"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="필드 API 이름"
      />
      <button
        className="small outline"
        disabled={!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)}
        onClick={() => {
          onAdd(name);
          setName("");
        }}
      >
        필드 추가
      </button>
    </div>
  );
}

function ImportDownloads({
  runId,
  bundleId,
  bundle,
}: {
  runId: string;
  bundleId: string;
  bundle: Extra;
}) {
  const files = (bundle.files ?? []) as Extra[];
  const names = [
    ...new Set([
      ...[bundle.guidePath, bundle.manifestPath]
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.split(/[\\/]/).at(-1)!),
      ...files
        .flatMap((f) => [f.name, f.reviewName])
        .filter(
          (name): name is string => typeof name === "string" && name.length > 0,
        ),
    ]),
  ];
  return (
    <div className="download-list">
      <h3>{bundle.phase ? "생성된 Import 파일" : "생성된 수동 실행 자료"}</h3>
      {names.map((name) => (
        <a
          key={name}
          href={`/api/runs/${runId}/import/${encodeURIComponent(bundleId)}/${encodeURIComponent(name)}`}
          download
        >
          {name} ↓
        </a>
      ))}
    </div>
  );
}
function ReconcilePanel({
  operations,
  busy,
  submit,
}: {
  operations: Run["operations"];
  busy: boolean;
  submit: (
    id: string,
    notes: string,
    bindings: { key: string | undefined; id: string | undefined }[],
    actor: string,
    logId?: string,
  ) => void;
}) {
  const [opId, setOpId] = useState(""),
    [notes, setNotes] = useState(""),
    [bindings, setBindings] = useState(""),
    [logId, setLogId] = useState(""),
    [error, setError] = useState("");
  return (
    <Panel title="결과 불명 작업 조정">
      <p>
        요청이 전달된 뒤 결과를 확인하지 못했습니다. 원래 쓰기를 반복하지 않고
        실제 ID를 연결하거나 기존 Apex 로그를 읽어 조정합니다. 엔진이 로그의
        상관 ID·실행 시각·사용자와 Job을 확인합니다. TraceFlag나 로깅 설정을
        변경하지 않으며, 충분한 증거가 없는 호출은 확인 불가로 남습니다.
      </p>
      <label>
        작업
        <select value={opId} onChange={(e) => setOpId(e.target.value)}>
          <option value="">선택하세요</option>
          {operations.map((o) => (
            <option key={o.op_id} value={o.op_id}>
              {o.phase} · {o.op_id}
            </option>
          ))}
        </select>
      </label>
      <label>
        확인 근거
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <label>
        기존 ApexLog ID (Apex 호출 조정)
        <input
          value={logId}
          onChange={(e) => setLogId(e.target.value)}
          placeholder="기존 로그가 있을 때 입력"
        />
      </label>
      <label>
        논리키=실제 ID
        <textarea
          value={bindings}
          onChange={(e) => setBindings(e.target.value)}
          disabled={Boolean(logId.trim())}
        />
      </label>
      <button
        disabled={
          busy ||
          !notes.trim() ||
          !opId ||
          (Boolean(logId.trim()) &&
            !/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(logId.trim()))
        }
        onClick={() => {
          try {
            submit(
              opId,
              notes,
              logId.trim() ? [] : parseMapping(bindings),
              "로컬 브라우저 사용자",
              logId.trim() || undefined,
            );
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        실제 조회로 연결 검증
      </button>
      {error && <p role="alert">{error}</p>}
    </Panel>
  );
}

function AdditionalSafetyControls({
  run,
  busy,
  command,
}: {
  run: Run;
  busy: boolean;
  command: (
    command: string,
    payload?: Extra,
    label?: string,
  ) => Promise<Extra | undefined>;
}) {
  const [restore, setRestore] = useState<Extra>(),
    [cancel, setCancel] = useState<Extra>(),
    [jobId, setJobId] = useState(""),
    [keys, setKeys] = useState<string[]>([]);
  const unknown = Object.values(run.bindings).filter(
    (b) => b.ownership === "unresolved" && !b.deleted,
  );
  const jobs = Object.values(run.scenarios)
    .flatMap((s) => s.jobs)
    .filter((j) => !j.done);
  return (
    <>
      {unknown.length > 0 && (
        <Panel title="수동 생성 데이터의 소유관계 확인">
          <p>
            CSV와 ID 대응만으로 생성 소유권을 확정하지 않습니다. 실제 생성
            시각·생성자와 승인한 신규 입력을 엔진이 재조회합니다. 확인하지 않은
            데이터는 자동 정리 대상이 아닙니다.
          </p>
          {unknown.map((b) => (
            <label className="check-label" key={b.key}>
              <input
                type="checkbox"
                checked={keys.includes(b.key)}
                onChange={(e) =>
                  setKeys(
                    e.target.checked
                      ? [...keys, b.key]
                      : keys.filter((k) => k !== b.key),
                  )
                }
              />
              {b.key} · {b.object} · {b.id}
            </label>
          ))}

          <button
            className="outline"
            disabled={busy || keys.length === 0}
            onClick={() =>
              void command(
                "confirm-ownership",
                { reviewed: true, keys },
                "수동 생성 소유관계 확인",
              )
            }
          >
            이번 실행에서 직접 생성한 ID 확인
          </button>
        </Panel>
      )}
      {(run.plan?.policies.existingMutation || jobs.length > 0) && <details className="advanced"><summary>기존 데이터 복구 · 진행 중 Job 관리</summary><Panel title="기존 데이터 복구와 진행 중 Job">
        <p>
          기존 데이터 이전값 복구와 Job 취소는 별도 승인 작업입니다. 현재값
          충돌과 복구 범위를 검토합니다.
        </p>

        <div className="button-row">
          <button
            className="outline"
            disabled={busy}
            onClick={() =>
              void command(
                "restore-preview",
                {},
                "기존 데이터 복구 범위 확인",
              ).then((r) => {
                if (r) setRestore((r.preview ?? r) as Extra);
              })
            }
          >
            기존 데이터 복구 범위 확인
          </button>
        </div>
        {restore && (
          <div className="cleanup-preview">
            <h3>복구 범위와 현재 상태</h3>
            <JsonView value={restore} />
            <div className="button-row">
              <button
                disabled={busy || !restore.detailsHash}
                onClick={() =>
                  void command(
                    "restore-approve",
                    { reviewed: true, detailsHash: restore.detailsHash },
                    "기존 데이터 복구 승인",
                  )
                }
              >
                표시된 이전값 복구 승인
              </button>
              <button
                className="outline"
                disabled={busy}
                onClick={() =>
                  void command("restore", {}, "승인된 이전값 복구")
                }
              >
                승인된 이전값 복구
              </button>
            </div>
          </div>
        )}
        <div className="inline-form">
          <select
            aria-label="취소할 진행 중 Job"
            value={jobId}
            onChange={(e) => {
              setJobId(e.target.value);
              setCancel(undefined);
            }}
          >
            <option value="">이번 실행에서 확인한 진행 중 Job</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.id} · {j.status}
              </option>
            ))}
          </select>
          <button
            className="outline"
            disabled={busy || !jobId}
            onClick={() =>
              void command(
                "cancel-preview",
                { jobId },
                "Job 취소 범위 확인",
              ).then((r) => {
                if (r) setCancel((r.preview ?? r) as Extra);
              })
            }
          >
            Job 취소 검토
          </button>
        </div>
        {jobs.length === 0 && (
          <p className="muted">현재 추적 중인 미완료 Job이 없습니다.</p>
        )}
        {cancel && (
          <div className="cleanup-preview">
            <JsonView value={cancel} />
            <div className="button-row">
              <button
                className="danger-button"
                disabled={busy || !cancel.detailsHash}
                onClick={() =>
                  void command(
                    "cancel-approve",
                    { reviewed: true, jobId, detailsHash: cancel.detailsHash },
                    "Job 취소 승인",
                  )
                }
              >
                이 Job 취소 승인
              </button>
              <button
                className="danger-button outline"
                disabled={busy}
                onClick={() =>
                  void command("cancel-job", { jobId }, "승인된 Job 취소")
                }
              >
                승인된 Job 취소 실행
              </button>
            </div>
          </div>
        )}
      </Panel></details>}
    </>
  );
}

function CleanupTable({ preview }: { preview: Extra }) {
  const rows = (preview.records ?? []) as Extra[];
  return <div className="table-scroll"><table><caption>이번 실행에서 생성한 삭제 대상 {rows.length}건</caption><thead><tr><th>레코드</th><th>Salesforce ID</th><th>현재 상태</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i}><td>{String(r.object)}<small className="cell-detail">{String(r.key)}</small></td><td>{String(r.id)}</td><td>{r.conflict ? `⚠ ${String(r.reason)}` : "✓ 삭제 범위 확인됨"}</td></tr>)}</tbody></table></div>;
}
