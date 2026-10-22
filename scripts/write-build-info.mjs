// Capture provenance at build time, never infer a running server's code from HEAD.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
function git(...args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}
const status = git('status', '--porcelain');
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
writeFileSync(new URL('build/build-info.json', root), JSON.stringify({
  buildId: randomUUID(), builtAt: new Date().toISOString(), version: pkg.version,
  commit: git('rev-parse', 'HEAD'), dirty: status === null ? null : status.length > 0,
  requiredNode: pkg.engines.node,
}, null, 2) + '\n');
