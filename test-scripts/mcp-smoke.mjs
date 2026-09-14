import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
const c=new Client({name:'local-smoke',version:'1.0'});
const t=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../build/index.js',import.meta.url))]});
try {
 await c.connect(t);
 const {tools}=await c.listTools();
 console.log('NEW_TOOLS',tools.map(t=>t.name).filter(n=>['resolve_script','run_script_file','get_script_job'].includes(n)));
 const r=await c.callTool({name:'resolve_script',arguments:{scriptId:'ImageSolver'}});
 if(r.isError) throw new Error(JSON.stringify(r));
 console.log('RESOLVE',r);
}finally{await c.close();}
