/** Explicit one-off operator command, never invoked by normal application builds. */
import { mkdir, writeFile } from 'node:fs/promises';
await import('./hosted-initialize');
await import('./hosted-smoke');
await mkdir('.deployment-preflight', { recursive: true });
await writeFile(
  '.deployment-preflight/index.html',
  'Hosted initialization and verification passed.',
);
