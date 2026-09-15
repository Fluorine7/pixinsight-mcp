import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {BridgeClient, EXPECTED_HANDLERS_REV} from '../build/bridge/client.js';
import {registerProcessingTools} from '../build/tools/processing.js';

test('run_process async submission, durable query and retry preserve one command',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-tool-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const bridge=new BridgeClient({bridgeDir:dir});
  const handlers={};registerProcessingTools({tool(n,d,s,fn){handlers[n]=fn;}},bridge);
  const submitted=JSON.parse((await handlers.run_process({processId:'HistogramTransformation',viewId:'v',waitMs:0})).content[0].text);
  assert.equal(submitted.status,'submitted');
  const command=JSON.parse(await fs.readFile(path.join(dir,'commands',submitted.commandId+'.json'),'utf8'));
  assert.equal(command.tool,'run_script');
  await fs.rm(path.join(dir,'commands',submitted.commandId+'.json'));
  await fs.writeFile(path.join(dir,'results',submitted.commandId+'.json'),JSON.stringify({
    id:submitted.commandId,status:'success',outputs:{handlersRev:EXPECTED_HANDLERS_REV,returnValue:JSON.stringify({status:'error',executeReturned:false})}
  }));
  const queried=await handlers.get_command_job({commandId:submitted.commandId});
  assert.equal(queried.isError,true);
  assert.equal(JSON.parse(queried.content[0].text).execution.executeReturned,false);
  const retry=await handlers.run_process({processId:'HistogramTransformation',viewId:'v',commandId:submitted.commandId,waitMs:100});
  assert.equal(retry.isError,true);assert.deepEqual(await fs.readdir(path.join(dir,'commands')),[]);
});
