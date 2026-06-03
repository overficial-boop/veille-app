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
import type { SynthesisProgress } from '@/lib/synthesis';
import {
  addSourceAction,
  adHocPullAction,
  removeSourceAction,
  regenerateBriefAction,
  generateBriefAction,
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

/**
 * Mirrors the server-side StreamProgress union (lib/refresh.ts): refresh frames
 * plus the synthesis frames the SSE routes append AFTER refresh completes, over
 * the same channel. The refresh half is duplicated locally so the client bundle
 * never imports the engine; the synthesis half is a pure type, safe to import.
 */
type Progress =
  | { type: 'source-start'; label: string }
  | { type: 'document'; sourceLabel: string; title: string; status: 'kept' | 'suggestion'; kept: number; total: number }
  | { type: 'source-error'; label: string; message: string }
  | { type: 'journal'; state: 'start' | 'done'; promoted: number }
  | { type: 'done'; total: number }
  | SynthesisProgress;

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

type Phase = 'idle' | 'running' | 'done' | 'error';

/** A row in the live progress panel, keyed by source label as it resolves. Tracks how many
 *  documents that source has yielded so far and how many were kept (vs parked as suggestions). */
type ProgressLine = {
  label: string;
  state: 'pending' | 'scanned' | 'error';
  docs?: number;
  kept?: number;
};

/** The synthesis (brief/update) step — a single live line, distinct from the source rows. */
type SynthLine =
  | { state: 'running'; phase: 'brief' | 'update' | 'journal' }
  | { state: 'error'; message: string };

export function DossierRuntime({ slug, status, hasBrief, sources }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const [phase, setPhase] = React.useState<Phase>('idle');
  const [lines, setLines] = React.useState<ProgressLine[]>([]);
  const [synth, setSynth] = React.useState<SynthLine | null>(null);
  // The running tally across the whole run: total documents seen and how many were kept.
  const [docTotal, setDocTotal] = React.useState(0);
  const [keptTotal, setKeptTotal] = React.useState(0);

  const esRef = React.useRef<EventSource | null>(null);
  const doneRef = React.useRef(false);
  const runningRef = React.useRef(false);
  const startedRef = React.useRef(false);

  const closeStream = React.useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    runningRef.current = false;
  }, []);

  const run = React.useCallback(
    (path: string) => {
      if (runningRef.current) return;
      runningRef.current = true;
      doneRef.current = false;
      setPhase('running');
      setLines([]);
      setSynth(null);
      setDocTotal(0);
      setKeptTotal(0);

      const es = new EventSource(path);
      esRef.current = es;

      es.onmessage = (e) => {
        let p: Progress;
        try {
          p = JSON.parse(e.data) as Progress;
        } catch {
          return;
        }
        if (p.type === 'source-start') {
          const label = p.label;
          setLines((prev) =>
            prev.some((l) => l.label === label && l.state === 'pending')
              ? prev
              : [...prev, { label, state: 'pending' }],
          );
        } else if (p.type === 'document') {
          // The engine emits one `document` frame per analysed candidate, carrying a running
          // global tally (kept / total) for the whole run. Drive the global counters from those,
          // and bump the originating source's row in place (one row per source, climbing counts)
          // rather than appending — otherwise each document would spawn a duplicate line.
          setDocTotal(p.total);
          setKeptTotal(p.kept);
          const sourceLabel = p.sourceLabel;
          const wasKept = p.status === 'kept';
          setLines((prev) => {
            const idx = prev.findIndex((l) => l.label === sourceLabel);
            if (idx === -1) {
              return [
                ...prev,
                { label: sourceLabel, state: 'scanned', docs: 1, kept: wasKept ? 1 : 0 },
              ];
            }
            const next = [...prev];
            const cur = next[idx];
            next[idx] = {
              label: sourceLabel,
              state: 'scanned',
              docs: (cur.docs ?? 0) + 1,
              kept: (cur.kept ?? 0) + (wasKept ? 1 : 0),
            };
            return next;
          });
        } else if (p.type === 'source-error') {
          setLines((prev) => {
            const idx = prev.findIndex((l) => l.label === p.label && l.state === 'pending');
            if (idx === -1) {
              return [...prev, { label: p.label, state: 'error' }];
            }
            const next = [...prev];
            next[idx] = { label: p.label, state: 'error' };
            return next;
          });
        } else if (p.type === 'done') {
          // Refresh finished — but the SSE routes keep the stream open to append
          // synthesis frames next. Record the tally and mark done for the close
          // handler; do NOT tear down here, or those frames would be lost. The
          // terminal transition (and router.refresh) happens when the server
          // closes the stream (onerror, below).
          doneRef.current = true;
          setDocTotal(p.total);
        } else if (p.type === 'journal') {
          // The novelty gate runs after the pull, before the stream closes.
          setSynth(p.state === 'start' ? { state: 'running', phase: 'journal' } : null);
        } else if (p.type === 'synthesis') {
          if (p.state === 'start') {
            setSynth({ state: 'running', phase: p.phase });
          } else {
            // done | skip — the brief/update is written (or nothing was needed)
            setSynth(null);
          }
        } else if (p.type === 'synthesis-error') {
          // Facts are already saved; a failed synthesis is a soft notice, not a crash.
          setSynth({ state: 'error', message: p.message });
        }
      };

      es.onerror = () => {
        // The server closes the connection after the final frame (the `done`
        // frame, then any synthesis frames), which surfaces here as onerror.
        // Always close to prevent EventSource auto-reconnect loops; the doneRef
        // guard tells a normal completion from a real failure. On normal close
        // we refresh server data so the new brief / update / facts render.
        closeStream();
        // Settle any source row still "pending": a source that yielded no document
        // emits a `source-start` but never a `document` frame, so it would otherwise
        // spin "lecture…" forever — making a finished run look hung when nothing is new.
        setLines((prev) =>
          prev.map((l) => (l.state === 'pending' ? { ...l, state: 'scanned', docs: l.docs ?? 0, kept: l.kept ?? 0 } : l)),
        );
        if (doneRef.current) {
          setPhase('done');
          router.refresh();
        } else {
          setPhase('error');
        }
      };
    },
    [closeStream, router],
  );

  // Auto-start assembly exactly once when the dossier is still building.
  // The start is DEFERRED to a macrotask: under React strict-mode (dev), the effect
  // runs mount→cleanup→mount synchronously. Opening the EventSource in the mount body
  // would have the cleanup close it before its request is even dispatched, and the
  // started-ref would then block the surviving mount from reopening — leaving the
  // dossier stuck "building" (the assemble request never reaches the server). Scheduling
  // via setTimeout lets the throwaway first mount's cleanup cancel the timer; only the
  // surviving mount actually opens the stream, and startedRef is set when it fires (not
  // before) so the guard still prevents a double-open. After `done`, router.refresh()
  // reconciles this island IN PLACE (no remount), so the effect never re-fires.
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (status === 'building' && !startedRef.current) {
      timer = setTimeout(() => {
        startedRef.current = true;
        run(`/api/dossiers/${slug}/assemble`);
      }, 0);
    }
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      closeStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = phase === 'running';
  const showPanel =
    phase === 'running' ||
    (phase === 'done' && (lines.length > 0 || synth !== null)) ||
    phase === 'error';

  // Owner-scoped brief regeneration. The action revalidates the dossier path, so
  // the page re-renders with the new brief once the transition resolves; the
  // action returns void, so a failure simply leaves the brief unchanged (no toast).
  function rewriteBrief() {
    if (isPending || running) return;
    setSynth(null);
    startTransition(() => {
      regenerateBriefAction(slug);
    });
  }

  // First-time brief: shown only when none exists yet. Same action the inline CTA uses;
  // revalidates the dossier path so the brief renders when the transition resolves.
  function makeBrief() {
    if (isPending || running) return;
    setSynth(null);
    startTransition(() => {
      generateBriefAction(slug);
    });
  }

  return (
    <>
      <div className="card runtime">
        <div className="runtime-top">
          <StatusPill status={status} live={running} />
        </div>

        <div className="runtime-actions">
          <Btn
            variant="soft"
            size="sm"
            icon={RefreshCw}
            onClick={() => run(`/api/dossiers/${slug}/refresh`)}
            disabled={running || isPending}
          >
            {running ? 'Rafraîchissement…' : 'Rafraîchir'}
          </Btn>
          {hasBrief ? (
            <Btn
              variant="ghost"
              size="sm"
              icon={PenLine}
              onClick={rewriteBrief}
              disabled={isPending || running}
            >
              {isPending ? 'Réécriture…' : 'Réécrire'}
            </Btn>
          ) : (
            <Btn
              variant="ghost"
              size="sm"
              icon={Sparkles}
              onClick={makeBrief}
              disabled={isPending || running}
            >
              {isPending ? 'Rédaction…' : 'Générer le brief'}
            </Btn>
          )}
        </div>

        {showPanel ? (
          <div className="progress">
            <div className="progress-global">
              {running ? <span className="spin" /> : null}{' '}
              {phase === 'error' ? (
                'Une erreur est survenue'
              ) : (
                <>
                  {phase === 'done' ? 'À jour — ' : 'Assemblage en cours — '}
                  <span className="count">{docTotal}</span>{' '}
                  {docTotal === 1 ? 'document' : 'documents'}
                  {docTotal > 0 ? <> ({keptTotal} {keptTotal === 1 ? 'gardé' : 'gardés'})</> : null}
                </>
              )}
            </div>

            {running ? (
              <div className="scanbar">
                <i />
              </div>
            ) : null}

            {lines.map((line, i) => (
              <ProgressRow key={`${line.label}-${i}`} line={line} />
            ))}

            {synth ? (
              <div className={'psource ' + (synth.state === 'running' ? 'run' : 'fail')}>
                {synth.state === 'running' ? (
                  <span className="spin" />
                ) : (
                  <PenLine className="ic" />
                )}
                <span className="pname">
                  {synth.state === 'running'
                    ? synth.phase === 'brief'
                      ? 'Rédaction de la synthèse…'
                      : synth.phase === 'journal'
                        ? 'Analyse des nouveautés…'
                        : 'Rédaction de la mise à jour…'
                    : 'Synthèse indisponible — les faits sont enregistrés.'}
                </span>
                <span className="pstate">{synth.state === 'running' ? 'en cours' : 'indisponible'}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Mode recherche — ad-hoc pull, then Sources */}
      <ModeRecherche slug={slug} />
      <SourcesPanel slug={slug} sources={sources} />
    </>
  );
}

/** One source row in the live progress panel. Maps the line state to the design's .psource classes. */
function ProgressRow({ line }: { line: ProgressLine }) {
  // pending → run; scanned with ≥1 kept → done; scanned with none kept → empty-r; error → fail.
  const docs = line.docs ?? 0;
  const kept = line.kept ?? 0;
  const cls =
    line.state === 'pending'
      ? 'run'
      : line.state === 'error'
        ? 'fail'
        : kept > 0
          ? 'done'
          : 'empty-r';

  const stateText =
    line.state === 'pending'
      ? 'lecture…'
      : line.state === 'error'
        ? 'indisponible'
        : docs === 0
          ? 'rien'
          : kept > 0
            ? `${kept} ${kept === 1 ? 'gardé' : 'gardés'}`
            : `${docs} à trier`;

  return (
    <div className={'psource ' + cls}>
      {line.state === 'pending' ? (
        <span className="spin" />
      ) : cls === 'done' ? (
        <Check className="tick" />
      ) : (
        <span className="ic" aria-hidden />
      )}
      <span className="pname">{line.label}</span>
      <span className="pstate">{stateText}</span>
    </div>
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
