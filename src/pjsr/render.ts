import { randomUUID } from "node:crypto";

export type StretchMode = "auto" | "auto-unlinked" | "boosted-unlinked" | "fixed" | "asis" | "view";
export interface DisplayOptions {
  colorMode?: "display" | "raw";
  referenceViewId?: string;
  /** HT order: shadows, midtones, highlights, low range, high range. */
  fixedStretch?: Record<string, number[]>;
  shadowsClipping?: number;
  targetBackground?: number;
}

export function renderScript(
  viewId: string, outputPath: string, stf: StretchMode,
  rect?: [number, number, number, number], downsample?: number, quality?: number,
  display: DisplayOptions = {}
): string {
  if (stf === "fixed" && !display.fixedStretch) throw new Error("fixed mode requires fixedStretch");
  if (stf !== "fixed" && display.fixedStretch) throw new Error("fixedStretch requires fixed mode");
  if (display.referenceViewId && !["auto", "auto-unlinked", "boosted-unlinked"].includes(stf))
    throw new Error("referenceViewId requires an automatic stretch mode");
  for (const [key, row] of Object.entries(display.fixedStretch ?? {})) {
    if (!/^[0-3]$/.test(key) || row.length !== 5 || !row.every(Number.isFinite) ||
        row[0] < 0 || row[2] > 1 || row[0] >= row[2] || row[1] <= 0 || row[1] >= 1 || row[3] > 0 || row[4] < 1)
      throw new Error("Invalid fixedStretch HT row");
  }
  if (display.fixedStretch && !Object.keys(display.fixedStretch).length) throw new Error("Empty fixedStretch");
  const mode = JSON.stringify(stf), opts = JSON.stringify(display);
  const tmpId = "mcp_render_" + randomUUID().replace(/-/g, "");
  return `(function(){
    var v=View.viewById(${JSON.stringify(viewId)});
    if(!v || v.isNull) return JSON.stringify({error:'Image not found'});
    var src=v.image, mode=${mode}, opts=${opts}, tw=null, processing=false, warnings=[];
    function selection(im) { return {rect:new Rect(im.selectedRect),point:new Point(im.selectedPoint),first:im.firstSelectedChannel,last:im.lastSelectedChannel}; }
    function restore(im,s) { im.selectedRect=s.rect;im.selectedPoint=s.point;im.firstSelectedChannel=s.first;im.lastSelectedChannel=s.last; }
    var saved=selection(src), ref=null, refSaved=null;
    var htRows=null, provenance={mode:mode,referenceViewId:opts.referenceViewId || v.id};
    try {
      src.resetSelections();
      if(mode==='fixed') htRows=opts.fixedStretch;
      else if(mode==='view') {
        var s=v.stf;htRows={};
        if(src.isColor) for(var c=0;c<3;++c) htRows[c]=[s[c][1],s[c][0],s[c][2],s[c][3],s[c][4]];
        else htRows[3]=[s[0][1],s[0][0],s[0][2],s[0][3],s[0][4]];
        provenance.note='Uses stored view STF, regardless of GUI STF enable state';
      } else if(mode!=='asis') {
        ref=opts.referenceViewId?View.viewById(opts.referenceViewId):v;
        if(!ref || ref.isNull) throw new Error('STF reference view not found');
        if(ref.image.isColor!==src.isColor || ref.image.width!==src.width || ref.image.height!==src.height)
          throw new Error('STF reference geometry/color must match target');
        refSaved=selection(ref.image);ref.image.resetSelections();
        var linked=mode==='auto', nch=ref.image.isColor?3:1, meds=[],mads=[];
        var clip=opts.shadowsClipping===undefined?(mode==='boosted-unlinked'?-1.8:-2.8):opts.shadowsClipping;
        var target=opts.targetBackground===undefined?(mode==='boosted-unlinked'?0.5:0.25):opts.targetBackground;
        for(var c=0;c<nch;++c) { ref.image.selectedChannel=c;meds.push(ref.image.median());mads.push(ref.image.MAD()); }
        function mtf(m,x) { if(x<=0)return 0;if(x>=1)return 1;return ((m-1)*x)/((2*m-1)*x-m); }
        function row(med,mad) {
          if(med>=0.5) throw new Error('Automatic diagnostic stretch requires a non-inverted linear image (median < 0.5)');
          if(mad<=0 && med>0) {warnings.push('zero-MAD channel: unclipped MTF fallback');return [0,mtf(target,med),1,0,1];}
          if(med<2*1.4826*mad || med<=0) {warnings.push('degenerate-median: fixed gentle MTF fallback; diagnostic stretch NOT validated');return [0,0.01,1,0,1];}
          var c0=Math.max(0,Math.min(1,med+clip*1.4826*mad));
          return [c0,Math.max(1e-12,Math.min(1-1e-12,mtf(target,(med-c0)/(1-c0)))),1,0,1];
        }
        htRows={};
        if(linked) {
          var med=0,mad=0;for(var c=0;c<nch;++c){med+=meds[c]/nch;mad+=mads[c]/nch;}htRows[3]=row(med,mad);
        } else for(var c=0;c<nch;++c) htRows[nch===1?3:c]=row(meds[c],mads[c]);
        provenance.linked=linked;provenance.shadowsClipping=clip;provenance.targetBackground=target;
        provenance.algorithm='Median / 1.4826 MAD, normalized MTF';
        provenance.boostSource=mode==='boosted-unlinked'?'DSCProcessingSuite Boost defaults (-1.8 sigma / 0.5); not native toolbar preference verification':null;
        provenance.channelMedians=meds;provenance.channelMADs=mads;
      }
      var r=${JSON.stringify(rect ?? null)}, x0=0,y0=0,x1=src.width,y1=src.height;
      if(r) {x0=Math.max(0,Math.min(src.width-1,Math.round(r[0])));y0=Math.max(0,Math.min(src.height-1,Math.round(r[1])));
        x1=Math.max(x0+1,Math.min(src.width,Math.round(r[2])));y1=Math.max(y0+1,Math.min(src.height,Math.round(r[3])));}
      src.resetSelections();src.selectedRect=new Rect(x0,y0,x1,y1);
      var managed=opts.colorMode!=='raw' && src.isColor;
      tw=new ImageWindow(x1-x0,y1-y0,src.numberOfChannels,32,true,src.isColor,${JSON.stringify(tmpId)});
      var tv=tw.mainView;tv.beginProcess();processing=true;
      try { tv.image.assign(src,new Rect(x0,y0,x1,y1),0,src.numberOfChannels-1); } finally { tv.endProcess();processing=false; }
      if(htRows) {
        var P=new HistogramTransformation;P.H=[[0,.5,1,0,1],[0,.5,1,0,1],[0,.5,1,0,1],[0,.5,1,0,1],[0,.5,1,0,1]];
        var H=P.H;for(var k in htRows) H[Number(k)]=htRows[k];P.H=H;
        if(!P.executeOn(tv,false)) throw new Error('Render stretch failed');
      }
      var ds=${Math.max(1, Math.trunc(downsample ?? 1))};
      if(ds>1) {var IR=new IntegerResample;IR.zoomFactor=-ds;if(!IR.executeOn(tv,false))throw new Error('Render resample failed');}
      var cm={status:src.isColor?'raw':'grayscale-unmanaged',outputICCEmbedded:false,outputICCVerified:false,
        note:'Spatial diagnostics only; no verified color conversion.'},iccBase64=null;
      var bitmap=tv.image.render();
      if(managed) {
        function globalSetting(key) {return Settings.readGlobal(key,Settings.globalVariableType(key));}
        if(globalSetting('ColorManagement/IsEnabled')!==true || globalSetting('ColorManagement/IsValid')!==true)
          throw new Error('PixInsight color management is disabled or invalid; enable it or request colorMode:raw');
        var monitorProfile=globalSetting('ColorManagement/MonitorProfilePath');
        if(!monitorProfile) throw new Error('PixInsight did not report its active monitor profile');
        var icc=File.readFile(monitorProfile);
        if(!icc || !icc.length) throw new Error('Cannot read the active PixInsight monitor ICC profile');
        // Use the ORIGINAL window/view: its live ICC and display transformation
        // are authoritative. New ImageWindow/PixelMath copies lose source ICC.
        v.window.applyColorTransformation(bitmap,v);
        iccBase64=icc.toBase64();
        cm={status:'awaiting-embedding',outputICCEmbedded:false,outputICCVerified:false,
          source:'Live source window/view color-management transform',
          targetProfile:monitorProfile,target:'PixInsight monitor profile',
          defaultRGBProfile:globalSetting('ColorManagement/DefaultRGBProfilePath'),
          renderingIntent:globalSetting('ColorManagement/DefaultRenderingIntent'),
          note:'Display-referred preview tagged with the actual monitor ICC. Use a color-managed viewer. Unlinked/Boost displays remain spatial diagnostics.'};
      }
      if(!bitmap.save(${JSON.stringify(outputPath)},${quality ?? 100})) throw new Error('Preview bitmap save failed');
      var width=tv.image.width,height=tv.image.height;
      return JSON.stringify({viewId:v.id,path:${JSON.stringify(outputPath)},width:width,height:height,
        stfMode:mode,stfApplied:!!htRows,stretch:htRows,display:provenance,sourceRect:[x0,y0,x1,y1],downsample:ds,
        colorManagement:cm,iccBase64:iccBase64,warnings:warnings});
    } catch(e) { return JSON.stringify({error:String(e.message || e)}); }
    finally {
      try {if(ref && refSaved) restore(ref.image,refSaved);} finally {
        try {restore(src,saved);} finally {if(tw && !tw.isNull) {if(processing)tw.mainView.endProcess();tw.forceClose();}}
      }
    }
  })()`;
}

export function dimsScript(viewId: string): string {
  return `(function(){var v=View.viewById(${JSON.stringify(viewId)});if(!v||v.isNull)return JSON.stringify({error:'Image not found'});
    return JSON.stringify({viewId:v.id,width:v.image.width,height:v.image.height,isColor:v.image.isColor,channels:v.image.numberOfChannels});})()`;
}
