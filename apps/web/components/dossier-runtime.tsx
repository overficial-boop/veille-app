'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  ChevronRight,
  Globe,
  PenLine,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Sparkles,
  X,
  Youtube,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { Btn, StatusPill, SourceBadge } from '@/components/veille-ui';
import {
  addSourceAction,
  adHocPullAction,
  removeSourceAction,
  updateSourceAction,
} from '@/app/dossier/[slug]/actions';
import { formatDateFr } from '@/components/templates/types';
import type { AddSourceType } from '@/lib/source-input';

/** The four add-source types, with the short label, example, and placeholder shown in the dialog. */
const ADD_SOURCE_OPTIONS: {
  type: AddSourceType;
  label: string;
  example: string;
  placeholder: string;
}[] = [
  { type: 'web', label: 'Page web', example: 'Une URL à surveiller', placeholder: 'https://exemple.fr/article' },
  { type: 'search', label: 'Recherche', example: 'Une requête permanente', placeholder: 'Sujet ou requête à suivre' },
  { type: 'rss', label: 'Flux RSS', example: 'Un flux à agréger', placeholder: 'https://exemple.fr/feed' },
  { type: 'youtube', label: 'Chaîne YouTube', example: 'Une chaîne à suivre', placeholder: 'https://youtube.com/@chaine' },
];

function sourceTypeLabel(connector: string, source?: string): string {
  if (connector === 'web') return 'Page web';
  if (connector === 'tavily' || connector === 'google-news') return 'Recherche';
  if (connector === 'rss') return source === 'youtube' ? 'Chaîne YouTube' : 'Flux RSS';
  return connector;
}

/** Bare source-type icon (for the .src-ic square + the .type-opt cards) — mirrors SourceBadge's mapping. */
function sourceTypeIcon(connector: string, source?: string): ComponentType<{ className?: string }> {
  if (connector === 'rss' && source === 'youtube') return Youtube;
  switch (connector) {
    case 'web':
      return Globe;
    case 'tavily':
    case 'google-news':
      return Search;
    case 'rss':
      return Rss;
    default:
      return Globe;
  }
}

/** The add-source dialog uses AddSourceType keys; map them to the same icon set. */
function addTypeIcon(type: AddSourceType): ComponentType<{ className?: string }> {
  switch (type) {
    case 'web':
      return Globe;
    case 'search':
      return Search;
    case 'rss':
      return Rss;
    case 'youtube':
      return Youtube;
    default:
      return Globe;
  }
}

// Mirrors lib/jobs/policy.ts JobProgress — kept local so the client bundle never imports the engine.
type JobPhase = 'planning' | 'searching' | 'reading' | 'analyzing' | 'writing' | 'done';
type JobStep = { at: string; label: string };
type JobProgress = { phase: JobPhase; headline: string; current?: number; total?: number; steps: JobStep[] };
type JobView = { id: string; type: 'assemble' | 'brief' | 'refresh'; status: 'queued' | 'running' | 'done' | 'failed'; progress: JobProgress | null; error: string | null };

type SourceLite = {
  id: string;
  connector: string;
  kind: string;
  purpose?: string;
  label: string | null;
  source?: string;
  target?: string;
  lastExtractedAt?: string | null;
};

type Props = {
  slug: string;
  status: string;
  /** Whether a brief already exists — decides "Réécrire" (regenerate) vs "Générer le brief" (first). */
  hasBrief: boolean;
  sources: SourceLite[];
};


export function DossierRuntime({ slug, status, hasBrief, sources }: Props) {
  const router = useRouter();
  const [job, setJob] = React.useState<JobView | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const enqueuingRef = React.useRef(false);
  const [recencyDays, setRecencyDays] = React.useState(0);

  const active = job?.status === 'queued' || job?.status === 'running';

  const stopPolling = React.useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const poll = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/dossiers/${slug}/job`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { job: JobView | null };
      setJob(data.job);
      if (data.job && (data.job.status === 'done' || data.job.status === 'failed')) {
        stopPolling();
        if (data.job.status === 'done') router.refresh();
      }
    } catch { /* transient network blip — keep polling */ }
  }, [slug, router, stopPolling]);

  const startPolling = React.useCallback(() => {
    if (pollRef.current) return;
    void poll();
    pollRef.current = setInterval(() => void poll(), 1500);
  }, [poll]);

  // Enqueue a job (POST) then begin polling. Deduped server-side, so double-clicks are safe.
  const enqueue = React.useCallback(async (path: string) => {
    if (enqueuingRef.current || active) return;
    enqueuingRef.current = true;
    try {
      const res = await fetch(path, { method: 'POST' });
      if (res.ok) startPolling();
    } finally {
      enqueuingRef.current = false;
    }
  }, [active, startPolling]);

  // On mount: poll once to pick up any in-flight job (built in the background while away). If the
  // dossier is still 'building' with no active job (left mid-build by the old path), self-heal by
  // enqueuing assemble.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/dossiers/${slug}/job`, { cache: 'no-store' });
        const data = (await res.json()) as { job: JobView | null };
        if (cancelled) return;
        setJob(data.job);
        const isActive = data.job && (data.job.status === 'queued' || data.job.status === 'running');
        if (isActive) { startPolling(); return; }
        if (status === 'building') void enqueue(`/api/dossiers/${slug}/assemble`);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; stopPolling(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progress = job?.progress ?? null;
  const showPanel = active || (job?.status === 'failed') || (progress != null && progress.steps.length > 0);
  const pct = progress?.total ? Math.round(((progress.current ?? 0) / progress.total) * 100) : null;

  return (
    <>
      <div className="card runtime">
        <div className="runtime-top">
          <StatusPill status={status} live={active} />
        </div>

        <div className="runtime-actions">
          <Btn
            variant="soft" size="sm" icon={RefreshCw}
            onClick={() => void enqueue(`/api/dossiers/${slug}/refresh?days=${recencyDays}`)}
            disabled={active}
          >
            {active ? 'En cours…' : 'Rafraîchir'}
          </Btn>
          {hasBrief ? (
            <Btn variant="ghost" size="sm" icon={PenLine} onClick={() => void enqueue(`/api/dossiers/${slug}/brief`)} disabled={active}>
              Réécrire
            </Btn>
          ) : (
            <Btn variant="ghost" size="sm" icon={Sparkles} onClick={() => void enqueue(`/api/dossiers/${slug}/brief`)} disabled={active}>
              Générer le brief
            </Btn>
          )}
        </div>

        <label className="refresh-window" title="Fenêtre de récence pour le rafraîchissement">
          <span className="rw-label">Fenêtre</span>
          <input
            type="range" min={0} max={30} step={1} value={recencyDays}
            onChange={(e) => setRecencyDays(Number(e.target.value))} disabled={active}
          />
          <span className="rw-val">{recencyDays === 0 ? 'Nouveautés' : `${recencyDays} j`}</span>
        </label>

        {showPanel ? (
          <div className="jobfeed">
            <div className="jf-head">
              {active ? <span className="spin" /> : null}
              <span className="jf-headline">
                {job?.status === 'failed' ? (job.error ?? 'Une erreur est survenue') : (progress?.headline ?? 'Préparation…')}
              </span>
            </div>

            {active ? (
              <div className="jf-bar" data-indeterminate={pct == null ? 'true' : 'false'}>
                <i style={pct == null ? undefined : { width: `${pct}%` }} />
              </div>
            ) : null}

            {progress && progress.steps.length > 0 ? (
              <ol className="jf-steps">
                {progress.steps.map((s, i) => (
                  <li key={`${s.at}-${i}`} className="jf-step">{s.label}</li>
                ))}
              </ol>
            ) : null}

            {active ? (
              <p className="jf-reassure">Vous pouvez fermer cet onglet — la veille se construit en arrière-plan.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <ModeRecherche slug={slug} />
      <SourcesPanel slug={slug} sources={sources} />
    </>
  );
}


/** Mode recherche — a one-off ad-hoc pull. Grows the curated set from a manual query without
 *  saving a standing source; new documents appear in the feed/suggestions after the refresh. */
function ModeRecherche({ slug }: { slug: string }) {
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const [pending, startPull] = React.useTransition();
  const [note, setNote] = React.useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setNote(null);
    startPull(async () => {
      const res = await adHocPullAction(slug, q);
      if (!res.ok) {
        setNote(res.error);
        return;
      }
      setQuery('');
      setNote(res.total === 0 ? 'Aucun résultat.' : `${res.total} ${res.total === 1 ? 'document ajouté' : 'documents ajoutés'}.`);
      router.refresh();
    });
  }

  return (
    <div className="card rech" style={{ marginBottom: '1rem' }}>
      <h3 style={{ margin: '0 0 .5rem' }}>Mode recherche</h3>
      <form onSubmit={submit} style={{ display: 'flex', gap: '.4rem' }}>
        <input
          className="field"
          value={query}
          placeholder="Une recherche ponctuelle…"
          onChange={(e) => setQuery(e.target.value)}
          disabled={pending}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Btn type="submit" variant="primary" size="sm" icon={Search} disabled={!query.trim() || pending}>
          {pending ? 'Recherche…' : 'Chercher'}
        </Btn>
      </form>
      {note ? (
        <p style={{ marginTop: '.5rem', fontSize: 'var(--t-sm)', color: 'var(--ink-3)', fontStyle: 'italic' }}>{note}</p>
      ) : null}
    </div>
  );
}

function SourcesPanel({ slug, sources }: { slug: string; sources: SourceLite[] }) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [, startTransition] = React.useTransition();

  const [type, setType] = React.useState<AddSourceType>('web');
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startAddTransition] = React.useTransition();

  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editLabel, setEditLabel] = React.useState('');
  const [editTarget, setEditTarget] = React.useState('');
  const [savePending, startSaveTransition] = React.useTransition();

  function toggleExpand(id: string) {
    setExpandedId((p) => (p === id ? null : id));
    setEditingId(null);
  }

  function startEdit(s: SourceLite) {
    setEditingId(s.id);
    setEditLabel(s.label ?? '');
    setEditTarget(s.target ?? '');
  }

  function saveEdit(e: React.FormEvent, id: string) {
    e.preventDefault();
    const t = editTarget.trim();
    if (!t) return;
    startSaveTransition(async () => {
      await updateSourceAction(slug, id, { label: editLabel.trim(), target: t });
      setEditingId(null);
    });
  }

  function remove(sourceId: string) {
    startTransition(() => {
      removeSourceAction(slug, sourceId);
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    setError(null);
    startAddTransition(async () => {
      const res = await addSourceAction(slug, { type, value: v });
      if (res.ok) {
        setValue('');
        setType('web');
        setDialogOpen(false);
      } else {
        setError(res.error);
      }
    });
  }

  function closeDialog() {
    setDialogOpen(false);
    setError(null);
  }

  return (
    <>
      <details className="card rech" open>
        <summary className="foldhead">
          <ChevronRight className="chev" />
          <h3>Recherches</h3>
          <span className="num">{sources.length}</span>
        </summary>

        <div className="rech-list">
          {sources.length === 0 ? (
            <div
              style={{
                padding: '1rem .6rem',
                color: 'var(--ink-3)',
                fontStyle: 'italic',
                fontFamily: 'var(--font-serif)',
                fontSize: '.95rem',
              }}
            >
              Aucune recherche pour l&apos;instant.
            </div>
          ) : (
            sources.map((s) => {
              const Icon = sourceTypeIcon(s.connector, s.source);
              const expanded = expandedId === s.id;
              const editing = editingId === s.id;
              return (
                <details key={s.id} className="src-item" open={expanded}>
                  <summary
                    className="src-row"
                    onClick={(e) => {
                      // Controlled <details>: React state (expandedId) is the source of
                      // truth (only one open at a time + gates the edit form), so suppress
                      // the native toggle and drive it ourselves.
                      e.preventDefault();
                      toggleExpand(s.id);
                    }}
                  >
                    <span className="src-ic">
                      <Icon />
                    </span>
                    <span className="src-name">{s.label ?? s.connector}</span>
                    <ChevronRight
                      className="chev"
                      style={{ width: 14, height: 14, color: 'var(--ink-3)' }}
                    />
                  </summary>

                  {editing ? (
                    <form className="src-edit" onSubmit={(e) => saveEdit(e, s.id)}>
                      <input
                        className="field"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        placeholder="Nom de la source"
                        aria-label="Nom"
                      />
                      <input
                        className="field"
                        value={editTarget}
                        onChange={(e) => setEditTarget(e.target.value)}
                        placeholder="Cible (URL, requête ou flux)"
                        aria-label="Cible"
                      />
                      <div className="acts">
                        <Btn
                          type="submit"
                          variant="primary"
                          size="sm"
                          icon={Check}
                          disabled={!editTarget.trim() || savePending}
                        >
                          {savePending ? 'Enregistrement…' : 'Enregistrer'}
                        </Btn>
                        <Btn
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingId(null)}
                          disabled={savePending}
                        >
                          Annuler
                        </Btn>
                      </div>
                    </form>
                  ) : (
                    <div className="src-detail">
                      <div className="kv">
                        <span className="k">Type</span>
                        <span className="v">
                          <SourceBadge connector={s.connector} source={s.source} />
                        </span>
                      </div>
                      {s.kind === 'standing' && s.purpose ? (
                        <div className="kv">
                          <span className="k">Rôle</span>
                          <span className="v">{s.purpose === 'watch' ? 'Veille' : 'État'}</span>
                        </div>
                      ) : null}
                      <div className="kv">
                        <span className="k">Cible</span>
                        <span className="v">{s.target || '—'}</span>
                      </div>
                      <div className="kv">
                        <span className="k">Dernière</span>
                        <span className="v">
                          {s.lastExtractedAt
                            ? formatDateFr(new Date(s.lastExtractedAt))
                            : 'jamais'}
                        </span>
                      </div>
                      <div className="acts">
                        <Btn variant="quiet" size="sm" icon={PenLine} onClick={() => startEdit(s)}>
                          Éditer
                        </Btn>
                        <Btn
                          variant="danger"
                          size="sm"
                          icon={X}
                          onClick={() => remove(s.id)}
                          aria-label={`Retirer la source ${s.label ?? s.connector}`}
                        >
                          Retirer
                        </Btn>
                      </div>
                    </div>
                  )}
                </details>
              );
            })
          )}
        </div>

        <div className="add-src">
          <Btn
            variant="soft"
            size="sm"
            icon={Plus}
            onClick={() => setDialogOpen(true)}
            style={{ width: '100%' }}
          >
            Ajouter une source
          </Btn>
        </div>
      </details>

      {dialogOpen ? (
        <AddSourceDialog
          type={type}
          setType={(t) => {
            setType(t);
            setError(null);
          }}
          value={value}
          setValue={setValue}
          error={error}
          pending={pending}
          onSubmit={add}
          onClose={closeDialog}
        />
      ) : null}
    </>
  );
}

function AddSourceDialog({
  type,
  setType,
  value,
  setValue,
  error,
  pending,
  onSubmit,
  onClose,
}: {
  type: AddSourceType;
  setType: (t: AddSourceType) => void;
  value: string;
  setValue: (v: string) => void;
  error: string | null;
  pending: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const placeholder = ADD_SOURCE_OPTIONS.find((o) => o.type === type)?.placeholder;

  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Ajouter une source">
        <h3>Ajouter une source</h3>
        <div className="d-sub">
          Lancez un rafraîchissement pour analyser la nouvelle source.
        </div>
        <form onSubmit={onSubmit}>
          <div className="type-grid" role="group" aria-label="Type de source">
            {ADD_SOURCE_OPTIONS.map((o) => {
              const Icon = addTypeIcon(o.type);
              return (
                <button
                  key={o.type}
                  type="button"
                  className={'type-opt' + (type === o.type ? ' sel' : '')}
                  onClick={() => setType(o.type)}
                  aria-pressed={type === o.type}
                >
                  <span className="src-ic">
                    <Icon />
                  </span>
                  <span>
                    <span className="lbl">{o.label}</span>
                    <span className="ex" style={{ display: 'block' }}>
                      {o.example}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <input
            className="field"
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
          {error ? (
            <p
              style={{
                marginTop: '.6rem',
                fontSize: 'var(--t-sm)',
                fontStyle: 'italic',
                color: 'var(--danger)',
              }}
            >
              {error}
            </p>
          ) : null}
          <div className="dialog-foot">
            <Btn type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Annuler
            </Btn>
            <Btn type="submit" variant="primary" icon={Plus} disabled={!value.trim() || pending}>
              {pending ? 'Ajout…' : 'Ajouter'}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  );
}
