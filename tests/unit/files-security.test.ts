import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import ExcelJS from 'exceljs';
import { generateReports } from '../../src/reports/index.js';
import { inspectWorkbookFile } from '../../src/workbook/index.js';
import { verifyImportMapping, type ImportMapping } from '../../src/imports/index.js';
import type { ObjectDescribe, Run } from '../../src/core/model.js';
const require=createRequire(import.meta.url);
const JSZip=require('jszip'); // ExcelJS's installed ZIP library, used only to craft adversarial test inputs.
let dir:string;beforeEach(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'xlsx-security-'));});afterEach(async()=>{await rm(dir,{recursive:true,force:true});});
async function archive(files:Record<string,string|Buffer>,compression:'STORE'|'DEFLATE'='DEFLATE') {const zip=new JSZip();for(const[n,v]of Object.entries(files))zip.file(n,v);const output=path.join(dir,'malicious.xlsx');await writeFile(output,await zip.generateAsync({type:'nodebuffer',compression}));return output;}

describe('XLSX archive checks',()=>{
 it('rejects macros and embedded executable components before workbook parsing',async()=>{for(const name of ['xl/vbaProject.bin','xl/activeX/activeX1.xml','xl/embeddings/object1.bin']){const file=await archive({[name]:'content'});await expect(inspectWorkbookFile(file)).rejects.toThrow('안전하지 않은');}});
 it('rejects ZIP traversal and absolute entries without extracting them',async()=>{for(const name of ['../outside.xml','/outside.xml','C:/outside.xml']){const file=await archive({[name]:'content'});await expect(inspectWorkbookFile(file)).rejects.toThrow();}});
 it('rejects declared expanded-size abuse and extreme compression ratios',async()=>{const zip=new JSZip();zip.file('xl/worksheet.xml','small');const buffer:Buffer=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});const central=buffer.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));buffer.writeUInt32LE(150*1024*1024,central+24);const file=path.join(dir,'size.xlsx');await writeFile(file,buffer);await expect(inspectWorkbookFile(file)).rejects.toThrow();const ratio=await archive({'xl/sheet.xml':'A'.repeat(2*1024*1024)});await expect(inspectWorkbookFile(ratio)).rejects.toThrow('크기 제한');});
 it('rejects external entities, relationships, and macro content types',async()=>{for(const content of ['<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>','<Relationship TargetMode="External" Target="https://evil.invalid"/>','<Types><Override ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>']){const file=await archive({'xl/input.xml':content});await expect(inspectWorkbookFile(file)).rejects.toThrow('외부');}});
 it('serializes the ExcelJS UUID-using conditional formatting extension',async()=>{const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('UUID compatibility');sheet.addRows([[1],[2],[3]]);sheet.addConditionalFormatting({ref:'A1:A3',rules:[{type:'iconSet',iconSet:'3Stars',cfvo:[{type:'percent',value:0},{type:'percent',value:33},{type:'percent',value:67}]}]});const bytes=await book.xlsx.writeBuffer();expect(bytes.byteLength).toBeGreaterThan(1000);const zip=await JSZip.loadAsync(bytes);const xml=await zip.file('xl/worksheets/sheet1.xml').async('string');expect(xml).toMatch(/x14:cfRule/);expect(xml).toMatch(/[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}/i);});
});

describe('Import read-back verification',()=>{
 it('compares metadata-aware values without granting creation ownership',()=>{const mapping:ImportMapping={key:'key',id:'a01000000000001AAA',object:'Arbitrary__c',scenarioId:'scenario',operation:'insert',proof:'unique-echoed-fields',requiresVerification:true,fields:{Code__c:'00123',Active__c:'true',Amount__c:'12345.1200',When__c:'2026-10-15T10:00:00+09:00',Clear__c:''}};const d:ObjectDescribe={name:'Arbitrary__c',createable:true,updateable:true,deletable:true,fields:[['Code__c','string'],['Active__c','boolean'],['Amount__c','decimal'],['When__c','datetime'],['Clear__c','string']].map(([name,type])=>({name:name!,type:type!,nillable:true,defaultedOnCreate:false,createable:true,updateable:true}))};const actual={Id:mapping.id,Code__c:'00123',Active__c:true,Amount__c:'12345.12',When__c:'2026-10-15T01:00:00Z',Clear__c:null};expect(verifyImportMapping(mapping,actual,d)).toMatchObject({matches:true,ownership:'unresolved'});expect(verifyImportMapping(mapping,{...actual,Code__c:123},d)).toMatchObject({matches:false,mismatchedFields:['Code__c']});expect(verifyImportMapping(mapping,{Id:mapping.id},d).missingFields).toContain('Amount__c');});
});


describe('report credential redaction',()=>{
 it('does not export authentication strings from an external error or AI note to Markdown, workbook or evidence',async()=>{
  const text='external failure accessToken=REPORT_ACCESS_SECRET refresh_token=REPORT_REFRESH_SECRET Bearer REPORT_BEARER_SECRET 00D000000000000!REPORT_SESSION_SECRET';
  const run:Run={schemaVersion:1,run_id:'redaction-run',createdAt:'2026-10-15T00:00:00Z',updatedAt:'2026-10-15T00:00:00Z',mode:'fake',target:'offline',sourceRoot:'/virtual',status:'ERROR',paused:false,planHistory:[],approvals:[],bindings:{},operations:[{op_id:'op',scenarioId:'scenario',phase:'action',planVersion:1,requestHash:'hash',state:'UNKNOWN',startedAt:'2026-10-15T00:00:00Z',request:{},error:text}],scenarios:{},assertions:[],aiNotes:[{at:'2026-10-15T00:00:00Z',text,evidenceRefs:[]}],cleanup:{decision:'pending',status:'pending',results:[]},events:[]};
  const output=await generateReports(run,dir);const md=await readFile(output.markdownPath,'utf8'),evidence=await readFile(output.evidencePath,'utf8');const book=new ExcelJS.Workbook();await book.xlsx.readFile(output.workbookPath);let cells='';for(const sheet of book.worksheets)sheet.eachRow(row=>row.eachCell(cell=>{cells+=String(cell.value);}));
  for(const secret of ['REPORT_ACCESS_SECRET','REPORT_REFRESH_SECRET','REPORT_BEARER_SECRET','REPORT_SESSION_SECRET']){expect(md).not.toContain(secret);expect(evidence).not.toContain(secret);expect(cells).not.toContain(secret);}
 });
});
