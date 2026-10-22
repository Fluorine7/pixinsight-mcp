import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { nodeMeetsRequirement } from '../build/tools/runtime.js';

test('runtime reports loaded process, missing watcher, and rebuild requiring restart; malformed envelopes stay protocol errors', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-runtime-test-'));
  const buildPath = new URL('../build/build-info.json', import.meta.url);
  const originalBuild = await readFile(buildPath);
  const transport = new StdioClientTransport({ command: process.execPath, args: ['build/index.js'],
    env: { ...process.env, PIXINSIGHT_MCP_BRIDGE_DIR: directory }, stderr: 'pipe' });
  const client = new Client({ name: 'runtime-test', version: '1' });
  t.after(async () => { await client.close(); await writeFile(buildPath, originalBuild); await rm(directory, { recursive: true, force: true }); });
  await client.connect(transport);
  const info = async () => JSON.parse((await client.callTool({name:'get_runtime_info',arguments:{probeWatcher:false}})).content[0].text);
  const first = await info();
  assert.equal(first.node.version, process.version);
  assert.equal(first.node.executable, process.execPath);
  const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
  assert.equal(first.server.sdkVersion, lock.packages['node_modules/@modelcontextprotocol/sdk'].version);
  assert.ok(first.server.build.buildId);
  assert.equal(first.server.restartRequired, false);
  assert.equal(first.bridge.heartbeat.state, 'missing');
  assert.equal(first.bridge.observedHandlersRevision, null);
  assert.equal(first.bridge.directory, directory);
  await writeFile(buildPath, JSON.stringify({...JSON.parse(originalBuild),buildId:'rebuilt-on-disk'}));
  const changed = await info();
  assert.equal(changed.server.build.buildId, first.server.build.buildId);
  assert.equal(changed.server.restartRequired, true);
  await writeFile(buildPath, originalBuild);
  for (const request of [
    { method:'tools/call' }, { method:'tools/call',params:{} },
    { method:'tools/call',params:{name:123} }, { method:'tools/call',params:{name:'get_runtime_info',arguments:[]} },
    { method:'tools/list',params:{cursor:42} }, { method:'initialize',params:{} },
  ]) await assert.rejects(client.request(request,z.object({}).passthrough()), error => error.code === -32602);
  await assert.rejects(client.request({method:'__proto__'},z.object({})), error => error.code === -32601);
  assert.equal((await client.ping()) !== undefined, true);
  const badArgument = await client.callTool({name:'get_runtime_info',arguments:{probeWatcher:'yes'}});
  assert.equal(badArgument.isError,true);
});

test('Node compatibility accepts patched branches and rejects unsupported or vulnerable versions', () => {
  const requirement='^22.23.4 || ^24.22.1 || ^26.12.1';
  for(const version of ['v22.23.4','24.22.1','26.13.0']) assert.equal(nodeMeetsRequirement(version,requirement),true);
  for(const version of ['22.23.3','24.22.0','26.12.0','25.0.0','27.0.0']) assert.equal(nodeMeetsRequirement(version,requirement),false);
});
