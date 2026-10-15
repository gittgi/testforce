import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Engine} from '../src/execution/engine.js';
import {Store} from '../src/core/store.js';
import {FakeAdapter,type FakeOptions} from '../src/salesforce/index.js';
import {PlanSchema,ScenarioSchema,RecordSpecSchema,ActionSchema,AssertionSchema,type Plan,type Run,type ObjectDescribe,type SalesforceAdapter} from '../src/core/model.js';
export const thingSchema:ObjectDescribe={name:'Probe__c',createable:true,updateable:true,deletable:true,fields:[{name:'Id',type:'id',nillable:false,defaultedOnCreate:true,createable:false,updateable:false},{name:'Text__c',type:'string',nillable:false,defaultedOnCreate:false,createable:true,updateable:true,length:80},{name:'Amount__c',type:'double',nillable:true,defaultedOnCreate:false,createable:true,updateable:true},{name:'Parent__c',type:'reference',nillable:true,defaultedOnCreate:false,createable:true,updateable:true,referenceTo:['Probe__c']}]};
export const secondarySchema:ObjectDescribe={name:'Sample__c',createable:true,updateable:true,deletable:true,fields:[{name:'Id',type:'id',nillable:false,defaultedOnCreate:true,createable:false,updateable:false},{name:'Enabled__c',type:'boolean',nillable:false,defaultedOnCreate:false,createable:true,updateable:true}]};
export const fixtureRecord=(key='fixture',scenarioId='scenario',fields:Record<string,unknown>={Text__c:{kind:'value',value:'before'}})=>RecordSpecSchema.parse({key,scenarioId,object:'Probe__c',stage:'fixture',ownership:'created',fields});
export const inputRecord=(key='input',scenarioId='scenario',fields:Record<string,unknown>={Text__c:{kind:'value',value:'after'}})=>RecordSpecSchema.parse({...fixtureRecord(key,scenarioId,fields),stage:'action'});
export const insertAction=(key='input',id='insert')=>ActionSchema.parse({id,kind:'dml',verb:'insert',object:'Probe__c',recordKeys:[key],impact:{description:'이번 실행의 독립적인 신규 레코드',bounded:true}});
export const scenario=(id='scenario',extra:Record<string,unknown>={})=>ScenarioSchema.parse({id,title:id,purpose:'엔진 수용 테스트',rationale:'로컬 가상 fixture',sourceRefs:[{path:'force-app/ProbeService.cls',symbol:'ProbeService'}],selected:true,execution:'tool',actions:[insertAction(id==='scenario'?'input':id+'Input',id+'Insert')],observation:{},...extra});
export const assertion=(scenarioId='scenario',key='input',extra:Record<string,unknown>={})=>AssertionSchema.parse({id:scenarioId+'Expected',scenarioId,label:'저장값',subject:{kind:'record',key,field:'Text__c'},operator:'eq',expected:'after',...extra});
export async function testEngine(options:FakeOptions={},transform?:(adapter:FakeAdapter,run:Run)=>SalesforceAdapter){
 const root=await mkdtemp(path.join(os.tmpdir(),'워크벤치 테스트 '));await mkdir(path.join(root,'force-app'));await writeFile(path.join(root,'sfdx-project.json'),JSON.stringify({packageDirectories:[{path:'force-app'}],sourceApiVersion:'65.0'}));await writeFile(path.join(root,'force-app','ProbeService.cls'),`public class ProbeService implements Database.Batchable<SObject> { public static String echo(String input) { return input; } public Database.QueryLocator start(Database.BatchableContext context) { return Database.getQueryLocator('SELECT Id FROM Probe__c'); } public void execute(Database.BatchableContext context, List<SObject> scope) {} public void finish(Database.BatchableContext context) {} }`);
 const store=new Store(root);let latest:FakeAdapter|undefined;let identityOverride:FakeOptions['identity']=options.identity;
 const engine=new Engine(store,run=>{latest=new FakeAdapter({...options,identity:identityOverride,statePath:path.join(root,'.workbench','fake-state.json'),sourceFiles:run.source?.files,schemas:options.schemas??[thingSchema,secondarySchema]});return transform?transform(latest,run):latest;});
 const created=await engine.create(transform?'live':'fake','test');const analyzed=await engine.analyze(created.run_id,'ProbeService');
 const adapter=latest!;const org=await (transform?transform(adapter,analyzed):adapter).identity();
 const plan=PlanSchema.parse({schemaVersion:1,plan_id:'plan-test',version:1,hash:'',org,source:analyzed.source,scenarios:[scenario()],records:[inputRecord()],expectations:[assertion()],policies:{existingMutation:false,notes:''}});
 const submit=async(input:Plan=plan)=>engine.submit(created.run_id,{run_id:created.run_id,request_id:analyzed.analysisRequest!.request_id,plan_version:0,source_snapshot_hash:analyzed.source!.hash,plan:input});
 const approve=async(scope:'prepare'|'execute'='execute')=>{const run=await store.load(created.run_id);return engine.approve(run.run_id,run.plan!.version,run.plan!.hash,scope,'테스트 사용자','terminal');};
 return {root,store,engine,id:created.run_id,analyzed,plan,submit,approve,getAdapter:()=>latest!,setIdentity:(value:FakeOptions['identity'])=>{identityOverride=value;}};
}
