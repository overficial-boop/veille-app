import { type NextRequest, NextResponse } from 'next/server';
import { extract } from '@veille/core';
import { registerAllAdapters } from '@/lib/adapters';

// TEMPORARY smoke route (removed in M1). Proves the ported extract pipeline
// runs in the new Next runtime with serverExternalPackages + the real keys.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'url query param required' }, { status: 400 });
  }
  try {
    registerAllAdapters();
    const facts = await extract(url, { language: 'fr', withSummary: false });
    return NextResponse.json({
      count: facts.length,
      adapter: facts[0]?.extractedBy.adapter ?? null,
      model: facts[0]?.extractedBy.model ?? null,
      first: facts[0] ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
