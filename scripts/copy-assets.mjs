// Copies non-TypeScript assets (node icons) next to the compiled JavaScript in dist/.
// Why: tsc only emits .js/.d.ts files, but n8n loads each node's icon from the same folder.
import { cpSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const sourceRoot = 'nodes';
const targetRoot = join('dist', 'nodes');

// Walk every node folder and copy its svg/png icons.
for (const dir of readdirSync(sourceRoot, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const from = join(sourceRoot, dir.name);
  const to = join(targetRoot, dir.name);
  if (!existsSync(to)) mkdirSync(to, { recursive: true });
  for (const file of readdirSync(from)) {
    if (/\.(svg|png)$/i.test(file)) cpSync(join(from, file), join(to, file));
  }
}
