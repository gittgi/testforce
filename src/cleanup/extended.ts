import type { Engine } from "../execution/engine.js";
import type {
  Run,
  SalesforceAdapter,
  Json,
  RecordBinding,
} from "../core/model.js";
import { canonical, hash } from "../core/hash.js";
import { fail } from "../core/errors.js";
export async function restorePreview(engine: Engine, id: string) {
  return engine.change(id, async (run, adapter) => ({
    run,
    preview: await buildRestore(run, adapter),
  }));
}
async function buildRestore(run: Run, adapter: SalesforceAdapter) {
  const records = [];
  for (const b of Object.values(run.bindings).filter(
    (b) => b.ownership === "existing" && b.before,
  )) {
    const actions = run
      .plan!.scenarios.flatMap((s) => s.actions)
      .filter((a) => a.recordKeys.includes(b.key) && a.verb === "update");
    const names = [
      ...new Set(
        actions.flatMap((a) => Object.keys(a.fieldOverrides[b.key] ?? {})),
      ),
    ];
    if (!names.length) continue;
    let conflict = false,
      reason = "";
    let current: Record<string, Json> | undefined;
    const fields: Record<string, Json> = {};
    try {
      const d = await adapter.describe(b.object);
      current = (
        await adapter.read(
          b.object,
          [b.id],
          [...new Set(["Id", ...Object.keys(b.lastKnown ?? {}), ...names])],
        )
      )[0];
      if (
        !current ||
        !b.lastKnown ||
        Object.keys(b.lastKnown).some(
          (f) => canonical(current![f]) !== canonical(b.lastKnown![f]),
        )
      ) {
        conflict = true;
        reason = "현재 상태가 마지막 관찰과 다르거나 조회할 수 없습니다.";
      }
      for (const key of names) {
        if (
          !d.fields.some(
            (f) => f.name === key && f.updateable && !f.calculated,
          ) ||
          b.before![key] === undefined
        ) {
          conflict = true;
          reason = "복구 전 값 또는 수정 권한이 없습니다.";
        } else fields[key] = b.before![key]!;
      }
    } catch {
      conflict = true;
      reason = "현재 상태 조회에 실패했습니다.";
    }
    records.push({
      key: b.key,
      id: b.id,
      object: b.object,
      current,
      fields,
      conflict,
      reason,
    });
  }
  return {
    records,
    conflicts: records.filter((r) => r.conflict),
    detailsHash: hash(records),
  };
}
export async function restoreApprove(
  engine: Engine,
  id: string,
  version: number,
  detailsHash: string,
  actor: string,
  channel: "browser" | "terminal" | "mod",
) {
  const preview = (await restorePreview(engine, id)).preview;
  if (preview.detailsHash !== detailsHash || preview.conflicts.length)
    fail(
      "RESTORE_CONFLICT",
      "복구 대상 상태가 변경되었거나 복구할 수 없습니다.",
      preview,
    );
  const run = await engine.store.load(id);
  return engine.approve(
    id,
    version,
    run.plan!.hash,
    "restore",
    actor,
    channel,
    detailsHash,
  );
}
export async function restore(engine: Engine, id: string, version: number) {
  return engine.change(id, async (run, adapter) => {
    engine.expectVersion(run, version);
    await engine.gate(run, adapter, "restore", true);
    const preview = await buildRestore(run, adapter);
    const approval = run.approvals.findLast(
      (a) => a.scope === "restore" && a.planHash === run.plan!.hash,
    );
    if (
      !approval ||
      approval.detailsHash !== preview.detailsHash ||
      preview.conflicts.length
    )
      fail(
        "RESTORE_CONFLICT",
        "복구 범위를 다시 검토하고 승인하세요.",
        preview,
      );
    for (const item of preview.records) {
      const request = {
        verb: "update" as const,
        object: item.object,
        records: [{ key: item.key, id: item.id, fields: item.fields }],
        allOrNone: true,
      };
      const result = await engine.write(
        run,
        adapter,
        run.bindings[item.key]!.scenarioId,
        "restore",
        request as unknown as Json,
        async () => (await adapter.mutate(request)) as unknown as Json,
        "restore",
        true,
      );
      if (
        (
          result as unknown as { results: { success: boolean }[] }
        ).results.every((r) => r.success)
      ) {
        const b = run.bindings[item.key]!;
        b.lastKnown = { ...item.current, ...item.fields, Id: item.id };
      }
    }
    engine.event(
      run,
      "restore",
      "기존 레코드의 승인한 필드만 복구했습니다. 삭제·외부 영향의 완전한 롤백은 아닙니다.",
    );
    return run;
  });
}
export async function cancelPreview(engine: Engine, id: string, jobId: string) {
  return engine.change(id, async (run, adapter) => {
    if (!run.operations.some((op) => op.jobId === jobId))
      fail(
        "JOB_OWNERSHIP",
        "이 도구가 시작한 것으로 확인된 Job만 취소할 수 있습니다.",
      );
    const job = await adapter.job(jobId);
    return { run, preview: { job, detailsHash: hash(job) } };
  });
}
export async function cancelApprove(
  engine: Engine,
  id: string,
  version: number,
  jobId: string,
  detailsHash: string,
  actor: string,
  channel: "browser" | "terminal" | "mod",
) {
  const preview = (await cancelPreview(engine, id, jobId)).preview;
  if (preview.detailsHash !== detailsHash)
    fail("JOB_CHANGED", "Job 상태가 바뀌었습니다. 다시 확인하세요.");
  const run = await engine.store.load(id);
  return engine.approve(
    id,
    version,
    run.plan!.hash,
    "cancel-job",
    actor,
    channel,
    detailsHash,
  );
}
export async function cancelJob(
  engine: Engine,
  id: string,
  version: number,
  jobId: string,
) {
  return engine.change(id, async (run, adapter) => {
    engine.expectVersion(run, version);
    if (!run.operations.some((op) => op.jobId === jobId))
      fail("JOB_OWNERSHIP", "이 실행의 Job이 아닙니다.");
    const job = await adapter.job(jobId);
    const approval = run.approvals.findLast(
      (a) => a.scope === "cancel-job" && a.planHash === run.plan!.hash,
    );
    if (!approval || approval.detailsHash !== hash(job))
      fail("JOB_APPROVAL", "현재 Job 상태에 대한 취소 승인이 필요합니다.");
    if (job.done) fail("JOB_FINISHED", "이미 종료한 Job입니다.");
    if (!adapter.cancelJob)
      fail("JOB_CANCEL_UNAVAILABLE", "연결부가 Job 취소를 지원하지 않습니다.");
    const owner = run.operations.find((op) => op.jobId === jobId)!;
    await engine.write(
      run,
      adapter,
      owner.scenarioId,
      "action",
      { jobId, operation: "cancel" },
      async () => {
        await adapter.cancelJob!(jobId);
        return { success: true, jobId };
      },
      "cancel-job",
    );
    const observed = await adapter.job(jobId);
    const state = run.scenarios[owner.scenarioId]!;
    state.jobs = state.jobs.map((j) => (j.id === jobId ? observed : j));
    engine.event(
      run,
      "job-cancel",
      `${jobId} 취소 요청과 실제 상태를 기록했습니다.`,
    );
    return run;
  });
}
export async function confirmOwnership(
  engine: Engine,
  id: string,
  version: number,
  keys: string[],
  actor: string,
  channel: "browser" | "terminal" | "mod",
) {
  return engine.change(id, async (run, adapter) => {
    engine.expectVersion(run, version);
    await engine.identityCheck(run, adapter);
    if (!actor.trim() || !keys.length)
      fail("ATTESTATION", "생성 사실을 확인할 사용자와 ID를 선택하세요.");
    const identity = await adapter.identity();
    const users = await adapter.query(
      {
        object: "User",
        fields: ["Id"],
        where: [
          {
            field: "Username",
            op: "eq",
            value: { kind: "value", value: identity.username },
          },
        ],
        limit: 2,
      },
      {},
    );
    if (users.length !== 1)
      fail("IMPORT_ACTOR", "실제 인증 사용자의 ID를 확인하지 못했습니다.");
    for (const key of keys) {
      const b = run.bindings[key];
      const spec = run.plan!.records.find((r) => r.key === key);
      if (
        !b ||
        b.ownership !== "unresolved" ||
        spec?.ownership !== "created" ||
        b.runId !== id
      )
        fail(
          "OWNERSHIP",
          "이 실행의 신규 입력 중 ID 연결을 완료한 항목만 확인할 수 있습니다.",
        );
      const row = (
        await adapter.read(
          b.object,
          [b.id],
          ["Id", "CreatedDate", "CreatedById"],
        )
      )[0];
      const created = Date.parse(String(row?.CreatedDate));
      if (
        !row ||
        row.CreatedById !== users[0]!.Id ||
        !Number.isFinite(created) ||
        created < Date.parse(run.createdAt) ||
        created > Date.now()
      )
        fail(
          "CREATION_EVIDENCE",
          "생성 시각·생성 사용자가 이번 실행과 일치하지 않습니다.",
        );
      b.ownership = "created";
      b.proof += `; ${channel} 사용자 ${actor} 생성 사실 확인, CreatedDate=${row.CreatedDate}, CreatedById=${row.CreatedById}`;
    }
    engine.event(
      run,
      "ownership",
      `${actor}: 이번 실행에서 생성한 수동 Import 레코드 ${keys.length}개 확인`,
    );
    return run;
  });
}
