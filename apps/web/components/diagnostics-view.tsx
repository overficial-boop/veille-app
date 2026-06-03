'use client';

import * as React from 'react';
import type { FunnelEntry } from '@/lib/diagnostics';

type Run = { id: string; createdAt: string; params: { recencyDays: number; relevanceKeepFloor: number; candidateScoreFloor: number }; counts: { raw: number; kept: number; suggestion: number; rejected: number }; funnel: object[] };

function FunnelTable({ funnel }: { funnel: FunnelEntry[] }) {
  return (
    <table className="funnel">
      <thead><tr><th>verdict</th><th>requête</th><th>publication</th><th>date</th><th>score</th><th>pertinence</th><th>titre</th></tr></thead>
      <tbody>
        {funnel.map((f, i) => (
          <tr key={i} className={'fv-' + f.verdict.replace(':', '-')}>
            <td>{f.verdict}</td><td>{f.query}</td><td>{f.siteName ?? ''}</td>
            <td>{f.publishedAt?.slice(0, 10) ?? '—'}</td>
            <td>{f.providerScore != null ? f.providerScore.toFixed(2) : '—'}</td>
            <td>{f.relevance != null ? f.relevance.toFixed(2) : '—'}</td>
            <td title={f.title}>{(f.title ?? f.url).slice(0, 60)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DiagnosticsView({ slug, runs, defaults }: { slug: string; runs: Run[]; defaults: { recencyDays: number; candidateScoreFloor: number; relevanceKeepFloor: number } }) {
  const [tab, setTab] = React.useState<'hist' | 'test'>('hist');
  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div className="diag-tabs">
        <button className={tab === 'hist' ? 'on' : ''} onClick={() => setTab('hist')}>Historique</button>
        <button className={tab === 'test' ? 'on' : ''} onClick={() => setTab('test')}>Tester</button>
      </div>
      {tab === 'hist' ? (
        runs.length === 0 ? <p className="diag-empty">Aucun rafraîchissement enregistré.</p> : (
          runs.map((r) => (
            <details key={r.id} className="diag-run" open={r === runs[0]}>
              <summary>{new Date(r.createdAt).toLocaleString('fr-FR')} — {r.counts.kept} gardés · {r.counts.suggestion} suggestions · {r.counts.rejected} rejetés (fenêtre {r.params.recencyDays} j)</summary>
              <FunnelTable funnel={r.funnel as unknown as FunnelEntry[]} />
            </details>
          ))
        )
      ) : (
        <Tester slug={slug} defaults={defaults} />
      )}
    </div>
  );
}

// Tester is filled in a later task — stub for now.
function Tester(_props: { slug: string; defaults: { recencyDays: number; candidateScoreFloor: number; relevanceKeepFloor: number } }) {
  return <p className="diag-empty">Bientôt.</p>;
}
