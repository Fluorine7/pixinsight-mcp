import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {verifiedProcessScript,historyStateScript} from '../build/pjsr/process-state.js';
import {correctNativeXml,buildVerifiedContainer} from '../build/export/verified-xml.js';

function fixture(ok=true) {
  const view={id:'v',isNull:false,historyIndex:0,image:{width:10,height:8,numberOfChannels:3,bitsPerSample:32,isReal:true}};
  const w={mainView:view,filePath:'/checkpoint.xisf',mask:{isNull:true},maskEnabled:false,maskInverted:false};view.window=w;
  class Example {
    amount=.5;
    executeOn(v){if(ok)v.historyIndex++;return ok;}
  }
  return {view,env:{Example,View:{viewById:()=>view},ImageWindow:{windows:[w]}}};
}

test('false execute return is an error with unchanged history, not successful submission',()=>{
  const {env}=fixture(false);
  const outcome=JSON.parse(vm.runInNewContext(verifiedProcessScript('Example','v',{amount:.15}),env));
  assert.equal(outcome.status,'error');assert.equal(outcome.executeReturned,false);
  assert.equal(outcome.actualParameters.values.amount,.15);assert.equal(outcome.historyChanged,false);
});
test('successful process returns exact values, history evidence and Float32 state',()=>{
  const {env}=fixture();
  const outcome=JSON.parse(vm.runInNewContext(verifiedProcessScript('Example','v',{amount:.15}),env));
  assert.equal(outcome.status,'success');assert.equal(outcome.historyChanged,true);
  assert.equal(outcome.actualParameters.values.amount,.15);assert.equal(outcome.after.bitsPerSample,32);
  assert.equal(outcome.pixelChangeVerified,false);
});
test('unknown setting cannot execute and process class cannot inject code',()=>{
  const {env,view}=fixture();
  const outcome=JSON.parse(vm.runInNewContext(verifiedProcessScript('Example','v',{typo:1}),env));
  assert.match(outcome.error,/Unknown parameter/);assert.equal(view.historyIndex,0);
  assert.throws(()=>verifiedProcessScript('Example;evil()','v',{}),/Invalid/);
});
test('live history never rounds through toSource and preserves mask state',()=>{
  const {env,view}=fixture();
  const process={amount:.15,processId:()=> 'DeepSNR',toSource:()=>{throw Error('must not serialize');}};
  view.processing={length:1,at:()=>process,enabled:()=>true,maskId:()=> 'mask',maskInverted:()=>true};
  view.initialProcessing={processId:()=> 'ProcessContainer'};view.historyIndex=1;
  const h=JSON.parse(vm.runInNewContext(historyStateScript('v'),env));
  assert.equal(h.steps[0].parameters.values.amount,.15);assert.equal(h.steps[0].maskId,'mask');
  assert.equal(h.steps[0].maskInverted,true);assert.equal(h.steps[0].applied,true);
});
test('XPSM preserves native table column names and corrects scalar/table precision',()=>{
  const xml='<instance class="DeepSNR"><parameter id="amount" value="0.1"/><table id="H" rows="1"><tr><td id="c0" value="0.000"/><td id="m" value="0.5"/></tr></table></instance>';
  const result=correctNativeXml(xml,{amount:.15,H:[[.000000001,.345678901234]]});
  assert.match(result.xml,/id="amount" value="0.15"/);
  assert.match(result.xml,/id="c0" value="1e-9"/);
  assert.match(result.xml,/id="m" value="0.345678901234"/);
});
test('XPSM fails on unmapped aliases and unsupported table shapes',()=>{
  assert.throws(()=>correctNativeXml('<parameter id="old" value="1"/>',{new:1}),/alias/);
  assert.throws(()=>correctNativeXml('<table id="H" rows="1"><tr><td id="x" value="0"/></tr></table>',{H:[[1,2]]}),/column/);
});
test('XPSM escapes text once, keeps masks and excludes redo by default',()=>{
  const step={containerIndex:0,processId:'Example',parameters:{values:{s:'a & "b"\n<c>'},unreadable:{}},
    nativeXml:'<instance class="Example" id="Example_instance"><parameter id="s">old</parameter></instance>',enabled:false,maskId:'mask',maskInverted:true};
  const r=buildVerifiedContainer({source:{historyIndex:1},steps:[step,step]},'Test');
  assert.equal(r.processes.length,1);assert.match(r.xml,/<mask id="mask" inverted="true" deleted="false"/);
  assert.match(r.xml,/enabled="false"/);assert.match(r.xml,/a &amp; &quot;b&quot;\n&lt;c&gt;/);
});
