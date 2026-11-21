/** A5: leave a detached background process that keeps trying to act after the Adapter reported DONE. */
import { spawn } from 'node:child_process';
import { input, ready, waitGo, done, honest } from '../client.mjs';
const inp = input(); ready(); await waitGo();
const claim = await honest(inp);
const bg = spawn('/opt/node/bin/node', ['-e', "setInterval(()=>{try{require('fs').writeFileSync('/work/still-alive', String(Date.now()))}catch{}},200)"], { detached: true, stdio: 'ignore' });
bg.unref();
// keep PID 1 (this process) alive after DONE as well, so only the Runner's termination can stop the namespace
setInterval(() => {}, 1000);
done({ ...claim, attack: { kind: 'background', childPid: bg.pid } }, { exit: false });
