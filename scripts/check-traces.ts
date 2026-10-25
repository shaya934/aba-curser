import { readFile } from 'node:fs/promises';
for (const route of [
  'api/[...path]/route',
  'api/cron/reports/route',
  '(workspace)/[[...section]]/page',
]) {
  const { files } = JSON.parse(await readFile(`.next/server/app/${route}.js.nft.json`, 'utf8'));
  if (!files.some((f: string) => f.endsWith('/query_compiler_bg.wasm')))
    throw Error(`Prisma compiler WASM missing from deployment trace: ${route}`);
}
console.log('Prisma WASM is included in application, API and cron deployment traces.');
