'use client';

import * as React from 'react';
import { bucket, type FunnelVerdict } from '@/lib/diagnostics';
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

type ProbeCandidate = { query: string; url: string; title?: string; publishedAt?: string; siteName?: string; providerScore?: number; relevance: number | null; relevanceReason?: string };

function Tester({ slug, defaults }: { slug: string; defaults: { recencyDays: number; candidateScoreFloor: number; relevanceKeepFloor: number } }) {
  const [running, setRunning] = React.useState(false);
  const [cands, setCands] = React.useState<ProbeCandidate[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [recencyDays, setRecencyDays] = React.useState(defaults.recencyDays);
  const [scoreFloor, setScoreFloor] = React.useState(defaults.candidateScoreFloor);
  const [keepFloor, setKeepFloor] = React.useState(defaults.relevanceKeepFloor);

  async function run() {
    setRunning(true); setError(null);
    try {
      const res = await fetch('/api/admin/discovery', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug }) });
      if (!res.ok) { setError('Échec de la sonde.'); return; }
      const json = (await res.json()) as { candidates: ProbeCandidate[] };
      setCands(json.candidates);
    } catch { setError('Erreur réseau.'); } finally { setRunning(false); }
  }

  const knobs = { recencyDays, candidateScoreFloor: scoreFloor, relevanceKeepFloor: keepFloor };
  const now = new Date();
  const verdicts = (cands ?? []).map((c) => bucket(c, knobs, now));
  const count = (v: FunnelVerdict | 'rejected') => verdicts.filter((x) => (v === 'rejected' ? x.startsWith('rejected') : x === v)).length;

  return (
    <div>
      <button className="diag-run-btn" onClick={run} disabled={running}>{running ? 'Sonde en cours… (~60 s)' : 'Lancer la sonde'}</button>
      {error ? <p className="diag-empty">{error}</p> : null}
      {cands ? (
        <>
          <div className="diag-knobs">
            <label>Fenêtre (j): <input type="range" min={0} max={30} value={recencyDays} onChange={(e) => setRecencyDays(+e.target.value)} /> {recencyDays}</label>
            <label>Score min: <input type="range" min={0} max={1} step={0.05} value={scoreFloor} onChange={(e) => setScoreFloor(+e.target.value)} /> {scoreFloor.toFixed(2)}</label>
            <label>Pertinence min: <input type="range" min={0} max={1} step={0.05} value={keepFloor} onChange={(e) => setKeepFloor(+e.target.value)} /> {keepFloor.toFixed(2)}</label>
          </div>
          <p className="diag-counts">{count('kept')} gardés · {count('suggestion')} suggestions · {count('rejected')} rejetés (sur {cands.length})</p>
          <pre className="diag-env">VEILLE_REFRESH_RECENCY_DAYS={recencyDays}{'\n'}VEILLE_CANDIDATE_SCORE_FLOOR={scoreFloor}{'\n'}VEILLE_RELEVANCE_KEEP_FLOOR={keepFloor}</pre>
          <table className="funnel">
            <thead><tr><th>verdict</th><th>requête</th><th>publication</th><th>date</th><th>score</th><th>pertinence</th><th>titre</th></tr></thead>
            <tbody>
              {cands.map((c, i) => (
                <tr key={i} className={'fv-' + verdicts[i].replace(':', '-')}>
                  <td>{verdicts[i]}</td><td>{c.query}</td><td>{c.siteName ?? ''}</td>
                  <td>{c.publishedAt?.slice(0, 10) ?? '—'}</td>
                  <td>{c.providerScore != null ? c.providerScore.toFixed(2) : '—'}</td>
                  <td>{c.relevance != null ? c.relevance.toFixed(2) : '—'}</td>
                  <td title={c.title}>{(c.title ?? c.url).slice(0, 60)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}
