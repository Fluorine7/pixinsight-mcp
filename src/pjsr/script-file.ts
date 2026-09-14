/** Whole-file execution uses PI's preprocessor, never eval(fileContents). */
export function discoveryCode(): string {
  return `(function(){return JSON.stringify({
    baseDirectory:CoreApplication.baseDirPath,sourceDirectory:CoreApplication.srcDirPath,
    executable:CoreApplication.filePath,platform:CoreApplication.platform,
    instance:CoreApplication.instance,version:[CoreApplication.versionMajor,
    CoreApplication.versionMinor,CoreApplication.versionRelease].join('.')
  });})()`;
}

export function buildWrapper(input: {
  scriptPath: string; resultPath: string; startedPath: string;
  parameters: Record<string, string | number | boolean>; viewId?: string;
}): string {
  const include = input.scriptPath.replace(/\\/g, '/');
  if (/["\r\n\0]/.test(include)) throw new Error('Script path contains unsupported include characters');
  // Unique names keep included scripts from shadowing launcher bookkeeping.
  return `#engine v8
var __mcpFileOutcome = {status:'completed'};
var __mcpFileOwnLog = console.logText().length === 0;
if (__mcpFileOwnLog) console.beginLog();
var __mcpFileLogStart = console.logText().utf8ToString().length;
File.writeTextFile(${JSON.stringify(input.startedPath)}, 'started');
try {
  Parameters.clear();
  var __mcpFileParameters = ${JSON.stringify(input.parameters)};
  Object.keys(__mcpFileParameters).forEach(function(k){Parameters.set(k,__mcpFileParameters[k]);});
  ${input.viewId ? `var __mcpFileView=View.viewById(${JSON.stringify(input.viewId)});
  if (__mcpFileView.isNull) throw new Error('Target view no longer exists');
  __mcpFileView.window.bringToFront();` : ''}
#include "${include}"
  __mcpFileOutcome.scriptResult = Runtime.jsScriptResult;
} catch (__mcpFileError) {
  __mcpFileOutcome.status = 'error';
  __mcpFileOutcome.error = String(__mcpFileError.message || __mcpFileError);
} finally {
  __mcpFileOutcome.log = console.logText().utf8ToString().slice(__mcpFileLogStart).slice(-20000);
  if (__mcpFileOwnLog) console.endLog();
  File.writeTextFile(${JSON.stringify(input.resultPath)}, JSON.stringify(__mcpFileOutcome));
}
`;
}
