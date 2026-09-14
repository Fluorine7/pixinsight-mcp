import assert from "node:assert/strict";
import {execPjsrJson} from "../build/pjsr/exec.js";
import {BridgeClient} from '../build/bridge/client.js';
import {resolveScript,startScript,getScriptJob} from '../build/scripts/launcher.js';
import {fileURLToPath} from 'node:url';
const bridge=new BridgeClient();
console.log('RESOLVE',await resolveScript(bridge,{scriptId:'ImageSolver'}));
const job=await startScript(bridge,{scriptPath:fileURLToPath(new URL('./hello.js',import.meta.url)),parameters:{text:'hello, 世界'}});
console.log('JOB',job);
const result=await getScriptJob(bridge,job.jobId,10000);
assert.equal(result.status,'completed');
assert.match(result.log,/MCP script smoke OK/);
console.log('RESULT',result);
const bad=await startScript(bridge,{scriptPath:fileURLToPath(new URL('./error.js',import.meta.url))});
const error=await getScriptJob(bridge,bad.jobId,10000);
assert.equal(error.status,'error');
assert.match(error.error,/Expected MCP test failure/);
console.log('EXPECTED_ERROR',error);
// The negative solver test must never process a user's open image.
const windows=await execPjsrJson(bridge,'JSON.stringify({count:ImageWindow.windows.length})');
if(windows.count===0){
const solver=await startScript(bridge,{scriptId:'ImageSolver',parameters:{non_interactive:true,useActive:true}});
const solverError=await getScriptJob(bridge,solver.jobId,10000);
assert.equal(solverError.status,'error');
console.log('SOLVER_NO_IMAGE',solverError);
}else console.log('Skipped negative ImageSolver test: images are open.');
