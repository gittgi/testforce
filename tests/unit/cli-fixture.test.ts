import { describe,it,expect,afterEach } from 'vitest';
import { mkdtemp,writeFile,mkdir,readFile,symlink,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../../src/core/store.js';
import { Engine } from '../../src/execution/engine.js';
import { defaultAdapter,createDemo } from '../../src/cli/demo.js';
import { parseOfflineFixture,installOfflineFixture,offlineOptions } from '../../src/cli/fake-config.js';
import { toolVersion } from '../../src/cli/doctor.js';
import { runProcess } from '../../src/salesforce/process.js';
import { FakeAdapter } from '../../src/salesforce/fake-adapter.js';

const temporary:string[]=[];
async function workspace(){const root=await mkdtemp(path.join(os.tmpdir(),'오프라인 CLI 공백 '));temporary.push(root);return root;}
afterEach(async()=>{await Promise.all(temporary.splice(0).map(p=>rm(p,{recursive:true,force:true})))});
const id='a01000000000001AAA';
function fixture(name='Thing__c') {return {schemaVersion:1,schemas:[{name,createable:true,updateable:true,deletable:true,fields:[{name:'Id',type:'id',nillable:false,defaultedOnCreate:true,createable:false,updateable:false},{name:'Label__c',type:'string',length:80,nillable:false,defaultedOnCreate:false,createable:true,updateable:true}]}],records:{[name]:{[id]:{Id:id,Label__c:'사용자 가상 기준정보'}}},jobs:{'707000000000001AAA':{id:'707000000000001AAA',status:'Completed',errors:0,processed:2,total:2,done:true}},constraints:[{object:name,category:'로컬 조건',detail:'승인으로 해석하지 않는 설명',source:'fixture.json'}]};}

describe('explicit generic offline fixtures and CLI',()=>{
  it('loads generic schemas, seed records and jobs, freezes configuration per run and uses current snapshot only',async()=>{
    const root=await workspace(),store=new Store(root),engine=new Engine(store,r=>defaultAdapter(r,store.root));
    await writeFile(path.join(root,'가상 fixture.json'),'\uFEFF'+JSON.stringify(fixture()).replaceAll(',',',\r\n'));
    await installOfflineFixture(store,'가상 fixture.json');
    const first=await engine.create('fake','my-offline');
    const adapter=defaultAdapter(first,store.root);
    expect(adapter.mode).toBe('fake');expect((await adapter.identity()).alias).toBe('my-offline');
    expect(await adapter.read('Thing__c',[id],['Label__c'])).toEqual([{Id:id,Label__c:'사용자 가상 기준정보'}]);
    expect((await adapter.job('707000000000001AAA')).status).toBe('Completed');
    const source={path:'Thing.cls',name:'Thing',kind:'class' as const,hash:'hash',content:'public class Thing {}',apiVersion:'66.0',methods:[]};
    first.source={hash:'snapshot',root,files:[source],gitCommit:null,dirty:false,selection:'Thing',warnings:[]};
    expect(await defaultAdapter(first,store.root).deployedSource(source)).toEqual({content:source.content,apiVersion:'66.0'});
    await writeFile(path.join(root,'가상 fixture.json'),JSON.stringify(fixture('Different__c')));await installOfflineFixture(store,'가상 fixture.json');
    expect((await defaultAdapter(first,store.root).describe('Thing__c')).name).toBe('Thing__c');
    await expect(defaultAdapter(first,store.root).describe('Different__c')).rejects.toMatchObject({code:'FAKE_SCHEMA'});
    const second=await engine.create('fake','second');expect((await defaultAdapter(second,store.root).describe('Different__c')).name).toBe('Different__c');
    expect((await defaultAdapter(first,store.root).constraints(['Thing__c'])).at(-1)?.source.match(/명시적 오프라인 fixture/g)).toHaveLength(1);
  });
  it('never assigns the demonstration schema or behavior to an ordinary fake run or live adapter',async()=>{
    const root=await workspace(),store=new Store(root),engine=new Engine(store,r=>defaultAdapter(r,store.root));
    const ordinary=await engine.create('fake','offline');await expect(defaultAdapter(ordinary,store.root).describe('Example__c')).rejects.toMatchObject({code:'FAKE_SCHEMA'});
    const demo=await createDemo(engine);expect((await defaultAdapter(demo,store.root).describe('Example__c')).name).toBe('Example__c');
    const live=defaultAdapter({...ordinary,mode:'live'},store.root);expect(live.mode).toBe('live');expect(live).not.toBeInstanceOf(FakeAdapter);
  });
  it('rejects fixture code hooks, path overrides, invented source, false mode and malformed schema references',()=>{
    for(const extra of [{mutationHook:'function(){}'},{statePath:'../../outside'},{sourceFiles:[]},{identity:{mode:'live'}},{schemas:[fixture().schemas[0],fixture().schemas[0]]}])expect(()=>parseOfflineFixture(JSON.stringify({...fixture(),...extra}))).toThrow();
    expect(()=>parseOfflineFixture(JSON.stringify({...fixture(),records:{Missing__c:{[id]:{Id:id}}}}))).toThrow('Describe');
    expect(()=>parseOfflineFixture(JSON.stringify({...fixture(),records:{Thing__c:{[id]:{Id:'a01000000000002AAA',Label__c:'bad'}}}}))).toThrow('Id');
    expect(()=>parseOfflineFixture('{"schemaVersion":1,"__proto__":{}}')).toThrow('예약된');
    expect(()=>parseOfflineFixture(JSON.stringify({...fixture(),jobs:{'707000000000001AAA':{...fixture().jobs['707000000000001AAA'],done:false}}}))).toThrow('Job');
  });
  it('rejects traversal, symlink escape, and tampered snapshot symlinks',async()=>{
    const root=await workspace(),outside=await workspace(),store=new Store(root);await writeFile(path.join(outside,'outside.json'),JSON.stringify(fixture()));
    await expect(installOfflineFixture(store,path.join(outside,'outside.json'))).rejects.toMatchObject({code:'PATH_DENIED'});
    await symlink(path.join(outside,'outside.json'),path.join(root,'linked.json'));
    await expect(installOfflineFixture(store,'linked.json')).rejects.toMatchObject({code:'SYMLINK_DENIED'});
    const engine=new Engine(store,r=>defaultAdapter(r,store.root)),run=await engine.create('fake','offline');
    await symlink(path.join(outside,'outside.json'),path.join(store.dir(run.run_id),'offline-fixture.json'));
    expect(()=>offlineOptions(run,store.root)).toThrow('심볼릭 링크');
  });
  it('actually initializes fixture CLI from Korean/space path and rejects live fixture configuration',async()=>{
    const root=await workspace();await writeFile(path.join(root,'입력 fixture.json'),JSON.stringify(fixture()));
    const main=fileURLToPath(new URL('../../src/cli/main.ts',import.meta.url));
    const args=['--import','tsx',main,'--workspace',root,'init','--mode','fake','--fixture','입력 fixture.json'];
    const result=await runProcess(process.execPath,args);expect(result.exitCode).toBe(0);expect(JSON.parse(result.stdout).fixture.objects).toEqual(['Thing__c']);
    expect(JSON.parse(await readFile(path.join(root,'.workbench/offline-fixture.json'),'utf8')).schemas[0].name).toBe('Thing__c');
    const rejected=await runProcess(process.execPath,[...args.slice(0,-3),'live','--fixture','입력 fixture.json']);
    expect(rejected.exitCode).toBe(1);expect(JSON.parse(rejected.stdout).code).toBe('FAKE_MODE_REQUIRED');
  });
  it('doctor executes a Windows sf.cmd Node entry with literal argv instead of invoking cmd.exe',async()=>{
    const root=await workspace(),entry=path.join(root,'node_modules/@salesforce/cli/bin/run.js');await mkdir(path.dirname(entry),{recursive:true});
    await writeFile(entry,'// @salesforce/cli\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));');
    const wrapper=path.join(root,'sf.cmd');await writeFile(wrapper,'@echo off\r\nnode "%~dp0\\node_modules\\@salesforce\\cli\\bin\\run.js" %*\r\n');
    expect(await toolVersion('sf',root,{platform:'win32',executable:wrapper,node:process.execPath})).toBe('["--version"]');
  });
  it('does not overwrite seeded fake IDs or collide after reconstructing persisted state',async()=>{
    const root=await workspace(),seed='a00000000000009AAA',data=fixture(),statePath=path.join(root,'fake-state.json');
    const adapter=new FakeAdapter({schemas:data.schemas,statePath,records:{Thing__c:{[seed]:{Id:seed,Label__c:'보존할 기준정보'}}}});
    const inserted=await adapter.mutate({object:'Thing__c',verb:'insert',allOrNone:true,records:[{key:'new',fields:{Label__c:'새 데이터'}}]});
    expect(inserted.results[0]!.id).toBe('a00000000000010AAA');expect((await adapter.read('Thing__c',[seed],['Label__c']))[0]!.Label__c).toBe('보존할 기준정보');
    const persisted=JSON.parse(await readFile(statePath,'utf8'));persisted.counter=0;await writeFile(statePath,JSON.stringify(persisted));
    const resumed=new FakeAdapter({schemas:data.schemas,statePath});
    expect((await resumed.mutate({object:'Thing__c',verb:'insert',allOrNone:true,records:[{key:'next',fields:{Label__c:'재개 데이터'}}]})).results[0]!.id).toBe('a00000000000011AAA');
  });
});
