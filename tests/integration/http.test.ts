import {it,expect} from 'vitest';
import http from 'node:http';
import {mkdtemp} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Store} from '../../src/core/store.js';import {Engine} from '../../src/execution/engine.js';import {defaultAdapter} from '../../src/cli/demo.js';import {startServer} from '../../src/server/http.js';
it('protects actual loopback API with Host, Origin, session and CSRF and preserves state',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'HTTP 워크벤치 '));const store=new Store(root),engine=new Engine(store,r=>defaultAdapter(r,store.root));const server=await startServer(engine,{uiRoot:root});try{
 expect(new URL(server.url).hostname).toBe('127.0.0.1');expect((await fetch(server.url+'/api/runs')).status).toBe(401);
 expect(await new Promise<number|undefined>((resolve,reject)=>{http.get(server.url+'/api/health',{headers:{host:'attacker.invalid'}},res=>{res.resume();resolve(res.statusCode)}).on('error',reject)})).toBe(403);
 expect((await fetch(server.url+'/api/session',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({token:server.token})})).status).toBe(403);
 const auth=await fetch(server.url+'/api/session',{method:'POST',headers:{Origin:server.url,'Content-Type':'application/json'},body:JSON.stringify({token:server.token})});expect(auth.status).toBe(200);const cookie=auth.headers.get('set-cookie')!.split(';')[0]!,csrf=(await auth.json() as {csrf:string}).csrf;
 expect((await fetch(server.url+'/api/demo',{method:'POST',headers:{Origin:server.url,Cookie:cookie}})).status).toBe(403);
 const headers={Origin:server.url,Cookie:cookie,'X-WB-CSRF':csrf,'Content-Type':'application/json'};
 const created=await fetch(server.url+'/api/demo',{method:'POST',headers,body:'{}'});expect(created.status).toBe(200);const run=await created.json() as {run_id:string;plan:{version:number;hash:string}};
 const forged=await fetch(`${server.url}/api/runs/${run.run_id}/command`,{method:'POST',headers,body:JSON.stringify({command:'prepare',version:run.plan.version,approved:true})});expect(forged.status).toBe(400);
 const stale=await fetch(`${server.url}/api/runs/${run.run_id}/command`,{method:'POST',headers,body:JSON.stringify({command:'approve',reviewed:true,scope:'execute',actor:'사용자',version:99,hash:run.plan.hash})});expect(stale.status).toBe(409);
 expect((await fetch(`${server.url}/api/runs/${run.run_id}/files/access.json`,{headers:{Cookie:cookie}})).status).toBe(400);
 expect((await engine.store.load(run.run_id)).approvals).toEqual([]);expect((await engine.store.list()).length).toBe(1);
 const outside=await fetch(server.url+'/api/runs',{method:'POST',headers,body:JSON.stringify({mode:'fake',target:'offline',sourceRoot:os.tmpdir()})});expect(outside.status).toBe(400);
 }finally{await server.close()}});
