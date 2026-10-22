import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {renderScript} from '../build/pjsr/render.js';

function fixture({color=true, failAssign=false, failSave=false, saveFalse=false, failConversion=false, missingProfile=false, disabledCM=false}={}) {
  class Rect {constructor(...v){Object.assign(this,v.length===1?v[0]:{x0:v[0],y0:v[1],x1:v[2],y1:v[3]});}}
  class Point {constructor(p){Object.assign(this,p);}}
  const im={width:100,height:80,numberOfChannels:color?3:1,isColor:color,
    selectedRect:new Rect(10,11,20,21),selectedPoint:new Point({x:2,y:3}),firstSelectedChannel:0,lastSelectedChannel:0,
    set selectedChannel(c){this.firstSelectedChannel=c;this.lastSelectedChannel=c;},
    resetSelections(){this.selectedRect=new Rect(0,0,100,80);this.firstSelectedChannel=0;this.lastSelectedChannel=this.numberOfChannels-1;},
    median(){return [.04,.08,.12][this.firstSelectedChannel];},MAD(){return [.005,.007,.009][this.firstSelectedChannel];}};
  const view={id:'v',isNull:false,image:im,stf:[[.2,.01,1,-.1,1.1],[.3,.02,1,0,1],[.4,.03,1,0,1]]};
  const made=[],applied=[];
  class ImageWindow {
    constructor(w,h,n,bits,real,isColor,id){
      this.id=id;this.isNull=false;this.closed=false;this.mainView={beginProcess(){},endProcess(){},image:{width:w,height:h,
        assign(source,rect){if(failAssign)throw Error('assign failed');this.width=rect?rect.x1-rect.x0:source.width;this.height=rect?rect.y1-rect.y0:source.height;},
        cropTo(x0,y0,x1,y1){this.width=x1-x0;this.height=y1-y0;},
        render(){return {save(){if(failSave)throw Error('save failed');return !saveFalse;}}}}};made.push(this);
    }
    forceClose(){this.closed=true;}
    saveAs(){return true;}
    static windowById(id){return made.find(w=>w.id===id)??{isNull:true};}
  }
  view.window={mainView:view,applyColorTransformation(){if(failConversion)throw Error('conversion failed');}};
  class HistogramTransformation {executeOn(){applied.push(this.H);return true;}}
  return {im,made,applied,env:{View:{viewById:()=>view},ImageWindow,HistogramTransformation,Rect,Point,
    File:{readFile:()=>({length:missingProfile?0:560,toBase64:()=> 'fixture-profile'})},Settings:{readGlobal:key=> /IsEnabled|IsValid/.test(key)?!disabledCM:'display-profile',globalVariableType:()=>13}}};
}
function run(env,mode='boosted-unlinked',opts={}) {return JSON.parse(vm.runInNewContext(renderScript('v','/tmp/test.png',mode,undefined,undefined,undefined,{colorMode:"raw",...opts}),env));}

test('Boost is unlinked, records each row and maps each median to target .5',()=>{
  const {env,im}=fixture();const saved=JSON.stringify([im.selectedRect,im.selectedPoint,im.firstSelectedChannel,im.lastSelectedChannel]);
  const r=run(env);assert.equal(r.display.linked,false);assert.notEqual(r.stretch[0][1],r.stretch[1][1]);
  for(let c=0;c<3;c++){const [s,m,h]=r.stretch[c];const x=([.04,.08,.12][c]-s)/(h-s);const y=((m-1)*x)/((2*m-1)*x-m);assert.ok(Math.abs(y-.5)<1e-12);}
  assert.equal(JSON.stringify([im.selectedRect,im.selectedPoint,im.firstSelectedChannel,im.lastSelectedChannel]),saved);
});
test('fixed comparison reuses exact HT rows, including range terms',()=>{
  const {env}=fixture();const first=run(env);const fixed=run(env,'fixed',{fixedStretch:first.stretch});
  assert.deepEqual(fixed.stretch,first.stretch);
  const stored=run(env,'view');assert.deepEqual(stored.stretch[0],[.01,.2,1,-.1,1.1]);
});
test('mono STF maps to RGB/K row, temporary window names are unique',()=>{
  const {env,made,applied}=fixture({color:false});run(env,'view');run(env,'asis');
  assert.deepEqual(Array.from(applied[0][3]),[.01,.2,1,-.1,1.1]);assert.notEqual(made[0].id,made[1].id);
  assert.ok(made.every(w=>w.closed));
});
for(const failure of ['failAssign','failSave'])test(`render restores source and closes only its window on ${failure}`,()=>{
  const {env,im,made}=fixture({[failure]:true});const saved=JSON.stringify(im.selectedRect);
  const result=run(env);assert.match(result.error,/failed/);assert.equal(JSON.stringify(im.selectedRect),saved);assert.equal(made[0].closed,true);
});
test('fixed mode rejects invalid rows before contacting PI',()=>{
  assert.throws(()=>renderScript('v','x','fixed'),/requires/);
  assert.throws(()=>renderScript('v','x','fixed',undefined,undefined,undefined,{fixedStretch:{0:[1,.5,0,0,1]}}),/Invalid/);
});
test('crop copies the explicit rectangle rather than Image.assign copying the whole source',()=>{
  const {env}=fixture();
  const result=JSON.parse(vm.runInNewContext(renderScript('v','/tmp/test.png','asis',[5,6,17,20],undefined,undefined,{colorMode:'raw'}),env));
  assert.equal(result.width,12);assert.equal(result.height,14);
});
test('managed script waits for output embedding and keeps crop dimensions',()=>{
  const {env,made}=fixture();const result=run(env,'asis',{colorMode:'display'});
  assert.equal(result.colorManagement.status,'awaiting-embedding');
  assert.equal(result.colorManagement.outputICCVerified,false);
  assert.equal(result.width,100);assert.equal(result.height,80);
  assert.ok(made.every(w=>w.closed));
});
for(const failure of ['failConversion','missingProfile','saveFalse','disabledCM'])test(`managed preview fails closed and cleans up on ${failure}`,()=>{
  const {env,im,made}=fixture({[failure]:true});const saved=JSON.stringify([im.selectedRect,im.firstSelectedChannel,im.lastSelectedChannel]);
  const result=run(env,'asis',{colorMode:'display'});
  assert.ok(result.error);assert.equal(result.colorManagement,undefined);
  assert.equal(JSON.stringify([im.selectedRect,im.firstSelectedChannel,im.lastSelectedChannel]),saved);
  assert.ok(made.every(w=>w.closed));
});
