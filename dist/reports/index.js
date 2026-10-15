import ExcelJS from "exceljs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { redact as redactCredentialText } from "../core/errors.js";
import { exportPlanWorkbook, styleSheet } from "../workbook/index.js";
import { orgEnvironmentLabel } from "../core/org-policy.js";
const statuses = {
    MATCH: "일치",
    MISMATCH: "불일치",
    UNVERIFIABLE: "확인 불가",
    NOT_EXECUTED: "미실행",
};
const text = (v) => v === undefined
    ? "수집하지 않음"
    : typeof v === "string"
        ? v
        : JSON.stringify(v);
const md = (v) => text(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([`*_[\]\\])/g, "\\$1");
const secretKey = /^(?:access_?token|refresh_?token|session_?id|password|authorization|client_?secret)$/i;
function redact(value) {
    if (typeof value === "string")
        return redactCredentialText(value)
            .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [삭제됨]")
            .replace(/(?:access_token|refresh_token|password|client_secret)\s*[=:]\s*[^\s,;]+/gi, "인증정보=[삭제됨]");
    if (Array.isArray(value))
        return value.map(redact);
    if (value && typeof value === "object")
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [
            k,
            secretKey.test(k) ? "[삭제됨]" : redact(v),
        ]));
    return value;
}
const input = (v) => !v
    ? "필드 없음"
    : v.kind === "omit"
        ? "필드 생략"
        : v.kind === "null"
            ? "null"
            : v.kind === "ref"
                ? `논리키 참조: ${v.key}`
                : `값: ${text(v.value)}`;
function safeCell(value) {
    const result = text(redact(value));
    return result.length > 30000
        ? `${result.slice(0, 1000)}\n[전체 값: evidence/report-details.json]`
        : result;
}
function addSheet(book, name, headers, rows, widths) {
    const sheet = book.addWorksheet(name);
    sheet.addRow(headers);
    for (const row of rows)
        sheet.addRow(row.map(safeCell));
    styleSheet(sheet, widths);
    return sheet;
}
/** Deterministic factual report; never fills evidence gaps with AI prose. */
export async function generateReports(inputRun, outputDir) {
    const run = redact(inputRun);
    await mkdir(path.join(outputDir, "evidence"), { recursive: true });
    const markdownPath = path.join(outputDir, "test-report.md"), workbookPath = path.join(outputDir, "test-results.xlsx"), evidencePath = path.join(outputDir, "evidence", "report-details.json");
    const plan = run.plan;
    const environment = run.mode === "fake"
        ? "오프라인 시뮬레이션 — 실제 Salesforce Org 검증 증거가 아닙니다."
        : "실제 Salesforce Org에서 수집한 증거입니다. 수집하지 않은 값과 실행 여부는 추정하지 않습니다.";
    const review = run.review
        ? `${run.review.verdict} (${run.review.actor}, ${run.review.at}) — ${run.review.notes}`
        : "개발자 검토 대기";
    const lines = [
        `# Salesforce 테스트 보고서`,
        "",
        environment,
        "",
        `실행 ${md(run.run_id)}${run.parent_run_id ? `은 이전 실행 ${md(run.parent_run_id)}에서 새로 생성되었습니다` : ""}. 생성 시각은 ${md(run.createdAt)}이며 현재 상태는 ${md(run.status)}입니다. 개발자 최종 판정: ${md(review)}.`,
        "",
        "자동 비교는 승인한 조건의 실제값 비교입니다. 기대 결과는 로컬 코드 분석 기반 초안에서 개발자가 검토한 값이며, 값이 일치해도 업무 요구사항의 완전한 정확성을 보증하지 않습니다.",
    ];
    if (plan) {
        lines.push("", `대상은 ${md(plan.org.name)} (${md(plan.org.orgId)}), 실행 사용자는 ${md(plan.org.username)}입니다. 계획 ${md(plan.plan_id)} 버전 ${plan.version}, 해시 ${md(plan.hash)}를 사용합니다.`, `Org 유형: ${md(orgEnvironmentLabel(plan.org))}. OrganizationType: ${md(plan.org.organizationType ?? "기록 없음")}.`, "", `코드 분석 기준은 현재 로컬 소스 스냅샷 ${md(plan.source.hash)}입니다. Git 커밋 ${md(plan.source.gitCommit ?? "없음")}, 미커밋 변경 ${plan.source.dirty ? "있음" : "없음"}. 선택 범위: ${md(plan.source.selection)}.`, "", `배포본 확인: ${run.sourceCheck ? `${run.sourceCheck.matches ? "확인 범위 일치" : "불일치 또는 확인 실패"} (${md(run.sourceCheck.at)})` : "확인 결과 없음"}. 확인한 파일만 이 정보에 포함되며 Org 전체 동일성을 보증하지 않습니다.`);
        for (const file of plan.source.files)
            lines.push(`- ${md(file.path)} / ${md(file.name)} / API ${md(file.apiVersion)} / 해시 ${md(file.hash)}`);
        for (const s of plan.scenarios) {
            const state = run.scenarios[s.id];
            const assertions = run.assertions.filter((a) => a.scenarioId === s.id);
            const records = plan.records.filter((r) => r.scenarioId === s.id);
            lines.push("", `## ${md(s.title)} (${md(s.id)})`, "", `목적은 ${md(s.purpose)}입니다. 추천 근거는 ${md(s.rationale)}입니다. ${s.selected ? "선택한" : "선택하지 않은"} 시나리오이며 실행 경로는 ${md(s.execution)}입니다.`, "", `현재 실행 상태: ${md(state?.status ?? "미실행")}${state?.message ? `. ${md(state.message)}` : ""}. 준비 입력 ${records.filter((r) => r.stage === "fixture").length}건, 동작 입력 ${records.filter((r) => r.stage === "action").length}건을 계획했습니다.`);
            for (const action of s.actions)
                if (Object.keys(action.fieldOverrides).length)
                    lines.push("", `동작 ${md(action.id)}의 승인 입력 재정의는 ${md(action.fieldOverrides)}입니다. 준비 입력과 구분해서 적용합니다.`);
            if (state?.humanReport)
                lines.push("", `${md(state.humanReport.actor)} 사용자가 ${md(state.humanReport.path)} 경로로 실행했다고 보고했습니다. 사용자 기재 실행 시각: ${md(state.humanReport.executedAt ?? "확인 불가")}. 완료 보고 수신 시각: ${md(state.humanReport.at)}. ${state.humanReport.actor !== plan.org.username ? "보고한 실행 사용자와 승인한 인증 사용자 표기가 다릅니다. " : ""}이 보고 자체는 DB 저장 증거가 아닙니다. 메모: ${md(state.humanReport.notes)}.`);
            const operations = run.operations.filter((op) => op.scenarioId === s.id);
            for (const op of operations)
                lines.push("", `작업 ${md(op.op_id)} (${md(op.phase)})은 ${md(op.startedAt)}에 시작되었고 전달·결과 상태는 ${md(op.state)}입니다.${op.error ? ` 오류: ${md(op.error)}.` : ""}${op.jobId ? ` 등록된 Job ID: ${md(op.jobId)}.` : ""}`);
            if (!operations.length && !state?.humanReport)
                lines.push("실행 요청 또는 사람 실행 보고가 기록되지 않았습니다.");
            for (const r of records) {
                const before = state?.baseline[r.key], after = state?.after[r.key], binding = run.bindings[r.key];
                lines.push("", `레코드 ${md(r.key)} (${md(r.object)}, ${r.stage === "fixture" ? "준비" : "테스트 동작"})의 실제 ID는 ${md(binding?.id ?? "연결되지 않음")}입니다. 승인 입력은 ${md(r.fields)}입니다. Org 재조회 실행 직전 값은 ${md(before)}이며 실행 후 조회 값은 ${md(after)}입니다.`);
            }
            if (!assertions.length)
                lines.push("", "자동 비교 결과가 없습니다. 빈 검사 목록을 일치로 판정하지 않습니다.");
            for (const a of assertions)
                lines.push("", `검사 ${md(a.assertionId)}는 **${statuses[a.status]}**입니다. 기대값: ${md(a.expected)}. 실제값: ${md(a.actual)}. 실행 전 값: ${md(a.before)}. ${md(a.message)}${a.evidenceRef ? ` 증거: ${md(a.evidenceRef)}.` : ""}`);
            for (const job of state?.jobs ?? [])
                lines.push("", `비동기 작업 ${md(job.id)} 상태는 ${md(job.status)}입니다. 처리 ${job.processed}/${job.total}, 오류 ${job.errors}, 완료 여부 ${job.done ? "확인" : "미확인"}. Job 등록·완료와 업무 결과 일치는 별개입니다.`);
            if (state && Object.keys(state.manualObservations).length)
                lines.push("", `수동 관찰 (DB 조회 증거와 구분): ${md(state.manualObservations)}.`);
        }
    }
    lines.push("", "## AI 분석 메모", "");
    if (run.aiNotes.length)
        for (const note of run.aiNotes)
            lines.push(`${md(note.at)}: ${md(note.text)} (근거: ${md(note.evidenceRefs.join(", "))})`, "");
    else
        lines.push("추가된 AI 분석이 없습니다. 이 문서의 사실 부분은 저장된 실행 증거로 생성했습니다.");
    lines.push("", "## 개발자 검토와 정리", "", `개발자 판정: ${md(review)}.`, "", `데이터 처리 선택: ${run.cleanup.decision === "pending" ? "보존 또는 정리 선택 대기" : run.cleanup.decision === "keep" ? "보존" : "정리"}. 정리 상태: ${md(run.cleanup.status)}. 사용자가 선택하기 전에는 자동 삭제하지 않습니다.`);
    for (const c of run.cleanup.results)
        lines.push(`- ${md(c.key)} / ${md(c.id)}: ${c.success ? "삭제 확인" : `실패 또는 확인 필요 — ${md(c.error)}`}`);
    const remaining = Object.values(run.bindings).filter((b) => !b.deleted);
    lines.push("", `남은 연결 레코드는 ${remaining.length}건입니다. 정리는 완전한 트랜잭션 롤백이 아니며 이미 전달된 통지나 외부 영향까지 취소하지 않습니다.`);
    for (const b of remaining)
        lines.push(`- ${md(b.key)} / ${md(b.object)} / ${md(b.id)} / ${md(b.ownership)}${b.runId !== run.run_id ? " / 다른 실행 소유" : ""}`);
    lines.push("", "세 시점(승인 입력, Org 재조회 실행 직전 값, 실행 후 조회 값)은 별도로 기록했습니다. 상세 구조화 증거는 evidence/report-details.json, 입력과 비교 표는 test-results.xlsx를 확인하세요.");
    await writeFile(markdownPath, lines.join("\n"), "utf8");
    await writeFile(evidencePath, JSON.stringify({
        run_id: run.run_id,
        mode: run.mode,
        plan,
        approvals: run.approvals,
        operations: run.operations,
        bindings: run.bindings,
        scenarios: run.scenarios,
        assertions: run.assertions,
        aiNotes: run.aiNotes,
        review: run.review,
        cleanup: run.cleanup,
        sourceCheck: run.sourceCheck,
    }, null, 2), "utf8");
    const book = new ExcelJS.Workbook();
    book.creator = "Salesforce Sandbox Workbench";
    addSheet(book, "요약", ["항목", "내용"], [
        ["환경", environment],
        ["실행 ID", run.run_id],
        ["상태", run.status],
        [
            "계획",
            plan ? `${plan.plan_id} / ${plan.version} / ${plan.hash}` : "없음",
        ],
        ["대상 Org", plan?.org.orgId],
        ["Org 유형", orgEnvironmentLabel(plan?.org)],
        ["실행 사용자", plan?.org.username],
        ["최종 판정", review],
        ["정리 선택", run.cleanup.decision],
        ["정리 상태", run.cleanup.status],
        ["기대값 안내", "로컬 코드 분석 기반 초안을 개발자가 검토·승인합니다."],
        ["상세 증거", "evidence/report-details.json"],
    ], [26, 110]);
    addSheet(book, "시나리오", [
        "ID",
        "제목",
        "목적",
        "선택",
        "실행 방식",
        "상태",
        "사람 실행 보고",
        "수동 관찰",
    ], plan?.scenarios.map((s) => [
        s.id,
        s.title,
        s.purpose,
        s.selected,
        s.execution,
        run.scenarios[s.id]?.status ?? "미실행",
        run.scenarios[s.id]?.humanReport,
        run.scenarios[s.id]?.manualObservations,
    ]) ?? []);
    const values = [];
    for (const r of plan?.records ?? []) {
        const state = run.scenarios[r.scenarioId];
        const before = state?.baseline[r.key], after = state?.after[r.key];
        const fields = [
            ...new Set([
                ...Object.keys(r.fields),
                ...Object.keys(before ?? {}),
                ...Object.keys(after ?? {}),
            ]),
        ].sort();
        for (const field of fields) {
            const expected = plan?.expectations
                .filter((e) => e.subject.kind === "record" &&
                e.subject.key === r.key &&
                e.subject.field === field)
                .map((e) => ({ id: e.id, operator: e.operator, expected: e.expected }));
            const results = run.assertions.filter((a) => expected?.some((e) => e.id === a.assertionId));
            values.push([
                r.scenarioId,
                r.key,
                r.object,
                r.stage,
                run.bindings[r.key]?.id ?? "연결되지 않음",
                field,
                input(r.fields[field]),
                before && Object.hasOwn(before, field)
                    ? before[field]
                    : "수집하지 않음",
                after && Object.hasOwn(after, field) ? after[field] : "수집하지 않음",
                expected,
                results.map((x) => ({
                    status: statuses[x.status],
                    message: x.message,
                })),
            ]);
        }
    }
    for (const scenario of plan?.scenarios ?? [])
        for (const action of scenario.actions)
            for (const [key, fields] of Object.entries(action.fieldOverrides)) {
                const record = plan.records.find((r) => r.key === key);
                const state = run.scenarios[scenario.id];
                for (const [field, value] of Object.entries(fields)) {
                    const expectations = plan.expectations
                        .filter((e) => e.subject.kind === "record" &&
                        e.subject.key === key &&
                        e.subject.field === field)
                        .map((e) => ({
                        id: e.id,
                        operator: e.operator,
                        expected: e.expected,
                    }));
                    values.push([
                        scenario.id,
                        key,
                        record?.object,
                        `action:${action.id}`,
                        run.bindings[key]?.id ?? "연결되지 않음",
                        field,
                        input(value),
                        state?.baseline[key]?.[field],
                        state?.after[key]?.[field],
                        expectations,
                        run.assertions
                            .filter((a) => expectations.some((e) => e.id === a.assertionId))
                            .map((a) => ({ status: statuses[a.status], message: a.message })),
                    ]);
                }
            }
    addSheet(book, "승인동작", [
        "시나리오",
        "동작 ID",
        "종류",
        "DML",
        "대상 논리키",
        "동작 입력 재정의",
        "실제 스크립트 또는 호출",
        "영향 범위",
    ], plan?.scenarios.flatMap((s) => s.actions.map((a) => [
        s.id,
        a.id,
        a.kind,
        a.verb,
        a.recordKeys,
        a.fieldOverrides,
        a.script || {
            className: a.className,
            method: a.method,
            args: a.args,
            constructorArgs: a.constructorArgs,
            scopeSize: a.scopeSize,
        },
        a.impact,
    ])) ?? [], [22, 24, 20, 18, 35, 60, 80, 70]);
    addSheet(book, "입력_전후_기대", [
        "시나리오",
        "논리키",
        "오브젝트",
        "단계",
        "실제 ID",
        "필드",
        "승인 입력",
        "실행 직전 재조회",
        "실행 후 조회",
        "기대조건",
        "차이·비교",
    ], values, [22, 24, 24, 16, 24, 28, 50, 50, 50, 60, 60]);
    addSheet(book, "비교결과", [
        "시나리오",
        "검사 ID",
        "결과",
        "기대값",
        "실제값",
        "실행 전 값",
        "설명",
        "증거 경로",
    ], run.assertions.map((a) => [
        a.scenarioId,
        a.assertionId,
        statuses[a.status],
        a.expected,
        a.actual,
        a.before,
        a.message,
        a.evidenceRef,
    ]), [22, 24, 18, 40, 40, 40, 70, 50]);
    addSheet(book, "작업이력", [
        "작업 ID",
        "시나리오",
        "단계",
        "계획 버전",
        "전달 상태",
        "시작",
        "종료",
        "Job ID",
        "오류",
        "증거 경로",
    ], run.operations.map((o) => [
        o.op_id,
        o.scenarioId,
        o.phase,
        o.planVersion,
        o.state,
        o.startedAt,
        o.endedAt,
        o.jobId,
        o.error,
        "evidence/report-details.json",
    ]));
    addSheet(book, "비동기", [
        "시나리오",
        "Job ID",
        "등록 후 상태",
        "완료",
        "오류 수",
        "처리 수",
        "전체 수",
        "상세 상태",
    ], Object.entries(run.scenarios).flatMap(([id, s]) => s.jobs.map((j) => [
        id,
        j.id,
        j.status,
        j.done,
        j.errors,
        j.processed,
        j.total,
        j.extendedStatus,
    ])));
    addSheet(book, "ID_정리", [
        "논리키",
        "오브젝트",
        "실제 ID",
        "소유 구분",
        "소유 실행",
        "연결 근거",
        "삭제됨",
        "정리 결과",
    ], Object.values(run.bindings).map((b) => [
        b.key,
        b.object,
        b.id,
        b.ownership,
        b.runId,
        b.proof,
        b.deleted ?? false,
        run.cleanup.results.filter((c) => c.key === b.key),
    ]));
    addSheet(book, "AI_개발자", ["구분", "시각", "내용", "근거·판정"], [
        ...run.aiNotes.map((n) => ["AI 의견", n.at, n.text, n.evidenceRefs]),
        [
            "개발자 판정",
            run.review?.at,
            run.review?.notes ?? "개발자 검토 대기",
            run.review?.verdict ?? "검토 대기",
        ],
    ], [22, 28, 100, 70]);
    await book.xlsx.writeFile(workbookPath);
    let planPath;
    if (plan) {
        planPath = path.join(outputDir, "test-plan.xlsx");
        await exportPlanWorkbook(plan, planPath);
    }
    return {
        markdownPath,
        workbookPath,
        ...(planPath ? { planPath } : {}),
        evidencePath,
    };
}
