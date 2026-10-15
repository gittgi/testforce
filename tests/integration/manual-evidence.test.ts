import { describe,it,expect } from 'vitest';
import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { testEngine,scenario,assertion } from '../helpers.js';
import { ActionSchema,type Run,type Json } from '../../src/core/model.js';
import { command } from '../../src/server/commands.js';
import { contentHash } from '../../src/core/hash.js';

const LOG='07L000000000001AAA',JOB='707000000000001AAA';
type Entry={log:string;username:string;startedAt:string;status:string};
async function setup(kind:'service'|'batch'='service'){
 const recoveryLogs:Record<string,Entry>={};
 const t=await testEngine({recoveryLogs,jobs:{[JOB]:{id:JOB,status:'Queued',done:false,errors:0,processed:0,total:1}}});
 t.plan.records=[];
 const action=kind==='service'?{id:'manual-call',kind,className:'ProbeService',method:'echo',args:[{type:'String',value:{kind:'value',value:'echo'}}],returns:true,impact:{bounded:true,description:'입력 반환만'}}:{id:'manual-call',kind,className:'ProbeService',scopeQuery:{object:'Probe__c',fields:['Id'],where:[]},approvedScopeIds:[],impact:{bounded:true,description:'빈 승인 범위'}};
 t.plan.scenarios=[scenario('scenario',{execution:'human-apex',actions:[ActionSchema.parse(action)]})];
 t.plan.expectations=kind==='service'?[assertion('scenario','ignored',{subject:{kind:'return',key:'manual-call'},expected:'echo'})]:[assertion('scenario','ignored',{subject:{kind:'job',field:'status'},expected:'Completed'})];
 await t.submit();await t.approve('prepare');await t.engine.prepare(t.id,1);
 const generated=await command(t.engine,t.id,{command:'manual-instructions',version:1,scenarioId:'scenario'},'browser',true),bundleId=String(generated.bundleId),dir=path.join(t.store.dir(t.id),'import',bundleId),manifest=JSON.parse(await readFile(path.join(dir,'manual-manifest.json'),'utf8'));
 const addLog=(overrides:Partial<Entry>={},correlation=manifest.files[0].correlationId)=>{recoveryLogs[LOG]={username:'offline@example.invalid',startedAt:new Date().toISOString(),status:'Success',log:['BEGIN',kind==='batch'?`JOB:"${JOB}"`:'RETURN:"echo"','END'].map(v=>`12:00:00.0|USER_DEBUG|[1]|ERROR|SFTW:${correlation}:${v}`).join('\n'),...overrides}};
 const observe=()=>command(t.engine,t.id,{command:'manual-evidence',version:1,bundleId,logs:{'manual-call':LOG}},'browser',true);
 return {...t,recoveryLogs,dir,manifest,bundleId,addLog,observe};
}

describe('manual Service/Batch existing log evidence',()=>{
 it('parses a real synthetic correlated log, stores immutable evidence, waits for human report and compares the observed return',async()=>{
  const t=await setup();t.addLog();const run=(await t.observe()).run as Run;
  expect(run.scenarios.scenario!.status).toBe('WAITING_HUMAN');expect(run.scenarios.scenario!.humanReport).toBeUndefined();
  const result=run.scenarios.scenario!.actionResults['manual-call'] as {returnCaptured:boolean;returnValue:Json;manualEvidence:{evidenceRef:string}};
  expect(result).toMatchObject({returnCaptured:true,returnValue:'echo'});expect((await t.getAdapter().inspectState()).writes).toBe(0);
  const before=await readFile(path.join(t.store.dir(t.id),result.manualEvidence.evidenceRef),'utf8');expect(JSON.parse(before).data.recovered.log).toContain(`SFTW:${t.manifest.files[0].correlationId}:RETURN:`);
  await t.observe();expect(await readFile(path.join(t.store.dir(t.id),result.manualEvidence.evidenceRef),'utf8')).toBe(before);
  const awaitingHuman=await t.engine.collect(t.id,1);expect(awaitingHuman.assertions[0]!.status).toBe('NOT_EXECUTED');expect(awaitingHuman.scenarios.scenario!.humanReport).toBeUndefined();
  await t.engine.human(t.id,1,{scenarioId:'scenario',actor:'실행자',path:'human-apex',notes:'승인 스크립트 실행을 보고함'});
  const compared=await t.engine.collect(t.id,1);expect(compared.assertions[0]!.status).toBe('MATCH');expect(compared.scenarios.scenario!.actionResults['manual-call']).toMatchObject({returnValue:'echo'});
  await expect(command(t.engine,t.id,{command:'manual-evidence',version:1,bundleId:t.bundleId,logs:{'manual-call':'07L000000000002AAA'}},'browser',true)).rejects.toMatchObject({code:'EVIDENCE_EXISTS'});
 });
 it('captures the registered Job and keeps it asynchronous after the separate human completion report',async()=>{
  const t=await setup('batch');t.addLog();const run=(await t.observe()).run as Run;
  expect(run.scenarios.scenario!.jobs).toMatchObject([{id:JOB,status:'Queued',done:false}]);expect(run.scenarios.scenario!.status).toBe('WAITING_HUMAN');
  const reported=await t.engine.human(t.id,1,{scenarioId:'scenario',actor:'실행자',path:'human-apex',notes:'Batch 등록 보고'});expect(reported.scenarios.scenario!.status).toBe('WAITING_ASYNC');expect((await t.getAdapter().inspectState()).writes).toBe(0);
 });
 it('does not treat a human Batch completion report without a proven Job ID as observed execution',async()=>{
  const t=await setup('batch');await t.engine.human(t.id,1,{scenarioId:'scenario',actor:'실행자',path:'human-apex',notes:'실행했다고 보고하지만 Job 증거 없음'});
  const compared=await t.engine.collect(t.id,1);expect(compared.assertions[0]!.status).toBe('UNVERIFIABLE');expect(compared.scenarios.scenario!.message).toContain('Batch Job ID');expect(compared.scenarios.scenario!.jobs).toEqual([]);
 });
 it('rejects wrong correlations, missing END, duplicate returns, old timestamps and another user without inventing a result',async()=>{
  const t=await setup();t.addLog({},'manual-unrelated');await expect(t.observe()).rejects.toMatchObject({code:'MANUAL_LOG_INCOMPLETE'});
  t.addLog();t.recoveryLogs[LOG]!.log=t.recoveryLogs[LOG]!.log.replace(/\n[^\n]*:END$/,'');await expect(t.observe()).rejects.toMatchObject({code:'MANUAL_LOG_INCOMPLETE'});
  t.addLog();t.recoveryLogs[LOG]!.log=t.recoveryLogs[LOG]!.log.replace(/\n(?=[^\n]*:END$)/,`\n0|USER_DEBUG|[1]|ERROR|SFTW:${t.manifest.files[0].correlationId}:RETURN:"second"\n`);await expect(t.observe()).rejects.toMatchObject({code:'MANUAL_LOG_INCOMPLETE'});
  t.addLog({startedAt:'2000-01-01T00:00:00Z'});await expect(t.observe()).rejects.toMatchObject({code:'MANUAL_LOG_SCOPE'});
  t.addLog({username:'different@example.invalid'});await expect(t.observe()).rejects.toMatchObject({code:'APEX_LOG_USER'});
  const run=await t.store.load(t.id);expect(run.scenarios.scenario!.actionResults).toEqual({});expect(run.scenarios.scenario!.status).toBe('WAITING_HUMAN');expect(run.scenarios.scenario!.humanReport).toBeUndefined();
 });
 it('detects a script changed at the same path even when the local manifest SHA is changed too',async()=>{
  const t=await setup();t.addLog();const file=path.join(t.dir,t.manifest.files[0].name);const changed=(await readFile(file,'utf8'))+"System.debug('not approved');\n";
  await writeFile(file,changed);t.manifest.files[0].sha256=contentHash(changed);await writeFile(path.join(t.dir,'manual-manifest.json'),JSON.stringify(t.manifest));
  await expect(t.observe()).rejects.toMatchObject({code:'MANUAL_SCRIPT_CHANGED'});expect((await t.store.load(t.id)).scenarios.scenario!.actionResults).toEqual({});
 });
 it('blocks stale or wrong action/bundle manifests and requires the original approval',async()=>{
  const t=await setup();t.addLog();
  await expect(command(t.engine,t.id,{command:'manual-evidence',version:1,bundleId:'../outside',logs:{'manual-call':LOG}},'browser',true)).rejects.toMatchObject({code:'BUNDLE_ID'});
  await expect(command(t.engine,t.id,{command:'manual-evidence',version:1,bundleId:t.bundleId,logs:{'invented-action':LOG}},'browser',true)).rejects.toMatchObject({code:'MANUAL_ACTION'});
  const run=await t.store.load(t.id);run.approvals=[];await t.store.save(run);await expect(t.observe()).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});
 });
 it('checks deployed source again before offering scripts and rejects a newly expanded manual Batch scope',async()=>{
  const t=await setup('batch');await t.getAdapter().mutate({object:'Probe__c',verb:'insert',allOrNone:true,records:[{key:'new-unapproved',fields:{Text__c:'outside scope'}}]});
  await expect(command(t.engine,t.id,{command:'manual-instructions',version:1,scenarioId:'scenario'},'browser',true)).rejects.toMatchObject({code:'BATCH_SCOPE_CHANGED'});
  let drift=false;
  const simulated=await testEngine({},(adapter)=>new Proxy(adapter,{get(target,key){if(key==='mode')return 'live';if(key==='identity')return async()=>({...await target.identity(),mode:'live'});if(key==='deployedSource')return async(file:Parameters<typeof adapter.deployedSource>[0])=>({content:file.content+(drift?'\n// drift':''),apiVersion:file.apiVersion});const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}}));
  // A simulated live contract backed only by FakeAdapter; no Salesforce connection or writes.
  simulated.plan.records=[];simulated.plan.expectations=[];simulated.plan.scenarios=[scenario('scenario',{execution:'human-apex',actions:[ActionSchema.parse({id:'call',kind:'service',className:'ProbeService',method:'echo',args:[{type:'String',value:{kind:'value',value:'test'}}],impact:{bounded:true,description:'반환만'}})]})];
  await simulated.submit();await simulated.approve('execute');await simulated.engine.prepare(simulated.id,1);drift=true;
  await expect(command(simulated.engine,simulated.id,{command:'manual-instructions',version:1,scenarioId:'scenario'},'browser',true)).rejects.toMatchObject({code:'DEPLOYED_SOURCE_MISMATCH'});
  await expect(command(simulated.engine,simulated.id,{command:'import-generate',version:1,phase:'action',scenarioId:'scenario'},'browser',true)).rejects.toMatchObject({code:'DEPLOYED_SOURCE_MISMATCH'});
  expect((await simulated.getAdapter().inspectState()).writes).toBe(0);
 });
});
