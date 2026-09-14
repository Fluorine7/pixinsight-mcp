import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BridgeClient } from '../bridge/client.js';
import { resolveScript, startScript, getScriptJob } from '../scripts/launcher.js';
import { jsonContent, jsonErrorContent } from '../pjsr/exec.js';
const selector = {
  scriptId: z.enum(['ImageSolver']).optional().describe('Installed script alias; resolves from CoreApplication.srcDirPath, preferring the 1.9.4 layout'),
  scriptPath: z.string().min(1).optional().describe('Absolute custom script path on the PixInsight host; mutually exclusive with scriptId'),
};
export function registerScriptFileTools(server: McpServer, bridge: BridgeClient) {
  server.tool('resolve_script', 'Resolve an installed script and report the active PixInsight installation/instance without running it. Requires the watcher.', selector, async input => {
    try { return jsonContent(await resolveScript(bridge, input)); } catch(e) { return jsonErrorContent(e); }
  });
  server.tool('run_script_file', 'Run a complete PJSR file using the official PixInsight IPC/preprocessor, including #include/#engine support. Returns a job ID, not execution success. Poll get_script_job. Script parameters are set with Parameters.set; viewId activates a main view but does not set Parameters.isViewTarget. Scripts may open dialogs unless their own noninteractive parameter is supplied. ImageSolver 1.9.4 supports non_interactive=true and useActive=true. Verify the resulting astrometric solution after solving. Uses existing local watcher, no GUI automation.', {
    ...selector,
    parameters: z.record(z.union([z.string(),z.number().finite(),z.boolean()])).optional(),
    viewId: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional().describe('Activate this main view before running'),
  }, async input => { try { return jsonContent(await startScript(bridge, input)); } catch(e) { return jsonErrorContent(e); } });
  server.tool('get_script_job', 'Read completion, runtime result, error and a bounded console-log tail for a run_script_file job. Pending/running is never success. A script can catch its own failures; inspect the log and verify postconditions. Does not rerun or cancel scripts.', {
    jobId: z.string(), waitMs: z.number().int().min(0).max(10000).default(0),
  }, async ({jobId,waitMs}) => { try { return jsonContent(await getScriptJob(bridge,jobId,waitMs)); } catch(e) { return jsonErrorContent(e); } });
}
