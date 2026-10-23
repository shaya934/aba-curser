import { NextRequest } from 'next/server';
import { handle } from '@/lib/api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function route(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const response = await handle(req, (await context.params).path);
  response.headers.set('Cache-Control', 'no-store, private');
  return response;
}
export { route as GET, route as POST, route as PATCH, route as DELETE };
