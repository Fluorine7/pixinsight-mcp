/** Runtime values are authoritative; toSource() can round plugin parameters. */
export const stateHelpers = String.raw`
  function captureParameters(p) {
    var values = {}, unreadable = {};
    for (var k in p) {
      try {
        var value = p[k];
        if (typeof value === 'function') continue;
        var encoded = JSON.stringify(value, function(key, v) {
          if (typeof v === 'number' && !isFinite(v)) throw new Error('Non-finite parameter');
          if (typeof v === 'undefined') throw new Error('Undefined parameter');
          return v;
        });
        if (encoded === undefined) throw new Error('Not JSON serializable');
        values[k] = JSON.parse(encoded);
      } catch(e) { unreadable[k] = String(e.message || e); }
    }
    return {values:values, unreadable:unreadable};
  }
  function imageState(v) {
    if (!v || v.isNull) return null;
    var w=v.window, im=v.image;
    var mask=null;
    try { if (!w.mask.isNull) mask={viewId:w.mask.mainView.id,filePath:w.mask.filePath}; } catch(e) {}
    return {viewId:v.id, filePath:w.filePath, historyIndex:v.historyIndex,
      width:im.width,height:im.height,channels:im.numberOfChannels,
      bitsPerSample:im.bitsPerSample,isReal:im.isReal,
      mask:mask,maskEnabled:w.maskEnabled,maskInverted:w.maskInverted};
  }
  function openStates() {
    return ImageWindow.windows.map(function(w){return imageState(w.mainView);});
  }
`;

export function verifiedProcessScript(processId: string, viewId: string | undefined, settings: Record<string, unknown>, verifyPixels = false): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(processId)) throw new Error('Invalid process class name');
  return `(function(){
    ${stateHelpers}
    var outcome={processId:${JSON.stringify(processId)},targetView:${JSON.stringify(viewId ?? null)},status:'error'};
    var beforePixels=null;
    try {
      var P=new ${processId};
      var settings=${JSON.stringify(settings)}, known=captureParameters(P).values;
      for(var k in settings) {
        if(!Object.prototype.hasOwnProperty.call(known,k)) throw new Error('Unknown parameter: '+k);
        P[k]=settings[k];
      }
      outcome.requestedParameters=settings;
      outcome.actualParameters=captureParameters(P);
      outcome.parameterDifferences=[];
      for(var k in settings) if(JSON.stringify(settings[k])!==JSON.stringify(outcome.actualParameters.values[k]))
        outcome.parameterDifferences.push(k);
      var v=${viewId ? `View.viewById(${JSON.stringify(viewId)})` : 'null'};
      if(v && v.isNull) throw new Error('Target view not found');
      outcome.before=imageState(v); var windowsBefore=openStates();
      if (${verifyPixels}) {
        if(!v) throw new Error('verifyPixels requires a target view');
        v.image.pushSelections();
        try {v.image.resetSelections();beforePixels=new Image(v.image);} finally {v.image.popSelections();}
      }
      var ok=v?P.executeOn(v):P.executeGlobal();
      outcome.executeReturned=ok;
      outcome.after=imageState(v);
      outcome.newImages=openStates().filter(function(w){return !windowsBefore.some(function(b){return b.viewId===w.viewId;});});
      outcome.historyChanged=!!(outcome.before && outcome.after && outcome.before.historyIndex!==outcome.after.historyIndex);
      outcome.actualParametersAfter=captureParameters(P);
      outcome.status=ok===true?'success':'error';
      if(ok!==true) outcome.error='Process did not return true; it may have failed or been aborted. Inspect evidence before retrying.';
      outcome.pixelChangeVerified=false;
      if(beforePixels && v && !v.isNull) {
        var afterPixels=v.image;
        var geometryChanged=beforePixels.width!==afterPixels.width || beforePixels.height!==afterPixels.height || beforePixels.numberOfChannels!==afterPixels.numberOfChannels;
        var changed=0,total=0,maxAbs=0;
        if(!geometryChanged) {
          var a=new Float64Array(beforePixels.width),b=new Float64Array(beforePixels.width);
          for(var c=0;c<beforePixels.numberOfChannels;++c) for(var y=0;y<beforePixels.height;++y) {
            var r=new Rect(0,y,beforePixels.width,y+1);beforePixels.getSamples(a,r,c);afterPixels.getSamples(b,r,c);
            for(var x=0;x<a.length;++x) {total++;if(a[x]!==b[x]){changed++;maxAbs=Math.max(maxAbs,Math.abs(a[x]-b[x]));}}
          }
        }
        outcome.pixelChangeVerified=true;
        outcome.pixelComparison={geometryChanged:geometryChanged,changedSamples:geometryChanged?null:changed,
          totalSamples:geometryChanged?null:total,maxAbsoluteDifference:geometryChanged?null:maxAbs,
          changed:geometryChanged || changed>0};
      }
      if(outcome.pixelComparison && !outcome.pixelComparison.changed && !outcome.newImages.length)
        outcome.warning='All target samples are unchanged. Verify the intended output before continuing.';
      if(ok===true && !outcome.historyChanged && !outcome.newImages.length)
        outcome.warning='No target history change or new image observed. A global/output-only process may be valid; verify its intended output.';
    } catch(e) {
      outcome.status='error';outcome.error=String(e.message || e);
      try {outcome.after=imageState(v);} catch(ignored) {}
    } finally {if(beforePixels) beforePixels.free();}
    return JSON.stringify(outcome);
  })()`;
}

export function historyStateScript(viewId: string, includeNativeXml = false): string {
  return `(function(){
    ${stateHelpers}
    var v=View.viewById(${JSON.stringify(viewId)});
    if(!v || v.isNull) return JSON.stringify({error:'View not found'});
    function captureProcess(p) {
      var result={processId:p.processId(),parameters:captureParameters(p)};
      if(result.processId==='ProcessContainer') {
        result.children=[];
        for(var j=0;j<p.length;++j) {
          var child=captureProcess(p.at(j));child.enabled=p.enabled(j);child.maskId=p.maskId(j);child.maskInverted=p.maskInverted(j);
          result.children.push(child);
        }
      }
      return result;
    }
    var pc=v.processing, steps=[];
    for(var i=0;i<pc.length;++i) {
      var p=pc.at(i);
      steps.push({containerIndex:i,historyIndex:i+1,applied:i<v.historyIndex,
        processId:p.processId(),parameters:captureParameters(p),children:captureProcess(p).children,
        enabled:pc.enabled(i),maskId:pc.maskId(i),maskInverted:pc.maskInverted(i),
        ${includeNativeXml ? "nativeXml:p.toSource('XPSM 1.0')," : ""}
        });
    }
    return JSON.stringify({schemaVersion:1,parameterSource:'live processing.at()',
      capturedAt:new Date().toISOString(),source:imageState(v),
      initialProcessing:captureProcess(v.initialProcessing),
      steps:steps,warnings:['Historical mask IDs and inversion are captured; mask images and external files must be supplied as dependencies.',
        'History indices describe the live view, not a saved/reopened image.']});
  })()`;
}
