import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'csv-stringify/sync';
import { testEngine, fixtureRecord, inputRecord, scenario, assertion, thingSchema } from '../helpers.js';
import { ActionSchema, type ObjectDescribe, type Run, type Json } from '../../src/core/model.js';
import { command } from '../../src/server/commands.js';
import { restorePreview, restoreApprove, restore, cancelPreview, cancelApprove, cancelJob } from '../../src/cleanup/extended.js';
import { contentHash } from '../../src/core/hash.js';
import type { ImportBundle } from '../../src/imports/index.js';

const EXISTING='a00999999999999AAA';
const JOB='707000000000001AAA';
const USER='005000000000001AAA';
async function changedExisting(){
 const t=await testEngine({records:{Probe__c:{[EXISTING]:{Id:EXISTING,Text__c:'original',Amount__c:12}}}});
 t.plan.records=[{...fixtureRecord('existing'),ownership:'existing',existingId:EXISTING,fields:{Text__c:{kind:'value',value:'original'},Amount__c:{kind:'value',value:12}}}];
 t.plan.scenarios=[scenario('scenario',{actions:[ActionSchema.parse({id:'change',kind:'dml',verb:'update',object:'Probe__c',recordKeys:['existing'],fieldOverrides:{existing:{Text__c:{kind:'value',value:'changed'}}},impact:{description:'승인한 기존 레코드 필드 변경',existingRecordIds:[EXISTING],existingFields:['Text__c'],bounded:true}})]})];
 t.plan.expectations=[assertion('scenario','existing',{expected:'changed'})];t.plan.policies.existingMutation=true;
 let run=await t.submit();await t.approve();await t.engine.approve(t.id,1,run.plan!.hash,'existing','오프라인 검토자','terminal');
 await t.engine.prepare(t.id,1);await t.engine.execute(t.id,1);run=await t.engine.collect(t.id,1);expect(run.assertions[0]!.status).toBe('MATCH');return t;
}
async function queuedBatch(){
 const t=await testEngine({apexHandler:(_script,_correlation,state)=>{state.jobs[JOB]={id:JOB,status:'Queued',errors:0,processed:0,total:1,done:false};return{success:true,compiled:true,returnCaptured:false,jobId:JOB};}});
 t.plan.records=[];t.plan.scenarios=[scenario('scenario',{actions:[ActionSchema.parse({id:'batch',kind:'batch',className:'ProbeService',scopeQuery:{object:'Probe__c',fields:['Id'],where:[]},approvedScopeIds:[],impact:{description:'빈 가상 데이터 범위',bounded:true}})]})];t.plan.expectations=[];
 await t.submit();await t.approve();await t.engine.prepare(t.id,1);const run=await t.engine.execute(t.id,1);expect(run.scenarios.scenario!.status).toBe('WAITING_ASYNC');expect(run.operations[0]!.jobId).toBe(JOB);return t;
}
const importSchema:ObjectDescribe={...thingSchema,fields:[...thingSchema.fields,{name:'CreatedDate',type:'datetime',nillable:false,defaultedOnCreate:true,createable:false,updateable:false},{name:'CreatedById',type:'reference',nillable:false,defaultedOnCreate:true,createable:false,updateable:false,referenceTo:['User']}]};
const userSchema:ObjectDescribe={name:'User',createable:false,updateable:false,deletable:false,fields:[{name:'Id',type:'id',nillable:false,defaultedOnCreate:true,createable:false,updateable:false},{name:'Username',type:'string',nillable:false,defaultedOnCreate:false,createable:false,updateable:false}]};
async function manualImport(createdDate?:string){
 const t=await testEngine({schemas:[importSchema,userSchema],records:{User:{[USER]:{Id:USER,Username:'offline@example.invalid'}}},mutationHook:(request,state)=>{if(request.verb==='insert')for(const row of Object.values(state.records.Probe__c??{})){row.CreatedDate=createdDate??new Date().toISOString();row.CreatedById=USER;}}});
 t.plan.scenarios=[scenario('scenario',{execution:'human-import',actions:[ActionSchema.parse({id:'manual-insert',kind:'dml',verb:'insert',object:'Probe__c',recordKeys:['input'],allOrNone:false,transaction:'per-record',impact:{description:'수동 신규 입력',bounded:true}})]})];t.plan.records=[inputRecord()];await t.submit();await t.approve();await t.engine.prepare(t.id,1);
 const generated=await command(t.engine,t.id,{command:'import-generate',version:1,phase:'action',scenarioId:'scenario'},'browser',true);
 return {...t,bundle:generated.bundle as ImportBundle,bundleId:generated.bundleId as string};
}

describe('existing record restoration',()=>{
 it('previews exact original fields, requires a separate human approval, and restores only approved fields',async()=>{
  const t=await changedExisting();const before=await restorePreview(t.engine,t.id);expect(before.preview.conflicts).toEqual([]);expect(before.preview.records).toHaveLength(1);expect(before.preview.records[0]!.fields).toEqual({Text__c:'original'});
  await expect(restore(t.engine,t.id,1)).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});
  await expect(command(t.engine,t.id,{command:'restore-approve',reviewed:true,version:1,detailsHash:before.preview.detailsHash,actor:'위조된 요청'},'terminal',false)).rejects.toMatchObject({code:'USER_ACTION_REQUIRED'});
  await command(t.engine,t.id,{command:'restore-approve',reviewed:true,version:1,detailsHash:before.preview.detailsHash,actor:'검토자'},'browser',true);
  const response=await command(t.engine,t.id,{command:'restore',version:1},'browser',true);const run=response.run as Run;
  const actual=await t.getAdapter().read('Probe__c',[EXISTING],['Text__c','Amount__c']);expect(actual[0]).toMatchObject({Text__c:'original',Amount__c:12});expect(run.operations.at(-1)).toMatchObject({phase:'restore',state:'SUCCEEDED'});expect(run.bindings.existing!.ownership).toBe('existing');expect(run.bindings.existing!.before!.Text__c).toBe('original');
 });
 it('rejects changed current state both before approval and after approval',async()=>{
  const t=await changedExisting();const before=await restorePreview(t.engine,t.id);await restoreApprove(t.engine,t.id,1,before.preview.detailsHash,'검토자','browser');
  await t.getAdapter().mutate({verb:'update',object:'Probe__c',allOrNone:true,records:[{key:'existing',id:EXISTING,fields:{Text__c:'someone else changed this'}}]});
  const changed=await restorePreview(t.engine,t.id);expect(changed.preview.conflicts).toHaveLength(1);
  await expect(restoreApprove(t.engine,t.id,1,before.preview.detailsHash,'검토자','browser')).rejects.toMatchObject({code:'RESTORE_CONFLICT'});
  await expect(restore(t.engine,t.id,1)).rejects.toMatchObject({code:'RESTORE_CONFLICT'});
  expect((await t.getAdapter().read('Probe__c',[EXISTING],['Text__c']))[0]!.Text__c).toBe('someone else changed this');expect((await t.store.load(t.id)).operations.filter(op=>op.phase==='restore')).toHaveLength(0);
 });
});

describe('known Job cancellation',()=>{
 it('cannot cancel unknown Jobs and requires separate current-state approval for a known Job',async()=>{
  const t=await queuedBatch();await expect(cancelPreview(t.engine,t.id,'707000000000002AAA')).rejects.toMatchObject({code:'JOB_OWNERSHIP'});
  await expect(cancelJob(t.engine,t.id,1,JOB)).rejects.toMatchObject({code:'JOB_APPROVAL'});expect((await t.getAdapter().job(JOB)).done).toBe(false);
  const preview=await cancelPreview(t.engine,t.id,JOB);await expect(command(t.engine,t.id,{command:'cancel-approve',reviewed:true,version:1,jobId:JOB,detailsHash:preview.preview.detailsHash,actor:'검토자'},'terminal',false)).rejects.toMatchObject({code:'USER_ACTION_REQUIRED'});
  await cancelApprove(t.engine,t.id,1,JOB,preview.preview.detailsHash,'검토자','browser');const run=await cancelJob(t.engine,t.id,1,JOB);
  expect(run.scenarios.scenario!.jobs[0]).toMatchObject({status:'Aborted',done:true});expect(run.operations.at(-1)).toMatchObject({state:'SUCCEEDED',request:{jobId:JOB,operation:'cancel'}});
  await expect(cancelJob(t.engine,t.id,1,JOB)).rejects.toMatchObject({code:'JOB_APPROVAL'});
 });
 it('rechecks the Job state after preview and before a new approval',async()=>{
  const t=await queuedBatch();const preview=await cancelPreview(t.engine,t.id,JOB);await t.getAdapter().cancelJob(JOB);
  await expect(cancelApprove(t.engine,t.id,1,JOB,preview.preview.detailsHash,'검토자','terminal')).rejects.toMatchObject({code:'JOB_CHANGED'});
  expect((await t.store.load(t.id)).approvals.some(a=>a.scope==='cancel-job')).toBe(false);
 });
});

describe('manual execution files',()=>{
 it('writes the exact approved Anonymous script and verifies its manifest without executing it',async()=>{
  const t=await testEngine();const script="System.debug('한글 수동 실행');\n";
  t.plan.records=[];t.plan.scenarios=[scenario('scenario',{execution:'human-apex',actions:[ActionSchema.parse({id:'approved-anonymous',kind:'anonymous',script,impact:{description:'디버그 출력만',bounded:true}})]})];t.plan.expectations=[];await t.submit();
  await expect(command(t.engine,t.id,{command:'manual-instructions',version:1,scenarioId:'scenario'},'browser',true)).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});
  await t.approve('prepare');await t.engine.prepare(t.id,1);const result=await command(t.engine,t.id,{command:'manual-instructions',version:1,scenarioId:'scenario'},'browser',true);
  const dir=path.join(t.store.dir(t.id),'import',String(result.bundleId));expect(await readFile(path.join(dir,'approved-anonymous.apex'),'utf8')).toBe(script);
  const manifest=JSON.parse(await readFile(path.join(dir,'manual-manifest.json'),'utf8'));expect(manifest.files[0]).toMatchObject({name:'approved-anonymous.apex',sha256:contentHash(script)});expect(manifest.planHash).toBe((await t.store.load(t.id)).plan!.hash);
  const guide=await readFile(path.join(dir,'README.md'),'utf8');expect(guide).toContain('approved-anonymous.apex');expect(guide).toContain('오프라인 시뮬레이션');expect(guide).toContain('생성 자체는 실행 완료가 아닙니다');expect((await t.getAdapter().inspectState()).writes).toBe(0);expect((await t.store.load(t.id)).scenarios.scenario!.status).toBe('WAITING_HUMAN');
 });
 it('materializes a human Service call with the actual fixture ID and correlated return markers',async()=>{
  const t=await testEngine();t.plan.records=[fixtureRecord('parent')];t.plan.scenarios=[scenario('scenario',{execution:'human-apex',actions:[ActionSchema.parse({id:'service-call',kind:'service',className:'ProbeService',method:'echo',args:[{type:'String',value:{kind:'ref',key:'parent'}}],impact:{description:'입력 반환만',bounded:true}})]})];t.plan.expectations=[];await t.submit();await t.approve('prepare');const ready=await t.engine.prepare(t.id,1);const result=await command(t.engine,t.id,{command:'manual-instructions',version:1,scenarioId:'scenario'},'browser',true);
  const dir=path.join(t.store.dir(t.id),'import',String(result.bundleId));const script=await readFile(path.join(dir,'service-call.apex'),'utf8');const manifest=JSON.parse(await readFile(path.join(dir,'manual-manifest.json'),'utf8'));
  expect(script).toContain(ready.bindings.parent!.id);expect(script).not.toContain('{{parent}}');expect(script).toContain(`SFTW:${manifest.files[0].correlationId}:RETURN:`);expect(manifest.files[0].sha256).toBe(contentHash(script));expect((await t.getAdapter().inspectState()).writes).toBe(1);
 });
});

describe('manual Import API verification and ownership',()=>{
 it('links only real queried matching results, keeps ownership unresolved until explicit creation attestation',async()=>{
  const t=await manualImport();const inserted=await t.getAdapter().mutate({verb:'insert',object:'Probe__c',allOrNone:true,records:[{key:'input',fields:{Text__c:'after'}}]});const id=inserted.results[0]!.id!;
  const csv=stringify([{...t.bundle.files[0]!.rows[0]!.fields,Id:id,Error:''}],{header:true,record_delimiter:'\r\n'});
  const result=await command(t.engine,t.id,{command:'import-results',version:1,bundleId:t.bundleId,csv},'browser',true);const run=result.run as Run;
  expect(run.bindings.input).toMatchObject({id,ownership:'unresolved',after:{Id:id,Text__c:'after'}});expect(run.scenarios.scenario!.status).toBe('WAITING_HUMAN');expect((await t.engine.cleanupPreview(t.id)).preview.records).toHaveLength(0);
  await expect(command(t.engine,t.id,{command:'confirm-ownership',reviewed:true,version:1,keys:['input'],actor:'검토자'},'terminal',false)).rejects.toMatchObject({code:'USER_ACTION_REQUIRED'});
  const confirmed=await command(t.engine,t.id,{command:'confirm-ownership',reviewed:true,version:1,keys:['input'],actor:'생성 사용자'},'browser',true);expect((confirmed.run as Run).bindings.input).toMatchObject({ownership:'created'});expect((confirmed.run as Run).bindings.input!.proof).toContain('CreatedById=');expect((await t.engine.cleanupPreview(t.id)).preview.records.map(r=>r.key)).toEqual(['input']);
 });
 it('rejects forged successful CSV values when actual queried fields differ',async()=>{
  const t=await manualImport();const inserted=await t.getAdapter().mutate({verb:'insert',object:'Probe__c',allOrNone:true,records:[{key:'input',fields:{Text__c:'different actual value'}}]});const id=inserted.results[0]!.id!;
  const csv=stringify([{...t.bundle.files[0]!.rows[0]!.fields,Id:id,Error:''}],{header:true});
  await expect(command(t.engine,t.id,{command:'import-results',version:1,bundleId:t.bundleId,csv},'browser',true)).rejects.toMatchObject({code:'IMPORT_VERIFY'});expect((await t.store.load(t.id)).bindings.input).toBeUndefined();
 });
 it('cannot turn an older existing record into created ownership with an edited CSV and confirmation',async()=>{
  const t=await manualImport('2020-01-01T00:00:00Z');const inserted=await t.getAdapter().mutate({verb:'insert',object:'Probe__c',allOrNone:true,records:[{key:'input',fields:{Text__c:'after'}}]});const id=inserted.results[0]!.id!;
  const csv=stringify([{...t.bundle.files[0]!.rows[0]!.fields,Id:id,Error:''}],{header:true});await command(t.engine,t.id,{command:'import-results',version:1,bundleId:t.bundleId,csv},'browser',true);
  await expect(command(t.engine,t.id,{command:'confirm-ownership',reviewed:true,version:1,keys:['input'],actor:'검토자'},'browser',true)).rejects.toMatchObject({code:'CREATION_EVIDENCE'});expect((await t.store.load(t.id)).bindings.input!.ownership).toBe('unresolved');
 });
});
