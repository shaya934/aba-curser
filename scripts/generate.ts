// Prisma's JS driver engine needs no native query/schema binary.
// Pin internals to the client version; invoking the generator directly avoids
// the CLI's unused native-engine prefetch on restricted cloud machines.
import { createRequire } from 'node:module';
import internals from '@prisma/internals';
const { getGenerators } = internals;
const generators = await getGenerators({
  schemaPath: 'prisma/schema.prisma',
  skipDownload: true,
  registry: {
    'prisma-client-js': {
      type: 'rpc',
      isNode: true,
      generatorPath: createRequire(import.meta.url).resolve(
        '@prisma/client/generator-build/index.js',
      ),
    },
  },
});
try {
  for (const generator of generators) await generator.generate();
  console.log('Generated Prisma client for the PostgreSQL JS driver.');
} finally {
  for (const generator of generators) generator.stop();
}
