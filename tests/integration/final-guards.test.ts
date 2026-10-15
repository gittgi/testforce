import {describe,it,expect} from 'vitest';
import {mkdtemp,symlink,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {testEngine,fixtureRecord,inputRecord,scenario,assertion,insertAction} from '../helpers.js';
import {AssertionSchema} from '../../src/core/model.js';
import {Engine} from '../../src/execution/engine.js';

describe('observation input and immutable result guards',()=>{
  it('queries fields used only by a precondition and async completion condition',async()=>{
    const t=await testEngine({mutationHook:(request,state)=>{if(request.verb==='insert')for(const row of Object.values(state.records.Probe__c??{}))row.Amount__c=25;}});
    const condition=assertion('scenario','fixture',{id:'amount',subject:{kind:'record',key:'fixture',field:'Amount__c'},expected:25});
    t.plan.records=[fixtureRecord(),inputRecord()];t.plan.scenarios=[scenario('scenario',{preconditions:[condition],observation:{completionAssertions:[condition]}})];
    await t.submit();await t.approve();const ready=await t.engine.prepare(t.id,1);expect(ready.scenarios.scenario!.baseline.fixture!.Amount__c).toBe(25);expect(ready.scenarios.scenario!.status).toBe('PREPARED');
    await t.engine.execute(t.id,1);const result=await t.engine.collect(t.id,1);expect(result.scenarios.scenario!.status).toBe('EXECUTED');expect(result.assertions[0]!.status).toBe('MATCH');
  });
  it('binds an approved logical expected ID while preserving the plan and original input',async()=>{
    const t=await testEngine();t.plan.records=[fixtureRecord('parent'),inputRecord('input','scenario',{Text__c:{kind:'value',value:'child'},Parent__c:{kind:'ref',key:'parent'}})];
    t.plan.expectations=[assertion('scenario','input',{subject:{kind:'record',key:'input',field:'Parent__c'},expected:{$recordId:'parent'}})];
    await t.submit();await t.approve();await t.engine.prepare(t.id,1);await t.engine.execute(t.id,1);const result=await t.engine.collect(t.id,1);
    expect(result.assertions[0]).toMatchObject({status:'MATCH',expected:result.bindings.parent!.id});expect(result.plan!.expectations[0]!.expected).toEqual({$recordId:'parent'});
  });
  it('does not overwrite execution assertions with deleted state after cleanup',async()=>{
    const t=await testEngine();await t.submit();await t.approve();await t.engine.prepare(t.id,1);await t.engine.execute(t.id,1);const result=await t.engine.collect(t.id,1);
    const preview=await t.engine.cleanupPreview(t.id);await t.engine.approveCleanup(t.id,1,preview.preview.detailsHash,'user','terminal');await t.engine.cleanup(t.id,1);
    await expect(t.engine.collect(t.id,1)).rejects.toMatchObject({code:'COLLECT_AFTER_CLEANUP'});expect((await t.store.load(t.id)).assertions).toEqual(result.assertions);
  });
  it('blocks evidence directory symlinks before writing approval evidence',async()=>{
    const t=await testEngine();await t.submit();const outside=await mkdtemp(path.join(os.tmpdir(),'outside-evidence-'));const location=path.join(t.store.dir(t.id),'evidence');await rm(location,{recursive:true,force:true});await symlink(outside,location);
    await expect(t.approve()).rejects.toMatchObject({code:'SYMLINK_DENIED'});expect(await readdir(outside)).toEqual([]);expect((await t.store.load(t.id)).approvals).toEqual([]);
  });
  it('keeps an explicitly unknown DML response uncertain even if a row was written',async()=>{
    const t=await testEngine();await t.submit();await t.approve();await t.engine.prepare(t.id,1);
    const uncertain=new Engine(t.store,run=>{const adapter=t.engine.adapterFor(run);const mutate=adapter.mutate.bind(adapter);adapter.mutate=async request=>({...await mutate(request),unknown:true});return adapter;});
    const executed=await uncertain.execute(t.id,1);expect(executed.scenarios.scenario!.status).toBe('UNKNOWN');expect(executed.operations[0]!.state).toBe('UNKNOWN');
    const observed=await t.engine.collect(t.id,1);expect(observed.assertions[0]!.status).toBe('UNVERIFIABLE');await expect(t.engine.execute(t.id,1)).rejects.toMatchObject({code:'UNKNOWN_WRITE'});expect((await t.getAdapter().inspectState()).writes).toBe(1);
  });
});
