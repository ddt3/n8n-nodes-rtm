#!/usr/bin/env node
// Thin wrapper: runs the one-time RTM authorisation from the compiled package (run `npm run build` first).
import { runAuthorizeCli } from '../dist/nodes/RememberTheMilk/auth.js';

const code = await runAuthorizeCli(process.argv.slice(2), {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  env: process.env,
});
process.exit(code);
