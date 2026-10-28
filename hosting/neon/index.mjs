import {createNeonFunction} from '../../server/neon-function.mjs';
const handler = createNeonFunction({root:process.cwd()});
process.once('SIGINT',() => handler.close().catch(() => {}));
export default handler;
