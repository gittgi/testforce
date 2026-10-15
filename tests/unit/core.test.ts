import {describe,it,expect} from 'vitest';
import {AssertionSchema,PlanSchema} from '../../src/core/model.js';
import {compare} from '../../src/core/compare.js';
import {hash} from '../../src/core/hash.js';
import {Store,safePath} from '../../src/core/store.js';
import {redact} from '../../src/core/errors.js';
import {mkdtemp,symlink,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
const a=(extra:Record<string,unknown>={})=>AssertionSchema.parse({id:'a',scenarioId:'s',label:'조건',subject:{kind:'return'},operator:'eq',expected:1,...extra});
describe('declarative comparison',()=>{
 it('does not pass missing evidence, including inequality',()=>{expect(compare(a(),undefined).status).toBe('UNVERIFIABLE');expect(compare(a({operator:'ne'}),undefined).status).toBe('UNVERIFIABLE');expect(compare(a(),1,undefined,'not-executed').status).toBe('NOT_EXECUTED')});
 it('preserves precise decimal values and approved tolerance',()=>{expect(compare(a({valueType:'decimal',expected:'9007199254740993.123456'}),'9007199254740993.123456').status).toBe('MATCH');expect(compare(a({valueType:'decimal',expected:'9007199254740993.123456'}),'9007199254740993.123457').status).toBe('MISMATCH');expect(compare(a({expected:1,tolerance:0.01}),1.009).status).toBe('MATCH')});
 it('compares explicit timezone, list ordering, changes, ranges, errors',()=>{expect(compare(a({valueType:'datetime',expected:'2026-10-15T00:00:00Z'}),'2026-10-15T09:00:00+09:00').status).toBe('MATCH');expect(compare(a({valueType:'datetime'}),'2026-10-15T09:00:00').status).toBe('UNVERIFIABLE');expect(compare(a({unordered:true,expected:['a','b']}),['b','a']).status).toBe('MATCH');expect(compare(a({operator:'changed'}),2,1).status).toBe('MATCH');expect(compare(a({operator:'range',expected:[1,3]}),3).status).toBe('MATCH');expect(compare(a({operator:'includes',expected:'INVALID_FIELD'}),'INVALID_FIELD: rejected').status).toBe('MATCH')});
 it('treats null separately from absent evidence',()=>{expect(compare(a({operator:'null'}),null).status).toBe('MATCH');expect(compare(a({operator:'exists'}),[]).status).toBe('MISMATCH');expect(compare(a({operator:'absent'}),[]).status).toBe('MATCH')});
});
describe('persistence security',()=>{
 it('hashes key order deterministically and binds contents',()=>{expect(hash({b:2,a:1})).toBe(hash({a:1,b:2}));expect(hash({a:1})).not.toBe(hash({a:2}))});
 it('rejects traversal and symlink escapes in Korean/spaced workspace',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'한글 공간 '));const outside=await mkdtemp(path.join(os.tmpdir(),'outside'));await writeFile(path.join(outside,'secret'),'private');await symlink(outside,path.join(root,'link'));await expect(safePath(root,'../secret')).rejects.toThrow();await expect(safePath(root,'link/secret')).rejects.toThrow();await mkdir(path.join(root,'data'));expect(await safePath(root,'data/new',true)).toContain('data')});
 it('blocks double clicks with a shared process/file lock',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'lock '));const store=new Store(root);let release!:()=>void;const wait=new Promise<void>(r=>release=r);const first=store.lock('run',()=>wait);await new Promise(r=>setTimeout(r,50));await expect(store.lock('run',async()=>undefined)).rejects.toThrow('다른 작업');release();await first;await expect(store.lock('run',async()=>true)).resolves.toBe(true)});
 it('redacts common credential formats',()=>{const text=redact('Bearer secret accessToken=token refresh_token="refresh" 00D000000000000!session');expect(text).not.toContain(' secret');expect(text).not.toContain('=token');expect(text).not.toContain('!session')});
});
