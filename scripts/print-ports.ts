/**
 * Print the ports this checkout serves on.
 *
 * A worktree's ports are derived from its path (`scripts/lib/checkout-ports.ts`),
 * so they are stable but not guessable, and `.claude/launch.json` — tracked, with
 * a static `port` — can only name the main checkout's. This is how you find the
 * URL to open.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devPort, isWorktree, previewPort } from './lib/checkout-ports';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

console.log(`checkout: ${root}`);
console.log(`kind:     ${isWorktree(root) ? 'worktree' : 'main checkout'}`);
console.log(`dev:      http://localhost:${devPort(root)}`);
console.log(`preview:  http://localhost:${previewPort(root)}`);
