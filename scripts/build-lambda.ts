/**
 * Lambda関数をバンドルするスクリプト
 *
 * 使用方法: npx tsx scripts/build-lambda.ts
 */
import { build } from 'esbuild';
import { join } from 'path';

const ROOT = process.cwd();

async function buildLambda() {
  console.log('Building Lambda function...');

  await build({
    entryPoints: [join(ROOT, 'src/lambda/ingest-handler.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: join(ROOT, 'lambda-dist/index.js'),
    format: 'esm',
    banner: {
      js: `
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
`.trim(),
    },
    external: [
      '@aws-sdk/*', // Lambda runtime provides AWS SDK v3
    ],
    minify: true,
    sourcemap: true,
  });

  console.log('Lambda function built successfully!');
  console.log('Output: lambda-dist/index.js');
}

buildLambda().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
