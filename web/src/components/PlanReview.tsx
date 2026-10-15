import type { Action, InputValue, Plan, Scenario } from '../../../src/core/model';
import { ValueContent, ExpectedContent } from './ResultTables';

export const operatorLabels: Record<string, string> = {
  eq: '같음', ne: '다름', null: '값 없음 (null)', notNull: '값 있음', exists: '존재함',
  absent: '존재하지 않음', count: '건수', gt: '초과', gte: '이상', lt: '미만', lte: '이하',
  range: '범위 안', changed: '이전보다 변경됨', unchanged: '이전과 같음', includes: '포함함',
};
export function InputContent({ value }: { value: InputValue }) {
  if (value.kind === 'omit') return <span className="value-state">전송하지 않음</span>;
  if (value.kind === 'ref') return <span className="reference-value">↗ {value.key}의 실제 ID</span>;
  return <ValueContent value={value.kind === 'null' ? null : value.value} />;
}
export function ActionSummary({ action: a }: { action: Action }) {
  const labels = { insert: '레코드 생성', update: '레코드 수정', delete: '레코드 삭제' };
  return <div className="action-summary">
    <strong>{a.kind === 'dml' ? `${a.object} · ${a.verb ? labels[a.verb] : 'DML'}` : a.kind === 'service' ? `${a.className}.${a.method} 호출` : a.kind === 'batch' ? `${a.className} Batch 시작` : 'Anonymous Apex 실행'}</strong>
    <p>{a.impact.description}</p>
    {a.recordKeys.length > 0 && <p>대상 레코드: {a.recordKeys.join(', ')} · {a.transaction === 'single' ? '한 트랜잭션' : '레코드별 트랜잭션'} · {a.transaction === 'per-record' ? '각 요청의 성공·실패를 별도로 기록' : a.allOrNone ? '모두 성공하거나 모두 취소' : '레코드별 성공·실패'}</p>}
    {Object.entries(a.fieldOverrides).map(([key, fields]) => <div className="table-scroll" key={key}><table><caption>{key}에 적용할 변경값</caption><thead><tr><th>필드</th><th>변경값</th></tr></thead><tbody>{Object.entries(fields).map(([field, value]) => <tr key={field}><th scope="row">{field}</th><td><InputContent value={value} /></td></tr>)}</tbody></table></div>)}
    {(a.args.length > 0 || a.constructorArgs.length > 0) && <div className="table-scroll"><table><caption>호출 인자</caption><thead><tr><th>용도</th><th>순서</th><th>타입</th><th>값</th></tr></thead><tbody>{[['생성자', a.constructorArgs], ['메서드', a.args]].flatMap(([label, args]) => (args as Action['args']).map((arg, i) => <tr key={`${label}-${i}`}><td>{String(label)}</td><td>{i + 1}</td><td>{arg.type}</td><td><InputContent value={arg.value} /></td></tr>))}</tbody></table></div>}
    {a.kind === 'batch' && <p>승인한 처리 대상 {a.approvedScopeIds.length}건 · 한 번에 {a.scopeSize}건 처리</p>}
    {a.impact.existingRecordIds.length > 0 && <p className="impact-warning">기존 데이터 영향: {a.impact.existingRecordIds.join(', ')} · {a.impact.existingFields.join(', ')}</p>}
    {a.impact.externalEffects.length > 0 && <p className="impact-warning">외부 영향: {a.impact.externalEffects.join(', ')}</p>}
    {a.script && <details><summary>실행할 Apex 스크립트</summary><pre className="script-view">{a.script}</pre></details>}
    {a.scriptPath && <p>승인 스크립트 파일: <code>{a.scriptPath}</code></p>}
  </div>;
}
export function ScenarioPlanDetails({ scenario: s }: { scenario: Scenario }) {
  return <>
    {s.dependsOn.length > 0 && <p>먼저 완료할 시나리오: {s.dependsOn.join(', ')}</p>}
    {s.actions.map(a => <ActionSummary key={a.id} action={a} />)}
    {s.preconditions.length > 0 && <div className="table-scroll"><table><caption>실행 전 확인할 조건</caption><thead><tr><th>조건</th><th>비교</th><th>기준값</th></tr></thead><tbody>{s.preconditions.map(a => <tr key={a.id}><td>{a.label}</td><td>{operatorLabels[a.operator]}</td><td><ExpectedContent assertion={a} /></td></tr>)}</tbody></table></div>}
    {(s.actions.some(a => a.kind === 'batch') || s.observation.completionAssertions.length > 0) && <p>비동기 관찰: {s.observation.pollMs / 1000}초 간격 · 최대 {s.observation.timeoutMs / 1000}초 대기{s.observation.durationRequirement ? ' · 처리 시간도 검사' : ''}</p>}
  </>;
}
export function PlanReviewTables({ plan }: { plan: Plan }) {
  const selected = new Set(plan.scenarios.filter(s => s.selected).map(s => s.id));
  return <>
    <div className="table-scroll"><table><caption>준비 데이터와 테스트 입력</caption><thead><tr><th>단계 / 레코드</th><th>필드</th><th>승인할 입력값</th></tr></thead><tbody>{plan.records.filter(r => selected.has(r.scenarioId)).flatMap(r => Object.entries(r.fields).map(([field, value], i) => <tr key={`${r.key}-${field}`}><td>{i === 0 && <><strong>{r.stage === 'fixture' ? '준비' : '테스트 동작'} · {r.object}</strong><small className="cell-detail">{r.key}{r.ownership === 'existing' ? ` · 기존 ID: ${r.existingId}` : ' · 신규 생성'}</small></>}</td><th scope="row">{field}</th><td><InputContent value={value} /></td></tr>))}</tbody></table></div>
    <div className="table-scroll"><table><caption>확인할 기대 결과</caption><thead><tr><th>검사</th><th>비교 조건</th><th>기대값</th></tr></thead><tbody>{plan.expectations.filter(a => selected.has(a.scenarioId)).map(a => <tr key={a.id}><td>{a.label}<small className="cell-detail">{[a.subject.key, a.subject.field].filter(Boolean).join(' · ')}</small></td><td>{operatorLabels[a.operator]}</td><td><ExpectedContent assertion={a} /></td></tr>)}</tbody></table></div>
  </>;
}
