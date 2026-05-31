'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, PenLine, Plus, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { SynthesisProgress } from '@/lib/synthesis';
import {
  addSourceAction,
  removeSourceAction,
  regenerateBriefAction,
  updateSourceAction,
} from '@/app/dossier/[slug]/actions';
import { formatDateFr } from '@/components/templates/types';
import type { AddSourceType } from '@/lib/source-input';

const ADD_SOURCE_OPTIONS: { type: AddSourceType; label: string; placeholder: string }[] = [
  { type: 'web', label: 'Une page web (URL)', placeholder: 'https://exemple.fr/article' },
  { type: 'search', label: 'Une recherche permanente', placeholder: 'Sujet ou requête à suivre' },
  { type: 'rss', label: 'Un flux RSS (blog, magazine)', placeholder: 'https://exemple.fr/feed' },
  { type: 'youtube', label: 'Une chaîne YouTube', placeholder: 'https://youtube.com/@chaine' },
];

function sourceTypeLabel(connector: string, source?: string): string {
  if (connector === 'web') return 'Page web';
  if (connector === 'tavily') return 'Recherche';
  if (connector === 'rss') return source === 'youtube' ? 'Chaîne YouTube' : 'Flux RSS';
  return connector;
}

/**
 * Mirrors the server-side StreamProgress union (lib/refresh.ts): refresh frames
 * plus the synthesis frames the SSE routes append AFTER refresh completes, over
 * the same channel. The refresh half is duplicated locally so the client bundle
 * never imports the engine; the synthesis half is a pure type, safe to import.
 */
type Progress =
  | { type: 'source-start'; label: string }
  | { type: 'facts'; sourceLabel: string; added: number; total: number }
  | { type: 'source-error'; label: string; message: string }
  | { type: 'done'; total: number }
  | SynthesisProgress;

type SourceLite = {
  id: string;
  connector: string;
  kind: string;
  label: string | null;
  source?: string;
  target?: string;
  lastExtractedAt?: string | null;
};

type Props = {
  slug: string;
  status: string;
  sources: SourceLite[];
};

type Phase = 'idle' | 'running' | 'done' | 'error';

/** A row in the live progress panel, keyed by source label as it resolves. */
type ProgressLine = {
  label: string;
  state: 'pending' | 'added' | 'error';
  added?: number;
};

/** The synthesis (brief/update) step — a single live line, distinct from the source rows. */
type SynthLine =
  | { state: 'running'; phase: 'brief' | 'update' }
  | { state: 'error'; message: string };

export function DossierRuntime({ slug, status, sources }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const [phase, setPhase] = React.useState<Phase>('idle');
  const [lines, setLines] = React.useState<ProgressLine[]>([]);
  const [synth, setSynth] = React.useState<SynthLine | null>(null);
  const [total, setTotal] = React.useState(0);

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
      setTotal(0);

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
        } else if (p.type === 'facts') {
          setTotal(p.total);
          setLines((prev) => {
            const idx = prev.findIndex((l) => l.label === p.sourceLabel && l.state === 'pending');
            if (idx === -1) {
              return [...prev, { label: p.sourceLabel, state: 'added', added: p.added }];
            }
            const next = [...prev];
            next[idx] = { label: p.sourceLabel, state: 'added', added: p.added };
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
          setTotal(p.total);
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
  // Empty deps + a started-ref so React strict-mode's double-invoke can't
  // open two streams. After `done`, router.refresh() refetches server data and
  // reconciles this island IN PLACE (no remount); startedRef persists across
  // the re-render and the deps are [], so the effect never re-fires.
  React.useEffect(() => {
    if (status === 'building' && !startedRef.current) {
      startedRef.current = true;
      run(`/api/dossiers/${slug}/assemble`);
    }
    return () => {
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

  return (
    <section className="mt-6">
      {/* Toolbar: action buttons */}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={rewriteBrief}
          disabled={isPending || running}
        >
          <PenLine className={cn('h-3.5 w-3.5', isPending && 'animate-pulse')} />
          {isPending ? 'Réécriture…' : 'Réécrire la synthèse'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => run(`/api/dossiers/${slug}/refresh`)} disabled={running || isPending}>
          <RefreshCw className={cn('h-3.5 w-3.5', running && 'animate-spin')} />
          {running ? 'Rafraîchissement…' : 'Rafraîchir'}
        </Button>
      </div>

      {/* Live assembly / refresh progress */}
      {showPanel ? (
        <div className="mt-4 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 shadow-sm">
          <div className="flex items-center gap-2">
            {phase === 'done' ? (
              <Check className="h-4 w-4 text-[color:var(--color-foreground)]" />
            ) : phase === 'error' ? (
              <X className="h-4 w-4 text-[color:var(--color-muted-foreground)]" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-[color:var(--color-muted-foreground)]" />
            )}
            <span className="text-sm font-medium">
              {phase === 'done'
                ? `À jour — ${total} ${total === 1 ? 'fait' : 'faits'}`
                : phase === 'error'
                  ? 'Une erreur est survenue'
                  : `Assemblage en cours — ${total} ${total === 1 ? 'fait' : 'faits'}`}
            </span>
          </div>

          {lines.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {lines.map((line, i) => (
                <li
                  key={`${line.label}-${i}`}
                  className="animate-fact-in flex items-center gap-2.5 text-sm"
                >
                  {line.state === 'pending' ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[color:var(--color-muted-foreground)]" />
                  ) : line.state === 'added' ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-foreground)]" />
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  )}
                  <span
                    className={cn(
                      'truncate',
                      line.state === 'error' && 'text-[color:var(--color-muted-foreground)]',
                    )}
                  >
                    {line.label}
                  </span>
                  {line.state === 'added' ? (
                    <span className="text-[color:var(--color-muted-foreground)] shrink-0 text-xs">
                      {line.added} {line.added === 1 ? 'nouveau fait' : 'nouveaux faits'}
                    </span>
                  ) : line.state === 'error' ? (
                    <span className="text-[color:var(--color-muted-foreground)] shrink-0 text-xs italic">
                      indisponible
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {synth ? (
            <div
              className={cn(
                'animate-fact-in flex items-center gap-2.5 text-sm',
                lines.length > 0 ? 'mt-2' : 'mt-4',
              )}
            >
              {synth.state === 'running' ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[color:var(--color-muted-foreground)]" />
                  <span className="text-[color:var(--color-muted-foreground)]">
                    {synth.phase === 'brief'
                      ? 'Rédaction de la synthèse…'
                      : 'Rédaction de la mise à jour…'}
                  </span>
                </>
              ) : (
                <>
                  <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="text-[color:var(--color-muted-foreground)] italic">
                    Synthèse indisponible — les faits sont enregistrés.
                  </span>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Sources */}
      <SourcesPanel slug={slug} sources={sources} />
    </section>
  );
}

function SourcesPanel({ slug, sources }: { slug: string; sources: SourceLite[] }) {
  const [open, setOpen] = React.useState(false);
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

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] flex items-center gap-1.5 text-xs font-medium transition-colors"
        aria-expanded={open}
      >
        <span>{open ? '▾' : '▸'}</span>
        Sources
        <span className="text-[color:var(--color-muted-foreground)]">({sources.length})</span>
      </button>

      {open ? (
        <div className="mt-3 space-y-2">
          {sources.length === 0 ? (
            <p className="text-[color:var(--color-muted-foreground)] text-sm">
              Aucune source pour l&apos;instant.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {sources.map((s) => (
                <li key={s.id} className="rounded-md border border-[color:var(--color-border)] text-sm">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleExpand(s.id)}
                      aria-expanded={expandedId === s.id}
                      aria-label="Détails de la source"
                      className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] shrink-0 transition-colors"
                    >
                      {expandedId === s.id ? '▾' : '▸'}
                    </button>
                    <span className="truncate">{s.label ?? s.connector}</span>
                    <Badge variant="secondary" className="shrink-0">
                      {sourceTypeLabel(s.connector, s.source)}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto h-7 w-7 shrink-0"
                      onClick={() => remove(s.id)}
                      aria-label={`Retirer la source ${s.label ?? s.connector}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {expandedId === s.id ? (
                    <div className="border-t border-[color:var(--color-border)] px-3 py-2.5">
                      {editingId === s.id ? (
                        <form onSubmit={(e) => saveEdit(e, s.id)} className="space-y-3">
                          <label className="block space-y-1">
                            <span className="text-[color:var(--color-muted-foreground)] block text-xs font-medium">
                              Nom
                            </span>
                            <Input
                              value={editLabel}
                              onChange={(e) => setEditLabel(e.target.value)}
                              placeholder="Nom de la source"
                            />
                          </label>
                          <label className="block space-y-1">
                            <span className="text-[color:var(--color-muted-foreground)] block text-xs font-medium">
                              Cible (URL, requête ou flux)
                            </span>
                            <Input
                              value={editTarget}
                              onChange={(e) => setEditTarget(e.target.value)}
                              placeholder="Cible"
                            />
                          </label>
                          <div className="flex gap-1.5">
                            <Button
                              type="submit"
                              size="sm"
                              disabled={!editTarget.trim() || savePending}
                            >
                              {savePending ? 'Enregistrement…' : 'Enregistrer'}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingId(null)}
                              disabled={savePending}
                            >
                              Annuler
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <div className="space-y-1.5">
                          <dl className="text-[color:var(--color-muted-foreground)] space-y-1">
                            <div>
                              <span className="text-[color:var(--color-foreground)] font-medium">
                                Type :{' '}
                              </span>
                              {sourceTypeLabel(s.connector, s.source)}
                            </div>
                            <div className="break-all">
                              <span className="text-[color:var(--color-foreground)] font-medium">
                                Cible :{' '}
                              </span>
                              {s.target || '—'}
                            </div>
                            <div>
                              <span className="text-[color:var(--color-foreground)] font-medium">
                                Dernière extraction :{' '}
                              </span>
                              {s.lastExtractedAt
                                ? formatDateFr(new Date(s.lastExtractedAt))
                                : 'jamais'}
                            </div>
                          </dl>
                          <Button variant="outline" size="sm" onClick={() => startEdit(s)}>
                            Éditer
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) setError(null);
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="h-3.5 w-3.5" />
                Ajouter une source
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Ajouter une source</DialogTitle>
                <DialogDescription>
                  Lancez un rafraîchissement pour extraire les faits de la nouvelle source.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={add} className="space-y-4">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Type de source">
                  {ADD_SOURCE_OPTIONS.map((o) => (
                    <Button
                      key={o.type}
                      type="button"
                      variant={type === o.type ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setType(o.type);
                        setError(null);
                      }}
                      aria-pressed={type === o.type}
                    >
                      {o.label}
                    </Button>
                  ))}
                </div>
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={ADD_SOURCE_OPTIONS.find((o) => o.type === type)?.placeholder}
                  autoFocus
                />
                {error ? (
                  <p className="text-[color:var(--color-foreground)] text-sm italic">{error}</p>
                ) : null}
                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="ghost" size="sm" disabled={pending}>
                      Annuler
                    </Button>
                  </DialogClose>
                  <Button type="submit" size="sm" disabled={!value.trim() || pending}>
                    {pending ? 'Ajout…' : 'Ajouter'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}
    </div>
  );
}
