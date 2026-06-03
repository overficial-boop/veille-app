// apps/web/app/api/dossiers/[slug]/refresh/route.ts
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { refreshDossier, type StreamProgress } from '@/lib/refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return new Response('not found', { status: 404 });

  // Recency window from the slider: 0 = since-last-refresh, N = a rolling N-day catch-up window.
  const daysParam = Number(req.nextUrl.searchParams.get('days'));
  const recencyDays = Number.isFinite(daysParam) ? Math.min(60, Math.max(0, Math.floor(daysParam))) : 0;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (p: StreamProgress) => controller.enqueue(enc.encode(`data: ${JSON.stringify(p)}\n\n`));
      try {
        await refreshDossier(dossier.id, { phase: 'refresh', language: dossier.language ?? 'fr', recencyDays, onProgress: send });
        // brief is on-demand now (autoBrief hook added in a later task)
      } catch (e) {
        send({ type: 'source-error', label: 'refresh', message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
