import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToFile } from '../build/preview/render.js';

test('failed preview preserves the previous output and removes only owned staging files',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'pi-preview-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const output=join(dir,'preview.png');await writeFile(output,'previous image');
  const bridge={async sendCommand(){return {status:'success',outputs:{returnValue:JSON.stringify({error:'ICC unavailable'})}};}};
  await assert.rejects(renderToFile(bridge,'image',output,'asis'),/ICC unavailable/);
  assert.equal(await readFile(output,'utf8'),'previous image');
  assert.deepEqual(await readdir(dir),['preview.png']);
});

test('unsupported output paths fail before contacting PixInsight',async()=>{
  const bridge={sendCommand(){assert.fail('invalid path reached PI');}};
  await assert.rejects(renderToFile(bridge,'image','relative.png','asis'),/absolute/);
  await assert.rejects(renderToFile(bridge,'image',join(tmpdir(),'image.xisf'),'asis'),/absolute/);
});
