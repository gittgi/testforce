// Official Claude Code Mods APIs only. No HTTP server or model calls.
// The capability stays in Mod memory; only actual control callbacks may dispatch actions.
const PANE = "testforce";
const COMMAND = "testforce-ui";
const labels = { MATCH: "✓ 일치", MISMATCH: "≠ 불일치", UNVERIFIABLE: "? 확인 불가", NOT_EXECUTED: "– 미실행" };
const modes = { tool: "도구 실행", "human-ui": "사람 · 화면", "human-import": "사람 · Import", "human-apex": "사람 · Anonymous" };
const phases = { PENDING: "대기", PREPARING: "준비 중", PREPARED: "준비 완료", PREPARE_FAILED: "준비 실패", BLOCKED: "선행 작업 대기", RUNNING: "실행 중", WAITING_HUMAN: "사람 실행 대기", WAITING_ASYNC: "비동기 완료 대기", EXECUTED: "실행 완료", UNKNOWN: "결과 불명", ERROR: "실행 오류" };
const ops = { eq: "같음", ne: "다름", null: "값 없음 (null)", notNull: "null 아님", exists: "존재", absent: "부재", count: "개수", gt: "초과", gte: "이상", lt: "미만", lte: "이하", range: "범위", changed: "변경됨", unchanged: "유지됨", includes: "포함" };
let view, capability, config, workspace;
let runId, tab = "plan", detailId, checked = "", cleanupChecked = "", busy = false;
let notice = "", problem = "", opened = false, openAfterTurn = false;
let resultPage = 0, listPage = 0, storyStep = 0, showPlanDetails = false, showAdvanced = false, showContext = false, showFinishMore = false, notes = "", verdict = "accepted";
const clean = (value) => String(value ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ");
const token = (r) => r?.plan ? `${r.run_id}:${r.plan.version}:${r.plan.hash}` : "";
const own = (value, field) => value && typeof value === "object" && Object.hasOwn(value, field) ? value[field] : undefined;
function valueText(value) {
  if (value === undefined) return "수집 안 됨";
  if (value === null) return "값 없음 (null)";
  if (value === "") return '빈 문자열 ("")';
  if (Array.isArray(value)) return value.length ? value.map(valueText).join(" · ") : "빈 목록";
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${clean(key)}: ${valueText(item)}`).join(" / ") || "빈 객체";
  return clean(value);
}
function inputText(input) {
  if (!input) return "입력 없음";
  if (input.kind === "omit") return "필드 생략";
  if (input.kind === "null") return "값 지우기 (null)";
  if (input.kind === "ref") return `참조 → ${clean(input.key)}`;
  return valueText(input.value);
}
function expectationText(assertion, expected) {
  const operator = ops[assertion?.operator] ?? "기대값";
  const value = expected === undefined ? assertion?.expected : expected;
  return [operator, value === undefined ? "" : valueText(value), assertion?.tolerance ? `허용오차 ${assertion.tolerance}` : "", assertion?.valueType === "datetime" ? `시간대 ${assertion.timezone}` : "", assertion?.unordered ? "순서 무관" : ""].filter(Boolean).join(" · ");
}
function queryText(query) {
  if (!query) return "조회 없음";
  return `${clean(query.object)} [${(query.fields ?? []).map(clean).join(", ")}] ${query.where?.length ? "조건 " + query.where.map((w) => `${clean(w.field)} ${w.op} ${inputText(w.value)}`).join(" / ") : "전체 범위"} · 최대 ${query.limit ?? 2000}건`;
}
function comparisonRows(run) {
  if (!run?.plan) return [];
  const rows = [];
  for (const scenario of run.plan.scenarios.filter((s) => s.selected)) {
    const expected = run.plan.expectations.filter((a) => a.scenarioId === scenario.id);
    const results = run.assertions.filter((r) => r.scenarioId === scenario.id);
    for (const a of expected) {
      const result = results.find((r) => r.assertionId === a.id);
      const key = a.subject?.key, field = a.subject?.field;
      const recordBefore = a.subject.kind === "record" ? run.scenarios[scenario.id]?.baseline[key] : undefined;
      const baseline = field ? field.split(".").reduce((current, part) => own(current, part), recordBefore) : recordBefore;
      rows.push({ id: a.id, scenarioId: scenario.id, label: a.label, title: `${scenario.title} · ${a.label}`, before: result?.before === undefined ? baseline : result.before, actual: result?.actual, expected: expectationText(a, result?.expected), status: result ? labels[result.status] : "비교 대기", message: result?.message ?? "실행 후 실제값을 수집하세요.", evidence: result?.evidenceRef });
    }
    for (const result of results.filter((r) => !expected.some((a) => a.id === r.assertionId))) rows.push({ id: result.assertionId, scenarioId: scenario.id, label: result.assertionId === "no-assertions" ? "비교 조건 없음" : result.assertionId, title: `${scenario.title} · ${result.assertionId === "no-assertions" ? "비교 조건 없음" : result.assertionId}`, before: result.before, actual: result.actual, expected: valueText(result.expected), status: labels[result.status], message: result.message, evidence: result.evidenceRef });
  }
  return rows;
}
function approved(run) {
  return !!run?.plan && run.approvals.some((a) => a.planHash === run.plan.hash && a.planVersion === run.plan.version && a.scope === "execute");
}
function replaceView(response) {
  const previous = token(view?.run);
  const previousRunId = view?.run?.run_id;
  view = response.view;
  capability = response.capability;
  runId = view?.run?.run_id;
  if (previous !== token(view?.run)) {
    checked = ""; cleanupChecked = ""; resultPage = 0; listPage = 0; showPlanDetails = false;
    notes = view?.run?.review?.notes ?? "";
    verdict = view?.run?.review?.verdict ?? "accepted";
  }
  if (previousRunId !== view?.run?.run_id) {
    detailId = undefined; listPage = 0; showAdvanced = false; showContext = false;
    tab = view?.run?.plan && (approved(view.run) || view.run.operations.length || view.run.assertions.length) ? "results" : "plan";
  }
  if (!view?.run?.plan?.scenarios.some((s) => s.id === detailId)) detailId = undefined;
}
function errorText(error) {
  return `${clean(error?.message || "작업을 확인할 수 없습니다.")}${error?.action ? " · " + clean(error.action) : ""}${error?.code ? " (" + clean(error.code) + ")" : ""}`;
}
async function connect($) {
  if (!config) {
    const root = $.plugin.root;
    const candidate = JSON.parse(await $.fs.read(root + "/config.json"));
    const absolute = (s) => typeof s === "string" && (/^\//.test(s) || /^[A-Za-z]:[\\/]/.test(s)) && !/[\u0000\r\n]/.test(s);
    if (!absolute(candidate.bridgeEntry) || !absolute(candidate.nodeExecutable)) throw new Error("Testforce Mod 설치 설정을 확인하세요. npm run install:claude 명령으로 다시 설치할 수 있습니다.");
    config = { bridgeEntry: candidate.bridgeEntry, nodeExecutable: candidate.nodeExecutable };
  }
  workspace = await $.session.cwd();
}
async function bridge($, operation, payload) {
  await connect($);
  const result = await $.process.run([config.nodeExecutable, config.bridgeEntry, operation], { cwd: workspace, stdin: JSON.stringify({ ...payload, workspace }), timeoutMs: 600000 });
  if (result.isStdoutTruncated) throw new Error("엔진 응답이 너무 큽니다. 상세 도구에서 확인하세요. 쓰기를 다시 요청하지 않습니다.");
  let response;
  try { response = JSON.parse(result.stdout); } catch { throw new Error("엔진 응답을 읽을 수 없습니다. 결과 불명인 작업은 재실행하지 말고 상태를 새로고침하세요."); }
  if (response.ok !== true) throw new Error(errorText(response.error));
  if (result.exitCode !== 0 || !response.view) throw new Error("엔진이 정상 종료되지 않았습니다. 상태를 확인하세요.");
  return response;
}
async function refresh($, chosenId) {
  if (busy) return;
  busy = true; problem = "";
  $.ui.invalidate("ui.render");
  try { replaceView(await bridge($, "view", { ...(chosenId || runId ? { runId: chosenId || runId } : {}) })); }
  catch (error) { capability = undefined; checked = ""; cleanupChecked = ""; problem = errorText(error); }
  finally { busy = false; $.ui.invalidate("ui.render"); }
}
async function act($, action, extra = {}) {
  if (busy || !view?.run?.plan || !capability) return;
  const current = view.run;
  if (["approve", "run-tests", "prepare", "execute", "cleanup", "select", "rerun"].includes(action) && current.operations.some((op) => op.state === "UNKNOWN" || op.state === "SENDING")) { problem = "결과 불명 작업이 있습니다. 상태와 실제 ID를 먼저 확인하세요. 자동 재시도하지 않습니다."; $.ui.invalidate("ui.render"); return; }
  if (action === "approve" && checked !== token(current)) return;
  if (action === "cleanup" && (!view.cleanupPreview || cleanupChecked !== `${token(current)}:${view.cleanupPreview.detailsHash}`)) return;
  const request = { runId: current.run_id, version: current.plan.version, hash: current.plan.hash, action, capability, ...extra };
  if (action === "approve" || action === "cleanup") request.reviewed = true;
  // Consume before awaiting. Double presses cannot submit a second operation.
  capability = undefined; checked = ""; cleanupChecked = ""; busy = true; problem = ""; notice = "";
  $.ui.invalidate("ui.render");
  try {
    replaceView(await bridge($, "action", request));
    notice = action === "approve" ? "승인되었습니다. 바로 테스트를 시작할 수 있습니다." : action === "select" ? "선택을 저장했습니다. 계획 확인이 필요합니다." : action === "run-tests" ? "실행 요청 결과를 기록했습니다. 시나리오별 상태를 확인하세요." : "저장했습니다.";
    if (["approve", "run-tests", "prepare", "execute", "collect", "observe"].includes(action)) tab = "results";
    if (action === "run-tests" || action === "approve") detailId = undefined;
    if (action === "rerun") { tab = "plan"; detailId = undefined; }
  } catch (error) {
    problem = errorText(error);
    // A read is safe; never repeat a failed or uncertain write.
    try { replaceView(await bridge($, "view", { runId: current.run_id })); } catch { /* Keep evidence shown; no new capability. */ }
  } finally { busy = false; $.ui.invalidate("ui.render"); }
}
async function openPane($) {
  opened = true;
  await $.ui.open({ id: PANE, title: "Testforce", focus: true, closeOnEscape: true, rows: 24, columns: 88 });
}
export function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: "Testforce 계획·실행·전후 비교·정리 패널" });
    return next(e);
  });
  on("command.run", { command: "testforce-ui" }, async ($) => {
    await refresh($);
    await openPane($);
    return { text: "Testforce 패널을 열었습니다. 1 계획 · 2 테스트 · 3 마무리. Esc로 대화로 돌아갑니다." };
  });
  on("skill.prompt", async ($, e, next) => {
    if (e.skill === "testforce" || e.skill === "sandbox-workbench:testforce") openAfterTurn = true;
    return next(e);
  });
  on("turn.complete", async ($, e, next) => {
    if ((opened || openAfterTurn) && !busy) await refresh($);
    if (openAfterTurn) { openAfterTurn = false; await openPane($); }
    return next(e);
  });
  on("ui.close", async ($, e, next) => {
    if (e.id === PANE) { opened = false; checked = ""; cleanupChecked = ""; }
    return next(e);
  });
  on("ui.render", { component: "Pane" }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    const { Box, Text, Button, Input, Select } = $.ui.resolve(e);
    const compact = (e.props?.scroll?.bodyRows || 24) <= 10 || ((e.viewport?.columns || 160) <= 90 && (e.props?.scroll?.bodyRows || 24) < 18);
    const text = (s, props = {}) => Text({ ...props, children: [clean(s)] });
    const column = (children, props = {}) => Box({ flexDirection: "column", ...props, children });
    const row = (children) => Box({ flexDirection: "row", flexWrap: "wrap", columnGap: 1, children });
    const redraw = () => $.ui.invalidate("ui.render");
    const button = (key, label, callback, enabled = true) => enabled && !busy ? Button({ key, label, onPress: callback }) : text(`[${label}]`, { dimColor: true });
    const card = (children, primary = false) => compact ? column(children) : column(children, { borderStyle: "round", borderColor: primary ? "cyan" : "gray", paddingX: 1 });
    const table = (headers, rows) => {
      const width = (e.props?.bodyColumns ?? 70) - 6;
      if (width < headers.length * 16) return column(rows.map((cells, index) => column(cells.map((cell, i) => text(`${headers[i]}: ${cell}`)), { key: `row-${index}`, marginBottom: 1 })));
      const size = Math.max(12, Math.floor((width - headers.length) / headers.length));
      const grid = (cells, bold = false) => row(cells.map((cell) => Box({ width: size, flexShrink: 0, children: [text(cell, { bold, wrap: "wrap" })] })));
      return column([grid(headers, true), ...rows.map((cells) => grid(cells))]);
    };
    const run = view?.run, plan = run?.plan;
    const stateKey = token(run);
    const unresolved = run?.operations.some((op) => op.state === "UNKNOWN" || op.state === "SENDING");
    const dispatch = (action, extra = {}) => {
      if (token(view?.run) !== stateKey) { problem = "계획이 바뀌었습니다. 최신 내용을 다시 확인하세요."; redraw(); return; }
      return act($, action, extra);
    };
    const tabs = [["plan", "계획", "1"], ["results", "테스트", "2"], ["finish", "마무리", "3"]].map(([name, label, hotkey]) => Button({ key: `tab-${name}`, label, hotkey, plain: true, dimColor: tab !== name, onPress: () => { tab = name; detailId = undefined; resultPage = 0; listPage = 0; storyStep = 0; showPlanDetails = false; redraw(); } }));
    const contextButton = button("context", "ⓘ", () => { showContext = !showContext; redraw(); });
    const targetLabel = run?.mode === "fake" ? "오프라인" : plan?.org.alias || plan?.org.name || run?.target || "Testforce";
    const compactTarget = targetLabel.length <= 20 ? targetLabel : "실제 Org";
    const content = compact ? [row([text(compactTarget, { color: "cyan", bold: true }), ...tabs, button("refresh", "↻", () => refresh($)), contextButton])] : [
      row([text("TESTFORCE", { bold: true, color: "cyan" }), text(run?.mode === "fake" ? "오프라인" : plan?.org.name || run?.target || "시작"), contextButton]),
      row([...tabs, button("refresh", "↻", () => refresh($))]),
    ];
    if (problem) content.push(text(`! ${problem}`, { color: "red" }));
    else if (busy) content.push(text("진행 중… 결과를 기록하고 있습니다.", { color: "cyan" }));
    else if (notice && !compact) content.push(text(notice, { dimColor: true }));
    if (!plan) {
      content.push(card([text(!view ? "저장된 테스트를 불러오세요." : run ? "Claude가 테스트 계획을 분석하고 있습니다." : "어떤 코드를 테스트할까요?", { bold: true }), text(!view ? "↻ 새로고침을 누르면 기존 실행을 이어서 볼 수 있습니다." : run ? "분석이 끝나면 여기에 시나리오가 나타납니다." : "대화에서 /testforce 테스트 대상을 입력하세요.")]));
      return column(content);
    }
    const selected = plan.scenarios.filter((s) => s.selected);
    const toolCount = selected.filter((s) => s.execution === "tool").length;
    const humanCount = selected.length - toolCount;
    const completed = selected.length > 0 && selected.every((s) => run.scenarios[s.id]?.status === "EXECUTED");
    const waitingAsync = selected.some((s) => run.scenarios[s.id]?.status === "WAITING_ASYNC");
    const waitingHuman = selected.some((s) => run.scenarios[s.id]?.status === "WAITING_HUMAN");
    const failed = selected.some((s) => ["PREPARE_FAILED", "BLOCKED", "ERROR"].includes(run.scenarios[s.id]?.status));
    const unsafeRepeat = selected.some((s) => ["EXECUTED", "RUNNING", "WAITING_ASYNC", "WAITING_HUMAN"].includes(run.scenarios[s.id]?.status));
    if (tab !== "finish") {
      const primary = [];
      if (unresolved) primary.push(text("결과 불명 · 실제 상태를 확인한 뒤 재개하세요.", { color: "yellow" }));
      else if (completed) primary.push(row([text(compact ? "✓ 실행 완료" : "✓ 실행 완료 · 시나리오를 눌러 결과 확인", { bold: true }), button("rerun-primary", "새 테스트", () => dispatch("rerun"), !!capability)]));
      else if (waitingAsync) primary.push(row([text("비동기 처리 대기"), button("observe", "완료 확인", () => dispatch("observe"), !!capability)]));
      else if (waitingHuman) primary.push(text("사람 실행 대기 · 시나리오에서 입력·순서를 확인하세요."));
      else if (failed) primary.push(text("실패한 준비·실행을 확인하세요. 자동 반복하지 않습니다.", { color: "yellow" }));
      else if (!approved(run)) {
        primary.push(row([button("review-check", `${checked === stateKey ? "☑" : "□"} 계획 확인`, () => { checked = checked === stateKey ? "" : stateKey; redraw(); }, selected.length > 0 && !!capability), button("approve", "승인", () => dispatch("approve"), checked === stateKey && selected.length > 0)]));
        if (!compact) primary.push(text("시나리오 설명을 확인하고 승인하면 실행할 수 있습니다.", { dimColor: true }));
      } else if (toolCount === 0) {
        primary.push(button("prepare-human", `사람 테스트 준비 (선택 ${selected.length}개)`, () => dispatch("prepare"), selected.length > 0 && !!capability && !unsafeRepeat));
        if (!compact) primary.push(text("준비 데이터만 생성합니다. 실제 동작은 직접 수행합니다.", { dimColor: true }));
      } else {
        primary.push(button("run-tests", `▶ 테스트 시작 (선택 ${selected.length}개)`, () => dispatch("run-tests"), selected.length > 0 && !!capability && !unsafeRepeat));
        if (!compact) primary.push(text(`이 버튼이 ${toolCount}개 도구 테스트를 준비 → 실행 → 비교합니다.${humanCount ? ` 사람 실행 ${humanCount}개는 준비 후 기다립니다.` : ""}`, { dimColor: true }));
      }
      if (selected.some((s) => s.actions.some((a) => a.impact.externalEffects.length || a.impact.existingRecordIds.length)) || plan.records.some((r) => r.existingImpactIds?.length && selected.some((s) => s.id === r.scenarioId))) primary.push(text("! 기존 데이터 또는 외부 영향이 있습니다. 시나리오 상세에서 확인하세요.", { color: "yellow" }));
      content.push(card(primary, true));
    }
    if (showContext) {
      content.push(card([
        text(`실행 범위: 선택 ${selected.length}개 · 도구 ${toolCount}개 준비/실행/비교${humanCount ? " · 사람 " + humanCount + "개는 준비만" : ""}`),
        text(`Org: ${plan.org.name} · ${plan.org.orgId} · ${plan.org.organizationType || (plan.org.isSandbox ? "Sandbox" : "분류 확인 필요")}`),
        text(`실행 사용자: ${plan.org.username}`), text(`실행: ${run.run_id} · 계획 v${plan.version} · ${approved(run) ? "승인됨" : "승인 대기"}`),
        text(`배포본: ${run.sourceCheck?.sourceHash === plan.source.hash ? (run.sourceCheck.matches ? "선택 코드 일치" : "선택 코드 불일치 · 실행 차단") : "승인·실행 시 엔진에서 확인"}`),
        text(`소스: ${plan.source.hash}`), ...plan.source.warnings.map((warning) => text(warning, { dimColor: true })),
      ]));
    }
    const openDetail = (id) => { detailId = id; showPlanDetails = false; resultPage = 0; storyStep = 0; redraw(); };
    const scenarioStatus = (scenario) => {
      const results = run.assertions.filter((a) => a.scenarioId === scenario.id);
      if (results.some((a) => a.status === "MISMATCH")) return "≠ 불일치";
      if (results.some((a) => a.status === "UNVERIFIABLE")) return "? 확인 필요";
      if (results.length && results.every((a) => a.status === "MATCH") && run.scenarios[scenario.id]?.status === "EXECUTED") return "✓ 일치";
      return phases[run.scenarios[scenario.id]?.status] || "대기";
    };
    const technical = (detail) => {
      const children = [text(`코드: ${detail.sourceRefs.map((r) => `${r.path}${r.line ? ":" + r.line : ""} · ${r.symbol}`).join(" / ") || "출처 확인 필요"}`)];
      const records = plan.records.filter((r) => r.scenarioId === detail.id);
      if (records.length) children.push(table(["단계 · 레코드", "필드", "값"], records.flatMap((r) => Object.entries(r.fields).map(([field, value]) => [`${r.stage === "fixture" ? "준비" : "테스트"} · ${r.key} (${r.object})${r.ownership === "existing" ? " · 기존 " + r.existingId : ""}`, field, inputText(value)]))));
      for (const record of records.filter((r) => r.existingImpactIds?.length)) children.push(text(`준비 영향 · ${record.key}: 기존 레코드 ${record.existingImpactIds.join(", ")}`));
      for (const action of detail.actions) {
        children.push(text(`동작 ${action.id} · ${action.kind}`, { bold: true }));
        if (action.kind === "dml") children.push(text(`${action.verb.toUpperCase()} ${action.object} · ${action.recordKeys.join(", ")} · 트랜잭션 ${action.transaction === "single" ? "한 번" : "레코드별"} · ${action.allOrNone ? "전체 성공 또는 실패" : "부분 성공 허용"}`));
        if (action.constructorArgs?.length) children.push(text(`생성자 인자: ${action.constructorArgs.map((a) => `${a.type}: ${inputText(a.value)}`).join(" / ")}`));
        if (action.args?.length) children.push(text(`호출 인자: ${action.args.map((a) => `${a.type}: ${inputText(a.value)}`).join(" / ")}`));
        if (action.script) children.push(text(action.script));
        if (action.scriptPath) children.push(text(`스크립트 파일: ${action.scriptPath} · 해시 ${action.scriptHash || "확인 필요"}`));
        children.push(text(`영향: ${action.impact.description}${action.impact.bounded ? "" : " · 범위 확인 필요"}`));
        if (action.impact.existingRecordIds.length) children.push(text(`기존 데이터: ${action.impact.existingRecordIds.join(", ")} · 필드 ${action.impact.existingFields.join(", ")}`));
        if (action.impact.externalEffects.length) children.push(text(`외부 영향: ${action.impact.externalEffects.join(" / ")}`));
        if (action.kind === "batch") children.push(text(`Batch: scope ${action.scopeSize} · ${queryText(action.scopeQuery)}\n대상 ID: ${action.approvedScopeIds.join(", ") || "없음"}`));
      }
      children.push(table(["검사", "대상", "기대 조건"], plan.expectations.filter((a) => a.scenarioId === detail.id).map((a) => [a.label, `${a.subject.key || a.subject.kind}${a.subject.field ? "." + a.subject.field : ""}${a.subject.query ? " · " + queryText(a.subject.query) : ""}`, expectationText(a)])));
      if (detail.preconditions.length) children.push(text(`실행 전 조건: ${detail.preconditions.map((a) => `${a.label} · ${expectationText(a)}`).join(" / ")}`));
      if (detail.dependsOn.length) children.push(text(`선행 시나리오: ${detail.dependsOn.join(", ")}`));
      children.push(text(`관찰: ${detail.observation.pollMs}ms 간격 · 최대 ${detail.observation.timeoutMs}ms`));
      if (detail.observation.expectedDurationMs) children.push(text(`예상 처리 시간: ${detail.observation.expectedDurationMs}ms · ${detail.observation.durationRequirement ? "승인할 시간 요구조건" : "참고 시간"}`));
      if (detail.observation.completionAssertions.length) children.push(table(["완료 검사", "대상", "조건"], detail.observation.completionAssertions.map((a) => [a.label, `${a.subject.key || a.subject.kind}${a.subject.field ? "." + a.subject.field : ""}${a.subject.query ? " · " + queryText(a.subject.query) : ""}`, expectationText(a)])));
      for (const query of detail.observation.followupQueries || []) children.push(text(`후속 관찰: ${queryText(query)}`));
      return card(children);
    };
    const narrative = (detail) => {
      const fixtures = plan.records.filter((r) => r.scenarioId === detail.id && r.stage === "fixture");
      const expectations = plan.expectations.filter((a) => a.scenarioId === detail.id);
      let children = [text("왜 테스트하나요?", { bold: true, color: "cyan" }), text(detail.purpose || detail.rationale || "목적이 아직 작성되지 않았습니다.")];
      const sections = [children];
      if (detail.rationale && detail.rationale !== detail.purpose) children.push(text(detail.rationale, { dimColor: true }));
      children = []; sections.push(children);
      children.push(text("준비하는 데이터", { bold: true, color: "cyan" }));
      if (!fixtures.length) children.push(text("미리 저장할 레코드는 없습니다."));
      for (const record of fixtures) children.push(text(`${record.object} · ${record.key}${record.ownership === "existing" ? " (기존 레코드 참조)" : " (이번 실행에서 준비)"}\n${Object.entries(record.fields).map(([field, value]) => `  ${field}: ${inputText(value)}`).join("\n") || "  필드 입력 없음"}`));
      children = []; sections.push(children);
      children.push(text("실제로 하는 동작", { bold: true, color: "cyan" }));
      if (detail.execution !== "tool") children.push(text(`${modes[detail.execution]}으로 직접 수행합니다. 도구가 대신 실행하지 않습니다.`));
      for (const action of detail.actions) {
        const verb = { insert: "새로 저장합니다", update: "수정해서 저장합니다", delete: "삭제합니다" }[action.verb];
        children.push(text(action.kind === "dml" ? `${action.object} 레코드 ${action.recordKeys.length}개를 ${verb}.` : action.kind === "batch" ? `${action.className} Batch를 시작합니다.` : action.kind === "service" ? `${action.className}.${action.method}를 호출합니다.` : "아래 상세에 있는 승인된 Anonymous Apex를 실행합니다."));
        for (const key of action.recordKeys || []) {
          const input = plan.records.find((r) => r.key === key);
          const fields = action.kind === "dml" && action.verb === "insert" ? action.fieldOverrides?.[key] ?? input?.fields ?? {} : action.fieldOverrides?.[key] || {};
          for (const [field, value] of Object.entries(fields)) children.push(text(`  ${key} · ${field}: ${action.verb === "update" && input?.fields[field] ? inputText(input.fields[field]) + " → " : ""}${inputText(value)}`));
        }
        if (action.args?.length) children.push(text(`  전달값: ${action.args.map((a) => inputText(a.value)).join(" / ")}`));
        if (action.impact.externalEffects.length) children.push(text(`! 외부 영향: ${action.impact.externalEffects.join(" / ")}`, { color: "yellow" }));
        if (action.impact.existingRecordIds.length) children.push(text(`! 기존 데이터 ${action.impact.existingRecordIds.length}건에도 영향이 있습니다. 기술 상세를 확인하세요.`, { color: "yellow" }));
      }
      children = []; sections.push(children);
      children.push(text("기대하는 결과", { bold: true, color: "cyan" }));
      if (!expectations.length) children.push(text("자동 비교 조건이 없습니다. 성공으로 판정하지 않습니다."));
      for (const expectation of expectations) children.push(text(`• ${expectation.label}: ${expectationText(expectation)}`));
      return compact ? column(sections[Math.min(storyStep, 3)]) : card(sections.flat());
    };
    if (tab === "plan" || tab === "results") {
      const list = tab === "plan" ? plan.scenarios : selected;
      const detail = list.find((s) => s.id === detailId);
      if (!detail) {
        if (!compact && tab === "results") {
          const matches = run.assertions.filter((a) => a.status === "MATCH").length;
          const mismatches = run.assertions.filter((a) => a.status === "MISMATCH").length;
          const unknown = run.assertions.filter((a) => a.status === "UNVERIFIABLE").length;
          content.push(text(`✓ 일치 ${matches}  ≠ 불일치 ${mismatches}  ? 확인 필요 ${unknown}`, { bold: true }));
        } else if (!compact) content.push(text(`실행할 시나리오 ${selected.length}개 선택`, { bold: true }));
        const smallPane = (e.props?.scroll?.bodyRows || 24) < 18;
        const perPage = compact ? 1 : smallPane ? 3 : 5;
        if (!smallPane) content.push(text("제목을 누르면 준비·동작·기대 결과를 볼 수 있습니다.", { dimColor: true }));
        const safePage = Math.min(listPage, Math.max(0, Math.ceil(list.length / perPage) - 1));
        const page = list.slice(safePage * perPage, safePage * perPage + perPage);
        for (const scenario of page) content.push(row([
          ...(tab === "plan" ? [button(`select-${scenario.id}`, scenario.selected ? "☑" : "□", () => dispatch("select", { scenarioIds: plan.scenarios.filter((s) => s.id === scenario.id ? !s.selected : s.selected).map((s) => s.id) }), !!capability && !unresolved)] : []),
          button(`scenario-${scenario.id}`, scenario.title, () => openDetail(scenario.id)),
          ...(!compact ? [text(tab === "results" ? scenarioStatus(scenario) : modes[scenario.execution], { dimColor: true })] : []),
        ]));
        if (compact && page.length) content.push(text(`${scenarioStatus(page[0])} · ${modes[page[0].execution]}`, { dimColor: true }));
        if (!list.length) content.push(text("계획 화면에서 시나리오를 선택하세요."));
        if (list.length > perPage) content.push(row([button("list-prev", "이전", () => { listPage = safePage - 1; redraw(); }, safePage > 0), text(`${safePage + 1}/${Math.ceil(list.length / perPage)}`), button("list-next", "다음", () => { listPage = safePage + 1; redraw(); }, (safePage + 1) * perPage < list.length)]));
      } else {
        const index = list.findIndex((s) => s.id === detail.id);
        content.push(row([button("scenario-back", "‹ 목록", () => { detailId = undefined; showPlanDetails = false; redraw(); }),
          ...(compact ? [button("story-next", storyStep === 4 ? "설명 보기" : `설명 ${storyStep + 1}/4 ›`, () => { storyStep = storyStep === 4 ? 0 : (storyStep + 1) % 4; showPlanDetails = false; redraw(); }),
            ...(tab === "results" ? [button("story-results", "결과", () => { storyStep = 4; showPlanDetails = false; redraw(); })] : [])]
          : [text(`${index + 1}/${list.length}`, { dimColor: true }), button("scenario-next", "다음 시나리오 ›", () => openDetail(list[(index + 1) % list.length].id), list.length > 1)])]));
        if (!compact) content.push(text(`${detail.title} · ${scenarioStatus(detail)}`, { bold: true }));
        if (!compact || storyStep < 4) content.push(narrative(detail));
        if (tab === "results" && (!compact || storyStep === 4)) {
          const comparisons = comparisonRows(run).filter((r) => r.scenarioId === detail.id);
          const resultSize = compact ? 1 : 3;
          const page = comparisons.slice(resultPage * resultSize, resultPage * resultSize + resultSize);
          if (!page.length) content.push(text("아직 비교 결과가 없습니다. 상단의 테스트 시작 버튼으로 실행하세요."));
          for (const result of page) {
            content.push(text(`${result.label} · ${result.status}`, { bold: true, color: result.status === labels.MISMATCH ? "yellow" : "cyan" }));
            content.push(table(["실행 전", "실행 후", "기대 결과"], [[valueText(result.before), valueText(result.actual), result.expected]]));
            if (result.status !== labels.MATCH) content.push(text(result.message, { dimColor: true }));
            if (showPlanDetails && result.evidence) content.push(text(`근거: ${result.evidence}`, { dimColor: true }));
          }
          if (comparisons.length > resultSize) content.push(row([button("previous-results", "이전 결과", () => { resultPage--; redraw(); }, resultPage > 0), text(`${resultPage + 1}/${Math.ceil(comparisons.length / resultSize)}`), button("next-results", "다음 결과", () => { resultPage++; redraw(); }, (resultPage + 1) * resultSize < comparisons.length)]));
          const state = run.scenarios[detail.id];
          if (state?.message) content.push(text(state.message));
          for (const job of state?.jobs || []) content.push(text(`Job ${job.status} · 처리 ${job.processed}/${job.total} · 오류 ${job.errors}${showPlanDetails ? " · " + job.id : ""}`));
          if (detail.execution !== "tool") content.push(text("사람 실행을 마치면 Claude에게 실행 사용자·시각·실제 ID를 알려주세요."));
        }
        content.push(button("plan-detail", `${showPlanDetails ? "▾" : "▸"} 코드·스크립트·기술 상세`, () => { showPlanDetails = !showPlanDetails; redraw(); }));
        if (showPlanDetails) content.push(technical(detail));
      }
      if (!compact || showContext) content.push(button("advanced", `${showAdvanced ? "▾" : "▸"} 단계별 실행·기타`, () => { showAdvanced = !showAdvanced; redraw(); }));
      if (showAdvanced) {
        content.push(row([button("prepare", "준비만", () => dispatch("prepare"), approved(run) && !!capability && !unresolved), button("execute", "실행만", () => dispatch("execute"), approved(run) && !!capability && !unresolved), button("collect", "결과 다시 조회", () => dispatch("collect"), !!capability)]));
        content.push(row([button("pause", run.paused ? "재개" : "중단", () => dispatch(run.paused ? "resume" : "pause"), !!capability), button("rerun", "새 실행 만들기", () => dispatch("rerun"), !!capability && !unresolved)]));
        content.push(text("단계별 작업도 선택한 전체 시나리오에 적용됩니다. 패널 닫기는 Salesforce Job을 취소하지 않습니다.", { dimColor: true }));
      }
    }
    if (tab === "finish") {
      content.push(text("검토를 마치고 데이터 처리 방법을 선택하세요.", { bold: true }));
      content.push(Select({ key: "verdict", label: "판정", value: verdict, options: [{ value: "accepted", label: "검토 완료" }, { value: "rejected", label: "수정 필요" }, { value: "needs-review", label: "추가 확인" }], onSelect: (value) => { verdict = value; redraw(); } }));
      content.push(button("save-review", "판정 저장", () => dispatch("review", { verdict, notes }), !!capability));
      content.push(row([button("keep", "데이터 보존", () => dispatch("keep"), !!capability), button("cleanup-preview", "데이터 정리…", () => dispatch("cleanup-preview"), !!capability)]));
      content.push(text(`데이터: ${{ pending: "선택 대기", kept: "보존됨", complete: "정리 완료", partial: "일부 정리 · 남은 항목 확인", "needs-review": "확인 필요" }[run.cleanup.status]} · 남은 추적 레코드 ${Object.values(run.bindings).filter((b) => !b.deleted).length}건`, { dimColor: true }));
      if (view.cleanupPreview) {
        content.push(table(["레코드", "실제 ID", "현재 상태"], view.cleanupPreview.records.map((r) => [`${r.key} (${r.object})`, r.id, r.conflict ? `충돌: ${r.reason}` : "정리 대상"])));
        if (view.cleanupPreview.conflicts.length) content.push(text("충돌이 있어 정리를 진행하지 않습니다. 원인을 확인하세요."));
        else if (view.cleanupPreview.records.length) {
          const cleanupKey = `${stateKey}:${view.cleanupPreview.detailsHash}`;
          content.push(row([button("cleanup-check", `${cleanupChecked === cleanupKey ? "☑" : "□"} 삭제 대상 확인`, () => { cleanupChecked = cleanupChecked === cleanupKey ? "" : cleanupKey; redraw(); }), button("cleanup", "정리 실행", () => dispatch("cleanup"), cleanupChecked === cleanupKey && !!capability && !unresolved)]));
        }
      }
      for (const result of run.cleanup.results.filter((r) => !r.success)) content.push(text(`${result.key}: ${result.error || "정리 확인 필요"}`));
      content.push(button("reports", "MD · Excel 만들기", () => dispatch("reports"), !!capability));
      if (view.files?.length) content.push(column(view.files.map((file) => text(file, { dimColor: true }))));
      content.push(button("finish-more", `${showFinishMore ? "▾" : "▸"} 메모·실행 기록·상세 도구`, () => { showFinishMore = !showFinishMore; redraw(); }));
      if (showFinishMore) {
        content.push(Input({ key: "review-notes", label: "검토 메모", value: notes, onInput: (value) => { notes = value; }, onSubmit: (value) => { notes = value; redraw(); } }));
        if (view.runs?.length) content.push(Select({ key: "run-picker", label: "이전 실행", value: run.run_id, options: view.runs.map((r) => ({ value: r.run_id, label: `${r.run_id} · ${r.status}` })), onSelect: (value) => refresh($, value) }));
        if (run.aiNotes.length) content.push(text(`AI 의견 (증거와 별도): ${run.aiNotes[run.aiNotes.length - 1].text}`));
        content.push(text("대량 편집·Excel·Import·기존 데이터 예외 승인은 Claude에게 상세 도구를 요청하세요.", { dimColor: true }));
      }
    }
    if (!compact) content.push(text("Tab 이동 · Enter 선택 · Esc 대화", { dimColor: true }));
    return column(content);
  });
}
