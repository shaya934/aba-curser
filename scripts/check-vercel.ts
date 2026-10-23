import { validateVercelConfiguration } from '../src/lib/deployment';
try {
  validateVercelConfiguration();
  console.log('Vercel configuration names and formats are valid. No credentials printed.');
} catch (e) {
  console.error('Vercel configuration:', e instanceof Error ? e.message : 'invalid');
  process.exitCode = 1;
}
