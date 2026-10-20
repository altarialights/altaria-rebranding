import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// Sequential: the suites use rollback transactions against the same TEST database.
// Fresh process for each guard: never reuse a database connection left idle while
// spawnSync blocks the parent's event loop for the whole regression run.
function verifyIsolation(){
  const result=spawnSync(process.execPath,['--input-type=module','-e',
    "import {mcpTestPreflight} from './scripts/lib/mcp-test-preflight.mjs'; console.log(JSON.stringify((await mcpTestPreflight()).report));"],
  {encoding:'utf8',windowsHide:true});
  if(result.error||result.status!==0)throw new Error('TEST preflight failed; stop before further work');
  return JSON.parse(result.stdout.trim());
}
const initial=verifyIsolation();
mkdirSync('review/altaria-os',{recursive:true});
const suites=[
  ['mcp-local','ALTARIA_MCP_LOCAL_TEST'],
  ['crm','ALTARIA_CRM_INTEGRATION_TEST'],
  ['phase3','ALTARIA_PHASE3_INTEGRATION_TEST'],
  ['phase4','ALTARIA_PHASE4_INTEGRATION_TEST'],
  ['phase5','ALTARIA_PHASE5_INTEGRATION_TEST'],
  ['phase6','ALTARIA_PHASE6_INTEGRATION_TEST'],
  ['phase65b','ALTARIA_PHASE65B_INTEGRATION_TEST'],
  ['phase65c','ALTARIA_PHASE65C_INTEGRATION_TEST'],
  ['mcp-query','ALTARIA_MCP_QUERY_TEST'],
];
const results=[];
for(const [name,flag] of suites){
  const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',
    '--config',`vitest.${name}-test.config.mjs`],{
    env:{...process.env,[flag]:'1'},encoding:'utf8',windowsHide:true,
    maxBuffer:8*1024*1024,
  });
  const log=`${result.stdout??''}${result.stderr??''}`;
  writeFileSync(`review/altaria-os/phase73a-${name}.log`,log);
  results.push({suite:name,exitCode:result.status,error:result.error?.message});
  console.log(log.slice(-3000));
  writeFileSync('review/altaria-os/phase73a-regressions.json',JSON.stringify({
    at:new Date().toISOString(),initial,results,complete:false,
  },null,2)+'\n');
  if(result.error||result.status!==0){process.exitCode=1;break;}
}
if(!process.exitCode){
  const final=verifyIsolation();
  writeFileSync('review/altaria-os/phase73a-regressions.json',JSON.stringify({
    at:new Date().toISOString(),initial,results,final,complete:true,
  },null,2)+'\n');
}
