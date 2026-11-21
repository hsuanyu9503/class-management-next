/** Honest sandboxed Adapter entry. */
import { input, ready, waitGo, done, honest } from './client.mjs';
const inp = input();
ready(); await waitGo();
done(await honest(inp));
