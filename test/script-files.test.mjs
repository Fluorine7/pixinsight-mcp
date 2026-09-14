import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptCandidates, executionArgs, getScriptJob } from '../build/scripts/launcher.js';
import { buildWrapper } from '../build/pjsr/script-file.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
for (const [platform,sourceDirectory,expected] of [
 ['Windows','D:\\Astronomy Suite\\PixInsight\\src','D:\\Astronomy Suite\\PixInsight\\src\\scripts\\ImageSolver\\ImageSolver.js'],
 ['macOS','/Volumes/Astro Tools/PI/src','/Volumes/Astro Tools/PI/src/scripts/ImageSolver/ImageSolver.js'],
 ['Linux','/home/astro/custom-pi/src','/home/astro/custom-pi/src/scripts/ImageSolver/ImageSolver.js']]) {
 test(`resolves custom ${platform} root and legacy fallback`,()=>{
  const c=scriptCandidates({platform,sourceDirectory},{scriptId:'ImageSolver'});
  assert.equal(c[0],expected); assert.match(c[1],/AdP/);
 });
}
test('reject ambiguous or relative paths; IPC keeps spaces as one argument',()=>{
 assert.throws(()=>scriptCandidates({platform:'Linux'},{scriptPath:'relative.js'}));
 assert.throws(()=>scriptCandidates({platform:'Linux'},{scriptPath:'/a.js',scriptId:'ImageSolver'}));
 assert.deepEqual(executionArgs(2,'/space name/test.js'),['--execute=2:/space name/test.js']);
 assert.throws(()=>executionArgs(0,'/a.js'));
});
test('preprocessor paths cannot inject directives; parameters are serialized',()=>{
 const args={resultPath:'/tmp/result',startedPath:'/tmp/start',parameters:{text:'a",b\n世界'}};
 assert.throws(()=>buildWrapper({...args,scriptPath:'/a"\nmalicious.js'}));
 const w=buildWrapper({...args,scriptPath:'D:\\Astro Suite\\test.js'});
 assert.match(w,/#include "D:\/Astro Suite\/test.js"/);
 assert.ok(w.includes(JSON.stringify(args.parameters)));
});
test('pending is not success, errors survive polling, job IDs cannot traverse',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'pi-script-jobs-'));
 try {
  const bridge={getBridgeDir:()=>root};const id=randomUUID(); const dir=path.join(root,'script-jobs',id);
  await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'job.json'),JSON.stringify({createdAt:new Date().toISOString(),jobId:id}));
  assert.equal((await getScriptJob(bridge,id)).status,'pending');
  await writeFile(path.join(dir,'started'),'started');
  assert.equal((await getScriptJob(bridge,id)).status,'running');
  await writeFile(path.join(dir,'result.json'),JSON.stringify({status:'error',error:'script failed'}));
  assert.equal((await getScriptJob(bridge,id)).error,'script failed');
  await assert.rejects(getScriptJob(bridge,'../escape'));
 } finally {await rm(root,{recursive:true,force:true});}
});
