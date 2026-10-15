import ExcelJS from "exceljs";
import yauzl from "yauzl";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { PlanSchema, Identifier, Key, } from "../core/model.js";
const MAX_FILE = 20 * 1024 * 1024;
const MAX_INFLATED = 100 * 1024 * 1024;
const systemColumns = [
    "논리키",
    "시나리오",
    "소유구분",
    "기존ID",
    "의존논리키(JSON)",
    "의도한오류",
];
const scenarioColumns = [
    "ID",
    "제목",
    "목적",
    "추천근거",
    "선택",
    "실행방식",
    "의존시나리오(JSON)",
    "소스근거(JSON)",
    "동작(JSON)",
    "전제조건(JSON)",
    "관찰조건(JSON)",
];
const expectationColumns = [
    "ID",
    "시나리오",
    "설명",
    "대상(JSON)",
    "연산자",
    "기대값(JSON)",
    "허용오차",
    "순서무시",
    "값타입",
    "시간대",
];
const stable = (value) => JSON.stringify(value, (_key, val) => val && typeof val === "object" && !Array.isArray(val)
    ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
    : val);
const same = (a, b) => stable(a) === stable(b);
export function newRecordKey() {
    return `new_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}
function groups(plan) {
    return [...new Set(plan.records.map((r) => `${r.stage}:${r.object}`))]
        .sort()
        .map((key, i) => ({
        key,
        name: `입력_${i + 1}`,
        stage: key.split(":")[0],
        object: key.split(":")[1],
    }));
}
function actionGroups(plan) {
    return plan.scenarios
        .flatMap((s) => s.actions
        .filter((a) => a.kind === "dml" &&
        a.verb !== "delete" &&
        (a.verb === "update" || Object.keys(a.fieldOverrides).length > 0))
        .map((a) => ({
        actionId: a.id,
        scenarioId: s.id,
        object: a.object,
        action: a,
    })))
        .map((g, i) => ({ ...g, name: `동작_${i + 1}` }));
}
function contract(plan) {
    return stable({
        format: 1,
        plan_id: plan.plan_id,
        version: plan.version,
        hash: plan.hash,
        source: plan.source.hash,
        orgId: plan.org.orgId,
        username: plan.org.username,
        sheets: groups(plan),
        actionSheets: actionGroups(plan).map(({ action, ...g }) => g),
    });
}
export function styleSheet(sheet, widths) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF163C57" },
    };
    sheet.getRow(1).height = 28;
    sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: {
            row: Math.max(1, sheet.rowCount),
            column: Math.max(1, sheet.columnCount),
        },
    };
    sheet.columns.forEach((col, i) => {
        col.width = widths?.[i] ?? 26;
        col.numFmt = "@";
    });
    sheet.eachRow((row) => row.eachCell((cell) => {
        cell.alignment = { vertical: "top", wrapText: true };
    }));
}
function display(input) {
    if (!input || input.kind === "omit" || input.kind === "null")
        return "";
    if (input.kind === "ref")
        return JSON.stringify({ $ref: input.key });
    return typeof input.value === "object"
        ? JSON.stringify(input.value)
        : input.value;
}
function scalar(cell) {
    const v = cell.value;
    if (v === undefined || v === null)
        return null;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
        return v;
    if (v instanceof Date)
        throw new Error(`${cell.address}: 날짜 자동 변환을 허용하지 않습니다. ISO 문자열을 텍스트 셀에 입력하세요.`);
    throw new Error(`${cell.address}: 수식, 링크, 오류, 서식 텍스트 셀은 입력으로 사용할 수 없습니다.`);
}
function string(cell) {
    const v = scalar(cell);
    return v === null ? "" : String(v);
}
function json(cell, fallback) {
    const value = string(cell);
    if (!value && fallback !== undefined)
        return fallback;
    try {
        return JSON.parse(value);
    }
    catch {
        throw new Error(`${cell.address}: 올바른 JSON 값을 입력하세요.`);
    }
}
function bool(cell) {
    const value = scalar(cell);
    if (value === true || value === "true")
        return true;
    if (value === false || value === "false")
        return false;
    throw new Error(`${cell.address}: true 또는 false가 필요합니다.`);
}
function requiredSheet(book, name, headers) {
    const sheet = book.getWorksheet(name);
    if (!sheet)
        throw new Error(`필수 시트가 없습니다: ${name}`);
    headers.forEach((h, i) => {
        if (string(sheet.getRow(1).getCell(i + 1)) !== h)
            throw new Error(`${name}: 열 이름을 변경할 수 없습니다 (${h}).`);
    });
    return sheet;
}
export async function exportPlanWorkbook(plan, outputPath) {
    PlanSchema.parse(plan);
    const book = new ExcelJS.Workbook();
    book.creator = "Salesforce Sandbox Workbench";
    const guide = book.addWorksheet("사용안내");
    guide.addRows([
        ["항목", "내용"],
        [
            "형식",
            "워크벤치에서 내보낸 .xlsx만 재불러올 수 있습니다. 관리 열은 Salesforce에 업로드되지 않습니다.",
        ],
        ["계획", `${plan.plan_id} / 버전 ${plan.version} / ${plan.hash}`],
        [
            "실행환경",
            plan.org.mode === "fake"
                ? "오프라인 시뮬레이션 — 실제 Org 증거 아님"
                : `${plan.org.name} (${plan.org.orgId})`,
        ],
        [
            "기대값",
            "로컬 코드 분석 기반 초안입니다. 개발자가 업무 요구사항과 비교하여 수정·승인하세요.",
        ],
        [
            "입력 편집",
            "값을 수정하고 행을 정렬·추가·삭제할 수 있습니다. 기존 논리키는 유지하세요. 복제할 행은 논리키를 비우면 새 키를 발급합니다.",
        ],
        [
            "빈칸",
            "기존 빈칸은 기존 null/생략/빈 문자열을 보존합니다. 값을 지운 빈칸은 재불러오기 검토에서 유지/생략/지우기/빈 문자열을 선택합니다.",
        ],
        [
            "관계",
            '관계 값은 {"$ref":"논리키"} JSON으로 표현합니다. 기존 Salesforce ID와 소유구분은 여기서 바꿀 수 없습니다.',
        ],
        [
            "타입",
            "문자열·ID·우편번호·소수·날짜는 텍스트로 유지합니다. 수식·매크로·외부 링크는 거부합니다.",
        ],
        [
            "새 필드 타입",
            '기존 열의 타입을 따릅니다. 새로운 열은 문자열이며, Boolean/Number/JSON 타입은 {"$value":값}으로 명시할 수 있습니다.',
        ],
        [
            "새 행",
            "기존 오브젝트/단계 시트에 행을 추가합니다. 시나리오와 소유구분(created), 의도한오류(true/false)를 입력하세요.",
        ],
        [
            "승인",
            "Excel은 승인을 전달하지 않습니다. 재불러온 모든 변경은 엔진에서 검증하고 새 계획으로 재승인합니다.",
        ],
        [
            "실행 동작",
            "Action recordKeys 등 JSON 참조도 함께 갱신해야 합니다. 자동으로 동작 대상이 확대되지 않습니다.",
        ],
    ]);
    styleSheet(guide, [24, 115]);
    const sc = book.addWorksheet("시나리오");
    sc.addRow(scenarioColumns);
    for (const s of plan.scenarios)
        sc.addRow([
            s.id,
            s.title,
            s.purpose,
            s.rationale,
            s.selected,
            s.execution,
            JSON.stringify(s.dependsOn),
            JSON.stringify(s.sourceRefs),
            JSON.stringify(s.actions),
            JSON.stringify(s.preconditions),
            JSON.stringify(s.observation),
        ]);
    styleSheet(sc, [22, 35, 42, 50, 12, 20, 30, 45, 70, 50, 50]);
    for (const g of groups(plan)) {
        const rows = plan.records.filter((r) => r.stage === g.stage && r.object === g.object);
        const fields = [
            ...new Set(rows.flatMap((r) => Object.keys(r.fields))),
        ].sort();
        const sheet = book.addWorksheet(g.name);
        sheet.addRow([...systemColumns, ...fields]);
        for (const r of rows)
            sheet.addRow([
                r.key,
                r.scenarioId,
                r.ownership,
                r.existingId ?? "",
                JSON.stringify(r.dependsOn),
                r.intentionalInvalid,
                ...fields.map((f) => display(r.fields[f])),
            ]);
        styleSheet(sheet);
        sheet.getRow(1).getCell(1).note =
            `${g.object} / ${g.stage === "fixture" ? "준비 입력" : "테스트 동작 입력"}`;
    }
    for (const g of actionGroups(plan)) {
        const effective = g.action.recordKeys.map((key) => ({
            key,
            fields: g.action.fieldOverrides[key] ??
                plan.records.find((r) => r.key === key).fields,
        }));
        const fields = [
            ...new Set(effective.flatMap((r) => Object.keys(r.fields))),
        ].sort();
        const sheet = book.addWorksheet(g.name);
        sheet.addRow(["동작ID", "논리키", "시나리오", ...fields]);
        for (const r of effective)
            sheet.addRow([
                g.actionId,
                r.key,
                g.scenarioId,
                ...fields.map((f) => display(r.fields[f])),
            ]);
        styleSheet(sheet);
        sheet.getCell("A1").note =
            `${g.object} / ${g.action.verb} 테스트 동작 입력. 준비 시트와 별도입니다.`;
    }
    const ex = book.addWorksheet("기대결과");
    ex.addRow(expectationColumns);
    for (const e of plan.expectations)
        ex.addRow([
            e.id,
            e.scenarioId,
            e.label,
            JSON.stringify(e.subject),
            e.operator,
            e.expected === undefined ? "" : JSON.stringify(e.expected),
            String(e.tolerance),
            e.unordered,
            e.valueType,
            e.timezone,
        ]);
    styleSheet(ex, [22, 22, 45, 60, 20, 50, 20, 16, 20, 24]);
    const refs = book.addWorksheet("참조안내");
    refs.addRow([
        "논리키",
        "오브젝트",
        "단계",
        "관계 논리키",
        "기존ID (읽기 전용)",
    ]);
    for (const r of plan.records)
        refs.addRow([
            r.key,
            r.object,
            r.stage,
            Object.values(r.fields)
                .filter((v) => v.kind === "ref")
                .map((v) => v.key)
                .join(", "),
            r.existingId ?? "",
        ]);
    styleSheet(refs);
    const meta = book.addWorksheet("_contract");
    meta.state = "veryHidden";
    meta.addRow(["contract", contract(plan)]);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await book.xlsx.writeFile(outputPath);
}
/** Inspect before ExcelJS allocation. No ZIP entry is extracted to disk. */
export async function inspectWorkbookFile(inputPath) {
    const stat = await lstat(inputPath);
    if (!stat.isFile() ||
        stat.isSymbolicLink() ||
        path.extname(inputPath).toLowerCase() !== ".xlsx" ||
        stat.size > MAX_FILE)
        throw new Error("20 MB 이하의 일반 .xlsx 파일만 허용합니다.");
    await new Promise((resolve, reject) => {
        yauzl.open(inputPath, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
            if (error || !zip) {
                reject(error ?? new Error("Excel ZIP을 열 수 없습니다."));
                return;
            }
            let total = 0, count = 0, finished = false;
            const fail = (err) => {
                if (!finished) {
                    finished = true;
                    zip.close();
                    reject(err);
                }
            };
            zip.on("error", fail);
            zip.on("end", () => {
                if (!finished) {
                    finished = true;
                    resolve();
                }
            });
            zip.on("entry", (entry) => {
                const n = entry.fileName;
                total += entry.uncompressedSize;
                count++;
                if (count > 5000 ||
                    total > MAX_INFLATED ||
                    entry.uncompressedSize > 25 * 1024 * 1024 ||
                    (entry.compressedSize > 0 &&
                        entry.uncompressedSize / entry.compressedSize > 1000) ||
                    /^(?:\/|[A-Za-z]:)|(?:^|\/)\.\.(?:\/|$)|\\/.test(n) ||
                    /vbaProject|externalLinks|embeddings|activeX|\.bin$/i.test(n) ||
                    entry.generalPurposeBitFlag & 1) {
                    fail(new Error("안전하지 않은 Excel ZIP 항목 또는 크기 제한 위반입니다."));
                    return;
                }
                if (!/\.(xml|rels)$/i.test(n)) {
                    zip.readEntry();
                    return;
                }
                zip.openReadStream(entry, (err, stream) => {
                    if (err || !stream) {
                        fail(err ?? new Error("ZIP 항목 오류"));
                        return;
                    }
                    const chunks = [];
                    let size = 0;
                    stream.on("data", (chunk) => {
                        size += chunk.length;
                        if (size > 25 * 1024 * 1024) {
                            stream.destroy();
                            fail(new Error("XML 크기 제한 위반"));
                            return;
                        }
                        chunks.push(chunk);
                    });
                    stream.on("error", fail);
                    stream.on("end", () => {
                        if (finished)
                            return;
                        const xml = Buffer.concat(chunks).toString("utf8");
                        if (/<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External|macroEnabled|vbaProject|<f(?:\s|>)/i.test(xml)) {
                            fail(new Error("수식·매크로·외부 링크·외부 엔티티가 있는 Excel은 허용하지 않습니다."));
                            return;
                        }
                        zip.readEntry();
                    });
                });
            });
            zip.readEntry();
        });
    });
}
function validateReferences(plan) {
    const parsed = PlanSchema.parse(plan);
    const unique = (keys, kind) => {
        if (new Set(keys).size !== keys.length)
            throw new Error(`${kind} 논리키/ID가 중복됩니다.`);
    };
    unique(parsed.records.map((r) => r.key), "레코드");
    unique(parsed.scenarios.map((s) => s.id), "시나리오");
    unique(parsed.expectations.map((e) => e.id), "기대결과");
    const keys = new Set(parsed.records.map((r) => r.key)), scenarios = new Set(parsed.scenarios.map((s) => s.id));
    for (const r of parsed.records) {
        if (!scenarios.has(r.scenarioId))
            throw new Error(`없는 시나리오: ${r.scenarioId}`);
        for (const k of [
            ...r.dependsOn,
            ...Object.values(r.fields)
                .filter((v) => v.kind === "ref")
                .map((v) => v.key),
        ])
            if (!keys.has(k))
                throw new Error(`${r.key}: 없는 레코드 참조 ${k}`);
    }
    for (const s of parsed.scenarios) {
        for (const key of s.dependsOn)
            if (!scenarios.has(key))
                throw new Error(`${s.id}: 없는 의존 시나리오 ${key}`);
        for (const a of s.actions)
            for (const key of a.recordKeys)
                if (!keys.has(key))
                    throw new Error(`${a.id}: 없는 동작 레코드 ${key}`);
    }
    for (const e of parsed.expectations) {
        if (!scenarios.has(e.scenarioId))
            throw new Error(`없는 기대결과 시나리오: ${e.scenarioId}`);
        if (e.subject.kind === "record" &&
            e.subject.key &&
            !keys.has(e.subject.key))
            throw new Error(`없는 기대결과 레코드: ${e.subject.key}`);
    }
    return parsed;
}
function inputFromCell(cell, old, sample) {
    const value = scalar(cell);
    if (value === null || value === "")
        return old ?? { kind: "omit" };
    if (old && same(value, display(old)))
        return structuredClone(old);
    if (typeof value === "string" && value.startsWith("{")) {
        try {
            const obj = JSON.parse(value);
            if (Object.keys(obj).length === 1 && typeof obj.$ref === "string")
                return { kind: "ref", key: Key.parse(obj.$ref) };
            if (Object.keys(obj).length === 1 && Object.hasOwn(obj, "$value"))
                return { kind: "value", value: obj.$value };
        }
        catch (error) {
            if (value.includes('"$ref"') || value.includes('"$value"'))
                throw error;
        }
    }
    const exemplar = old?.kind === "value" ? old : sample?.kind === "value" ? sample : undefined;
    if (exemplar && typeof exemplar.value === "number") {
        const n = Number(value);
        if (!Number.isFinite(n) || typeof value === "boolean")
            throw new Error(`${cell.address}: 숫자가 필요합니다.`);
        return { kind: "value", value: n };
    }
    if (exemplar && typeof exemplar.value === "boolean") {
        if (value === true || value === "true")
            return { kind: "value", value: true };
        if (value === false || value === "false")
            return { kind: "value", value: false };
        throw new Error(`${cell.address}: true/false가 필요합니다.`);
    }
    if (exemplar && typeof exemplar.value === "object") {
        if (typeof value !== "string")
            throw new Error(`${cell.address}: JSON이 필요합니다.`);
        return { kind: "value", value: JSON.parse(value) };
    }
    return { kind: "value", value: String(value) };
}
export function planChanges(original, updated) {
    const changes = [];
    for (const collection of ["scenarios", "records", "expectations"]) {
        const old = new Map(original[collection].map((x) => ["key" in x ? x.key : x.id, x]));
        for (const value of updated[collection]) {
            const id = "key" in value ? value.key : value.id;
            if (!same(old.get(id), value))
                changes.push({
                    path: `${collection}/${id}`,
                    before: old.get(id) ?? null,
                    after: value,
                });
            old.delete(id);
        }
        for (const [id, value] of old)
            changes.push({ path: `${collection}/${id}`, before: value, after: null });
    }
    return changes;
}
export async function importPlanWorkbook(originalPlan, inputPath) {
    await inspectWorkbookFile(inputPath);
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(inputPath);
    const allowed = [
        "사용안내",
        "시나리오",
        "기대결과",
        "참조안내",
        "_contract",
        ...groups(originalPlan).map((g) => g.name),
        ...actionGroups(originalPlan).map((g) => g.name),
    ];
    for (const s of book.worksheets) {
        if (!allowed.includes(s.name))
            throw new Error(`알 수 없는 시트: ${s.name}`);
        s.eachRow((r) => r.eachCell((c) => {
            scalar(c);
        }));
    }
    if (string(book.getWorksheet("_contract")?.getCell("B1") ??
        (() => {
            throw new Error("계획 식별 정보가 없습니다.");
        })()) !== contract(originalPlan))
        throw new Error("오래된 계획 또는 변조된 식별 정보입니다. 원본 계획에서 다시 내보내세요.");
    const plan = structuredClone(originalPlan);
    const ambiguities = [];
    const sc = requiredSheet(book, "시나리오", scenarioColumns);
    plan.scenarios = [];
    sc.eachRow((row, n) => {
        if (n === 1 || !row.hasValues)
            return;
        plan.scenarios.push({
            id: string(row.getCell(1)),
            title: string(row.getCell(2)),
            purpose: string(row.getCell(3)),
            rationale: string(row.getCell(4)),
            selected: bool(row.getCell(5)),
            execution: string(row.getCell(6)),
            dependsOn: json(row.getCell(7), []),
            sourceRefs: json(row.getCell(8), []),
            actions: json(row.getCell(9), []),
            preconditions: json(row.getCell(10), []),
            observation: json(row.getCell(11)),
        });
    });
    const originals = new Map(originalPlan.records.map((r) => [r.key, r]));
    plan.records = [];
    for (const g of groups(originalPlan)) {
        const sheet = requiredSheet(book, g.name, systemColumns);
        const fields = [];
        for (let col = systemColumns.length + 1; col <= sheet.columnCount; col++) {
            const field = string(sheet.getRow(1).getCell(col));
            Identifier.parse(field);
            if (fields.includes(field))
                throw new Error(`중복 필드: ${field}`);
            fields.push(field);
        }
        sheet.eachRow((row, n) => {
            if (n === 1 || !row.hasValues)
                return;
            const key = string(row.getCell(1)) || newRecordKey();
            Key.parse(key);
            const old = originals.get(key);
            const ownership = string(row.getCell(3)) || "created";
            const existingId = string(row.getCell(4));
            if (old &&
                (old.stage !== g.stage ||
                    old.object !== g.object ||
                    old.ownership !== ownership ||
                    (old.existingId ?? "") !== existingId))
                throw new Error(`${key}: 오브젝트·단계·소유구분·기존 ID는 Excel에서 변경할 수 없습니다.`);
            if (!old && (ownership !== "created" || existingId))
                throw new Error(`${key}: 신규 행에 기존 레코드 ID/소유권을 선언할 수 없습니다. 브라우저에서 별도 범위를 검토하세요.`);
            const record = {
                key,
                scenarioId: string(row.getCell(2)),
                object: g.object,
                stage: g.stage,
                ownership: ownership,
                ...(existingId ? { existingId } : {}),
                dependsOn: json(row.getCell(5), []),
                intentionalInvalid: bool(row.getCell(6)),
                existingImpactIds: structuredClone(old?.existingImpactIds ?? []),
                fields: {},
            };
            for (let i = 0; i < fields.length; i++) {
                const field = fields[i], cell = row.getCell(systemColumns.length + i + 1), previous = old?.fields[field];
                const raw = scalar(cell);
                const sample = originalPlan.records.find((r) => r.object === g.object && r.fields[field]?.kind === "value")?.fields[field];
                if ((raw === null || raw === "") &&
                    previous &&
                    display(previous) !== "")
                    ambiguities.push({
                        id: `${key}.${field}`,
                        key,
                        field,
                        previous: structuredClone(previous),
                        choices: ["keep", "omit", "null", "empty"],
                        message: `${key}.${field} 값이 빈칸으로 변경되었습니다. 처리 방법을 선택하세요.`,
                    });
                if (previous === undefined && (raw === null || raw === ""))
                    continue;
                record.fields[field] = inputFromCell(cell, previous, sample);
            }
            plan.records.push(record);
        });
    }
    for (const g of actionGroups(originalPlan)) {
        const sheet = requiredSheet(book, g.name, ["동작ID", "논리키", "시나리오"]);
        const action = plan.scenarios
            .find((s) => s.id === g.scenarioId)
            ?.actions.find((a) => a.id === g.actionId);
        if (!action)
            throw new Error(`${g.actionId}: 동작 시트가 남아 있는 동안 동작을 삭제할 수 없습니다. 브라우저에서 변경한 뒤 새 Excel을 내보내세요.`);
        if (action.kind !== "dml" ||
            action.object !== g.object ||
            action.verb === "delete")
            throw new Error(`${g.actionId}: 실행 종류 변경 후 Excel을 다시 내보내세요.`);
        const fields = [];
        for (let col = 4; col <= sheet.columnCount; col++) {
            const field = string(sheet.getRow(1).getCell(col));
            Identifier.parse(field);
            if (fields.includes(field))
                throw new Error(`중복 필드: ${field}`);
            fields.push(field);
        }
        const keys = new Set();
        sheet.eachRow((row, n) => {
            if (n === 1 || !row.hasValues)
                return;
            const key = string(row.getCell(2));
            if (string(row.getCell(1)) !== g.actionId ||
                string(row.getCell(3)) !== g.scenarioId ||
                !action.recordKeys.includes(key) ||
                !plan.records.some((r) => r.key === key))
                throw new Error(`${g.name}: 승인 동작의 논리키·시나리오 참조를 확인하세요.`);
            if (keys.has(key))
                throw new Error(`${g.name}: 중복 논리키 ${key}`);
            keys.add(key);
            const previous = g.action.fieldOverrides[key] ??
                originalPlan.records.find((r) => r.key === key)?.fields ??
                {};
            const values = {};
            for (let i = 0; i < fields.length; i++) {
                const field = fields[i], cell = row.getCell(i + 4), old = previous[field], raw = scalar(cell);
                if (old === undefined && (raw === null || raw === ""))
                    continue;
                if ((raw === null || raw === "") && old && display(old) !== "") {
                    action.fieldOverrides[key] ??= structuredClone(previous);
                    ambiguities.push({
                        actionId: g.actionId,
                        id: `${g.actionId}.${key}.${field}`,
                        key,
                        field,
                        previous: structuredClone(old),
                        choices: ["keep", "omit", "null", "empty"],
                        message: `동작 ${g.actionId}: ${key}.${field} 빈칸 처리 방법을 선택하세요.`,
                    });
                }
                values[field] = inputFromCell(cell, old, old);
            }
            if (!same(values, previous)) {
                const jsonChanged = !same(action.fieldOverrides[key], g.action.fieldOverrides[key]);
                if (jsonChanged && !same(action.fieldOverrides[key], values))
                    throw new Error(`${g.actionId}/${key}: 동작 JSON과 동작 입력 표를 동시에 다르게 편집했습니다.`);
                action.fieldOverrides[key] = values;
            }
        });
        for (const key of action.recordKeys)
            if (!keys.has(key))
                throw new Error(`${g.name}: 동작 입력 행이 없습니다: ${key}. 시나리오 동작의 recordKeys도 함께 수정하세요.`);
    }
    const ex = requiredSheet(book, "기대결과", expectationColumns);
    plan.expectations = [];
    ex.eachRow((row, n) => {
        if (n === 1 || !row.hasValues)
            return;
        const expected = string(row.getCell(6));
        plan.expectations.push({
            id: string(row.getCell(1)),
            scenarioId: string(row.getCell(2)),
            label: string(row.getCell(3)),
            subject: json(row.getCell(4)),
            operator: string(row.getCell(5)),
            ...(expected !== "" ? { expected: json(row.getCell(6)) } : {}),
            tolerance: Number(string(row.getCell(7))),
            unordered: bool(row.getCell(8)),
            valueType: string(row.getCell(9)),
            timezone: string(row.getCell(10)),
        });
    });
    const preserveOrder = (items, originals, key) => {
        const rank = new Map(originals.map((item, index) => [key(item), index]));
        return items.sort((a, b) => (rank.get(key(a)) ?? Number.MAX_SAFE_INTEGER) -
            (rank.get(key(b)) ?? Number.MAX_SAFE_INTEGER));
    };
    plan.records = preserveOrder(plan.records, originalPlan.records, (r) => r.key);
    plan.scenarios = preserveOrder(plan.scenarios, originalPlan.scenarios, (s) => s.id);
    plan.expectations = preserveOrder(plan.expectations, originalPlan.expectations, (e) => e.id);
    validateReferences(plan);
    return { plan, changes: planChanges(originalPlan, plan), ambiguities };
}
export function resolveWorkbookImport(original, result, resolutions) {
    const plan = structuredClone(result.plan);
    if (plan.plan_id !== original.plan_id ||
        plan.version !== original.version ||
        plan.hash !== original.hash ||
        !same(plan.org, original.org) ||
        !same(plan.source, original.source))
        throw new Error("원본 계획 식별 정보가 변경되었습니다.");
    for (const ambiguity of result.ambiguities) {
        const choice = resolutions[ambiguity.id];
        if (!choice || !ambiguity.choices.includes(choice))
            throw new Error(`빈칸 처리 선택이 필요합니다: ${ambiguity.id}`);
        const record = plan.records.find((r) => r.key === ambiguity.key);
        if (!record)
            throw new Error(`레코드가 없습니다: ${ambiguity.key}`);
        let fields = record.fields;
        if (ambiguity.actionId) {
            const action = plan.scenarios
                .flatMap((s) => s.actions)
                .find((a) => a.id === ambiguity.actionId);
            if (!action)
                throw new Error("동작을 찾을 수 없습니다.");
            action.fieldOverrides[record.key] ??= structuredClone(record.fields);
            fields = action.fieldOverrides[record.key];
        }
        fields[ambiguity.field] =
            choice === "keep"
                ? structuredClone(ambiguity.previous)
                : choice === "empty"
                    ? { kind: "value", value: "" }
                    : { kind: choice };
    }
    return validateReferences(plan);
}
export function workbookFingerprint(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
}
