// BridgeClient unit tests, no PixInsight required. Each test gets a fresh
// temp bridge dir and plays the watcher's role by writing result files.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BridgeClient, EXPECTED_HANDLERS_REV } from "../build/bridge/client.js";

async function freshBridge(t, config = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-mcp-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const client = new BridgeClient({
    bridgeDir: dir,
    pollIntervalMs: 25,
    defaultTimeoutMs: 3000,
    ...config,
  });
  await client.ensureDirectories();
  return {
    client,
    commands: path.join(dir, "commands"),
    results: path.join(dir, "results"),
  };
}

/** Poll the commands dir until the client's command file appears; return it parsed. */
async function nextCommand(commandsDir, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const files = (await fs.readdir(commandsDir)).filter((f) => f.endsWith(".json"));
    if (files.length > 0) {
      const raw = await fs.readFile(path.join(commandsDir, files[0]), "utf8");
      return JSON.parse(raw);
    }
    if (Date.now() > deadline) throw new Error("no command file appeared");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function resultFor(cmd, extra = {}) {
  return {
    id: cmd.id,
    timestamp: new Date().toISOString(),
    status: "success",
    process: cmd.process,
    duration_ms: 1,
    // A current watcher stamps every success result with its handler revision
    // (dispatchCommand); results without it are treated as a stale module.
    outputs: { handlersRev: EXPECTED_HANDLERS_REV },
    message: "ok",
    ...extra,
  };
}

async function writeResult(resultsDir, cmd, extra = {}) {
  await fs.writeFile(path.join(resultsDir, `${cmd.id}.json`), JSON.stringify(resultFor(cmd, extra)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("success: result file resolves the command and is deleted after", async (t) => {
  const { client, commands, results } = await freshBridge(t);
  const pending = client.sendCommand("ping", "__test__", { a: 1 });
  const cmd = await nextCommand(commands);
  await sleep(100);
  await writeResult(results, cmd, { message: "done" });
  const res = await pending;
  assert.equal(res.status, "success");
  assert.equal(res.message, "done");
  assert.deepEqual(await fs.readdir(results), []);
});

test("command file: parseable JSON, correct fields, no .tmp left behind", async (t) => {
  const { client, commands, results } = await freshBridge(t);
  const pending = client.sendCommand("some_tool", "SomeProcess", { x: 1 }, {
    executeMethod: "executeOn",
    targetView: "v1",
  });
  const cmd = await nextCommand(commands); // throws if unparseable
  assert.equal(cmd.tool, "some_tool");
  assert.equal(cmd.process, "SomeProcess");
  assert.deepEqual(cmd.parameters, { x: 1 });
  assert.equal(cmd.targetView, "v1");
  const leftovers = (await fs.readdir(commands)).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
  await writeResult(results, cmd);
  await pending;
});

test("running ack then success", async (t) => {
  const { client, commands, results } = await freshBridge(t);
  const pending = client.sendCommand("slow", "__test__", {});
  const cmd = await nextCommand(commands);
  await writeResult(results, cmd, { status: "running", message: "in progress" });
  await sleep(300);
  await writeResult(results, cmd, { message: "finished" });
  const res = await pending;
  assert.equal(res.status, "success");
  assert.equal(res.message, "finished");
});

test("malformed result fails fast as MalformedResult after the grace window", async (t) => {
  const { client, commands, results } = await freshBridge(t, { defaultTimeoutMs: 10_000 });
  const pending = client.sendCommand("bad", "__test__", {});
  const cmd = await nextCommand(commands);
  await fs.writeFile(path.join(results, `${cmd.id}.json`), "this is not json {{{");
  const started = Date.now();
  const res = await pending;
  assert.equal(res.status, "error");
  assert.equal(res.error.type, "MalformedResult");
  // Failed via the ~2 s grace, not the 10 s timeout.
  assert.ok(Date.now() - started < 8000);
});

test("partial write completed within the grace window succeeds", async (t) => {
  const { client, commands, results } = await freshBridge(t, { defaultTimeoutMs: 10_000 });
  const pending = client.sendCommand("partial", "__test__", {});
  const cmd = await nextCommand(commands);
  const resPath = path.join(results, `${cmd.id}.json`);
  const full = JSON.stringify(resultFor(cmd, { message: "completed" }));
  await fs.writeFile(resPath, full.slice(0, 20)); // invalid prefix
  await sleep(500);
  await fs.writeFile(resPath, full);
  const res = await pending;
  assert.equal(res.status, "success");
  assert.equal(res.message, "completed");
});

test("stale module: success without handlersRev becomes a hard error", async (t) => {
  const { client, commands, results } = await freshBridge(t);
  const pending = client.sendCommand("ping", "__test__", {});
  const cmd = await nextCommand(commands);
  await writeResult(results, cmd, { outputs: {} });
  const res = await pending;
  assert.equal(res.status, "error");
  assert.equal(res.error.type, "HandlersRevisionMismatch");
  assert.match(res.error.message, /module:install/);
});

test("stale module: lower handlersRev becomes a hard error", async (t) => {
  const { client, commands, results } = await freshBridge(t);
  const pending = client.sendCommand("ping", "__test__", {});
  const cmd = await nextCommand(commands);
  await writeResult(results, cmd, { outputs: { handlersRev: EXPECTED_HANDLERS_REV - 1 } });
  const res = await pending;
  assert.equal(res.status, "error");
  assert.equal(res.error.type, "HandlersRevisionMismatch");
});

test("newer module: warns in the first result's message only, stays success", async (t) => {
  const { client, commands, results } = await freshBridge(t);
  for (const expectWarning of [true, false]) {
    const pending = client.sendCommand("ping", "__test__", {});
    const cmd = await nextCommand(commands);
    // Play the watcher fully: consume the command file, else the next loop
    // iteration reads this one again.
    await fs.rm(path.join(commands, `${cmd.id}.json`));
    await writeResult(results, cmd, { outputs: { handlersRev: EXPECTED_HANDLERS_REV + 1 } });
    const res = await pending;
    assert.equal(res.status, "success");
    assert.equal(/WARNING:.*newer/s.test(res.message), expectWarning);
  }
});

test("timeout: no result → Timeout error", async (t) => {
  const { client } = await freshBridge(t);
  const res = await client.sendCommand("void", "__test__", {}, { timeoutMs: 300 });
  assert.equal(res.status, "error");
  assert.equal(res.error.type, "Timeout");
});

test("cleanStaleCommands: reaps old/malformed json and old .tmp, keeps fresh", async (t) => {
  const { client, commands } = await freshBridge(t);
  const old = new Date(Date.now() - 20 * 60_000);
  await fs.writeFile(path.join(commands, "old.json"),
    JSON.stringify({ id: "old", timestamp: old.toISOString() }));
  await fs.writeFile(path.join(commands, "fresh.json"),
    JSON.stringify({ id: "fresh", timestamp: new Date().toISOString() }));
  await fs.writeFile(path.join(commands, "garbage.json"), "not json");
  await fs.writeFile(path.join(commands, "old.tmp"), "{}");
  await fs.utimes(path.join(commands, "old.tmp"), old, old);
  await fs.writeFile(path.join(commands, "fresh.tmp"), "{}");

  const cleaned = await client.cleanStaleCommands();
  assert.equal(cleaned, 3);
  const remaining = (await fs.readdir(commands)).sort();
  assert.deepEqual(remaining, ["fresh.json", "fresh.tmp"]);
});

test("cleanStaleCommands: reaps orphaned results (post-timeout leftovers) by mtime", async (t) => {
  const { client, results } = await freshBridge(t);
  const old = new Date(Date.now() - 20 * 60_000);
  // A result the watcher wrote after its client timed out and stopped reading.
  await fs.writeFile(path.join(results, "orphan.json"), JSON.stringify({ id: "orphan" }));
  await fs.utimes(path.join(results, "orphan.json"), old, old);
  await fs.writeFile(path.join(results, "orphan.tmp"), "{}");
  await fs.utimes(path.join(results, "orphan.tmp"), old, old);
  await fs.writeFile(path.join(results, "fresh.json"), JSON.stringify({ id: "fresh" }));

  const cleaned = await client.cleanStaleCommands();
  assert.equal(cleaned, 2);
  assert.deepEqual((await fs.readdir(results)).sort(), ["fresh.json"]);
});

test('durable command: timeout, restart, late result and same-ID retry execute once', async t => {
  const {client, commands, results} = await freshBridge(t);
  const id = await client.submitCommand('run_script','__script__',{code:'1'});
  const cmd = await nextCommand(commands);
  const timed = await client.waitForCommand(id, 30);
  assert.equal(timed.error.type, 'Timeout');
  assert.match(timed.error.message, new RegExp(id));
  assert.equal((await client.getCommandJob(id)).status, 'queued');
  await fs.rm(path.join(commands, id+'.json'));
  await writeResult(results, cmd, { status:'running' });
  assert.equal((await client.getCommandJob(id)).status, 'running');
  await writeResult(results, cmd, { message:'late success' });
  const restarted = new BridgeClient({bridgeDir:client.getBridgeDir(),pollIntervalMs:10});
  assert.equal((await restarted.getCommandJob(id)).status, 'success');
  await fs.rm(path.join(results,id+'.json'));
  assert.equal((await restarted.getCommandJob(id)).message, 'late success');
  assert.equal(await restarted.submitCommand('run_script','__script__',{code:'1'},{commandId:id}),id);
  assert.deepEqual(await fs.readdir(commands), []);
  await assert.rejects(restarted.submitCommand('run_script','__script__',{code:'2'},{commandId:id}),/different request/);
});

test('instance switching is refused while waiting; results remain on original instance', async t => {
  const {client,commands,results} = await freshBridge(t);
  const pending = client.sendCommand('ping','__test__',{});
  const cmd = await nextCommand(commands);
  assert.throws(()=>client.setBridgeDir('/tmp/other-instance'),/Cannot switch/);
  await writeResult(results,cmd);
  assert.equal((await pending).status,'success');
});

test('job IDs cannot traverse directories', async t => {
  const {client} = await freshBridge(t);
  await assert.rejects(client.getCommandJob('../../file'),/UUID/);
});
