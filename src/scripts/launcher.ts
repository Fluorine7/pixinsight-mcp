import path from 'node:path';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BridgeClient } from '../bridge/client.js';
import { execPjsrJson } from '../pjsr/exec.js';
import { buildWrapper, discoveryCode } from '../pjsr/script-file.js';
const execute = promisify(execFile);
export interface RuntimeInfo {
  sourceDirectory: string; baseDirectory: string; executable: string;
  platform: string; instance: number; version: string;
}
export interface ScriptInput {
  scriptId?: string; scriptPath?: string;
  parameters?: Record<string, string | number | boolean>;
  viewId?: string;
}
export function scriptCandidates(runtime: RuntimeInfo, input: ScriptInput): string[] {
  const p = runtime.platform === 'Windows' ? path.win32 : path.posix;
  if (Boolean(input.scriptPath) === Boolean(input.scriptId))
    throw new Error('Specify exactly one of scriptPath or scriptId');
  if (input.scriptPath) {
    if (!p.isAbsolute(input.scriptPath)) throw new Error('scriptPath must be absolute on the PixInsight host');
    return [input.scriptPath];
  }
  if (input.scriptId !== 'ImageSolver') throw new Error('Unknown scriptId; use an absolute scriptPath for custom scripts');
  return ['ImageSolver/ImageSolver.js', 'AdP/ImageSolver.js'].map(s => p.join(runtime.sourceDirectory, 'scripts', s));
}
export async function resolveScript(bridge: BridgeClient, input: ScriptInput) {
  const runtime: RuntimeInfo = await execPjsrJson(bridge, discoveryCode(), 10000);
  const candidates = scriptCandidates(runtime, input);
  const found = await execPjsrJson(bridge, `(function(){var p=${JSON.stringify(candidates)};return JSON.stringify({path:p.filter(function(s){return File.exists(s);})[0] || null});})()`, 10000);
  if (!found.path) throw new Error(`Script not found. Checked: ${candidates.join(', ')}`);
  // IPC and job files are local to the same machine as the existing file bridge.
  await access(runtime.executable);
  await access(found.path);
  return { ...runtime, scriptPath: found.path as string, candidates };
}
export function executionArgs(instance: number, wrapper: string): string[] {
  if (!Number.isInteger(instance) || instance < 1 || instance > 256) throw new Error('Invalid PixInsight instance');
  return [`--execute=${instance}:${wrapper}`];
}
export async function startScript(bridge: BridgeClient, input: ScriptInput) {
  const resolved = await resolveScript(bridge, input);
  const jobId = randomUUID();
  const dir = path.join(bridge.getBridgeDir(), 'script-jobs', jobId);
  await mkdir(dir, { recursive: true });
  const wrapperPath = path.join(dir, 'run.js');
  const resultPath = path.join(dir, 'result.json');
  const startedPath = path.join(dir, 'started');
  const job = { jobId, scriptPath: resolved.scriptPath, instance: resolved.instance,
    createdAt: new Date().toISOString(), resultPath, wrapperPath, startedPath };
  await writeFile(wrapperPath, buildWrapper({ ...input, parameters: input.parameters ?? {}, scriptPath: resolved.scriptPath, resultPath, startedPath }));
  await writeFile(path.join(dir, 'job.json'), JSON.stringify(job));
  try {
    await execute(resolved.executable, executionArgs(resolved.instance, wrapperPath), { timeout: 15000, maxBuffer: 1024 * 1024 });
  } catch (e) {
    // Never auto-retry: the IPC message may already have reached PI.
    await writeFile(path.join(dir, 'dispatch-error.txt'), String(e));
    return { ...job, status: 'dispatch_uncertain', error: String(e), message: 'Check this job before retrying; script may have been dispatched.' };
  }
  return { ...job, status: 'submitted', message: 'Submitted via PixInsight IPC. Poll get_script_job for completion; submission is not success.' };
}
export async function getScriptJob(bridge: BridgeClient, jobId: string, waitMs = 0): Promise<any> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) throw new Error('Invalid jobId');
  const dir = path.join(bridge.getBridgeDir(), 'script-jobs', jobId);
  const job = JSON.parse(await readFile(path.join(dir, 'job.json'), 'utf8'));
  const deadline = Date.now() + Math.max(0, Math.min(waitMs, 10000));
  do {
    try {
      const result = JSON.parse(await readFile(path.join(dir, 'result.json'), 'utf8'));
      return { ...job, ...result, message: 'Wrapper finished. Check scriptResult/log and task-specific postconditions; scripts may catch their own errors.' };
    } catch (e: any) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
    if (Date.now() >= deadline) break;
    await new Promise(r => setTimeout(r, 200));
  } while (true);
  let started = false;
  try { await access(path.join(dir, 'started')); started = true; } catch {}
  let dispatchError: string | undefined;
  try { dispatchError = await readFile(path.join(dir, 'dispatch-error.txt'), 'utf8'); } catch {}
  const age = Date.now() - Date.parse(job.createdAt);
  return { ...job, status: started ? 'running' : dispatchError ? 'dispatch_uncertain' : 'pending',
    ...(dispatchError ? { error: dispatchError } : {}),
    message: age > 60000 ? 'No completion result yet. Check PI console for preprocessing errors, modal dialogs or long execution. Do not retry blindly; polling does not cancel the script.' : 'No completion result yet; poll again.' };
}
