// Opt-in real PixInsight regression. Creates and closes only its own synthetic windows.
// Run: node scripts/smoke-runtime-preview.mjs <absolute evidence directory>
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { BridgeClient } from '../build/bridge/client.js';
import { execPjsrJson } from '../build/pjsr/exec.js';
import { renderToFile } from '../build/preview/render.js';
import { runtimeInfo } from '../build/tools/runtime.js';
import { embedICC, extractICC } from '../build/preview/icc.js';

if(!process.argv[2]) throw Error('Supply an evidence directory');
const out=resolve(process.argv[2]);await mkdir(out,{recursive:true});
const bridge=new BridgeClient();
const id='mcp_smoke_'+randomUUID().replaceAll('-','');
const q=JSON.stringify;
const script=code=>execPjsrJson(bridge,code,30000);
const state=()=>script(`(function(){var v=View.viewById(${q(id)}),im=v.image,all=[];for(var c=0;c<3;++c)for(var y=0;y<im.height;++y)for(var x=0;x<im.width;++x)all.push(im.sample(x,y,c));return JSON.stringify({history:v.historyIndex,file:v.window.filePath,stf:v.stf,rect:[im.selectedRect.x0,im.selectedRect.y0,im.selectedRect.x1,im.selectedRect.y1],channels:[im.firstSelectedChannel,im.lastSelectedChannel],pixels:all});})()`);
const report={};
try {
  report.runtime=await runtimeInfo(bridge,true);
  assert.equal(report.runtime.bridge.probe.status,'responsive');
  assert.equal(report.runtime.bridge.revisionStatus,'compatible');
  await script(`(function(){var w=new ImageWindow(32,24,3,32,true,true,${q(id)}),v=w.mainView;v.beginProcess();var patches=[[.65,.32,.18],[.2,.7,.2],[.1,.2,.7],[.8,.2,.7],[.1,.1,.1],[.5,.5,.5],[.9,.9,.9],[0,0,0]];for(var y=0;y<24;++y)for(var x=0;x<32;++x)for(var c=0;c<3;++c)v.image.setSample(patches[Math.floor(x/4)][c],x,y,c);v.image.resetSelections();v.endProcess();var T=new ICCProfileTransformation;T.targetProfile='Adobe RGB (1998)';T.toDefaultProfile=false;if(!T.executeOn(v,false))throw Error('fixture ICC failed');w.saveAs(${q(join(out,'source.xisf'))},false,false,true,false);v.image.render().save(${q(join(out,'source-raw.png'))});v.image.selectedRect=new Rect(3,4,15,16);v.image.selectedChannel=1;return JSON.stringify({created:v.id});})()`);
  const before=await state();
  report.png=await renderToFile(bridge,id,join(out,'managed.png'),'asis');
  report.jpeg=await renderToFile(bridge,id,join(out,'managed.jpg'),'asis',undefined,undefined,100);
  report.crop=await renderToFile(bridge,id,join(out,'crop.png'),'asis',[4,5,20,17],2);
  report.raw=await renderToFile(bridge,id,join(out,'raw.png'),'asis',undefined,undefined,undefined,{colorMode:'raw'});
  assert.equal(report.png.colorManagement.status,'managed-display');
  assert.equal(report.jpeg.colorManagement.outputICCVerified,true);
  assert.equal(report.crop.width,8);assert.equal(report.crop.height,6);
  assert.deepEqual(await state(),before);
  // Save the source's real profile beside encoded source pixels for an independent CMS comparison.
  const source=await script(`(function(){var f=new FileFormatInstance(new FileFormat('.xisf',true,false));try{f.open(${q(join(out,'source.xisf'))});return JSON.stringify({icc:f.iccProfile.toBase64()});}finally{f.close();}})()`);
  await writeFile(join(out,'source-tagged.png'),embedICC(await readFile(join(out,'source-raw.png')),Buffer.from(source.icc,'base64'),'png'));
  assert.ok(!extractICC(await readFile(join(out,'source-tagged.png')),'png').equals(extractICC(await readFile(join(out,'managed.png')),'png')));
  // Repeat with source sRGB, distinct from the default profile, and save PI's own display reference.
  await script(`(function(){var v=View.viewById(${q(id)});var T=new ICCProfileTransformation;T.targetProfile='sRGB IEC61966-2.1';T.toDefaultProfile=false;T.useBlackPointCompensation=true;T.useFloatingPointTransformation=true;if(!T.executeOn(v,false))throw Error('sRGB fixture failed');v.image.resetSelections();var bmp=v.image.render();v.window.applyColorTransformation(bmp,v);bmp.save(${q(join(out,'srgb-reference.png'))});return JSON.stringify({ready:true});})()`);
  report.srgbSource=await renderToFile(bridge,id,join(out,'srgb-display.png'),'asis');
  report.sourcePreserved=true;
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({sourcePreserved:true,runtime:report.runtime.bridge.probe,png:report.png.colorManagement,crop:[report.crop.width,report.crop.height]},null,2));
} finally {
  await script(`(function(){var w=ImageWindow.windowById(${q(id)});if(w&&!w.isNull)w.forceClose();return JSON.stringify({closed:true});})()`);
}
