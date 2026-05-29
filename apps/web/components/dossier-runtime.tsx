'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Plus, RefreshCw, X } from 'lucide-react';
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
import {
  setTemplateAction,
  addSourceAction,
  removeSourceAction,
} from '@/app/dossier/[slug]/actions';

/** Mirrors the server-side RefreshProgress union (lib/refresh.ts). Defined locally so the client bundle never imports the engine. */
type Progress =
  | { type: 'source-start'; label: string }
  | { type: 'facts'; sourceLabel: string; added: number; total: number }
  | { type: 'source-error'; label: string; message: string }
  | { type: 'done'; total: number };

type TemplateKey = 'feed' | 'profile' | 'chronology';

type SourceLite = {
  id: string;
  connector: string;
  kind: string;
  label: string | null;
};

type Props = {
  slug: string;
  status: string;
  template: TemplateKey;
  factCount: number;
  sources: SourceLite[];
};

type Phase = 'idle' | 'running' | 'done' | 'error';

/** A row in the live progress panel, keyed by source label as it resolves. */
type ProgressLine = {
  label: string;
  state: 'pending' | 'added' | 'error';
  added?: number;
};

const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  feed: 'Fil',
  profile: 'Profil',
  chronology: 'Chronologie',
};

const TEMPLATE_ORDER: TemplateKey[] = ['feed', 'profile', 'chronology'];

export function DossierRuntime({ slug, status, template, sources }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const [phase, setPhase] = React.useState<Phase>('idle');
  const [lines, setLines] = React.useState<ProgressLine[]>([]);
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
          doneRef.current = true;
          setTotal(p.total);
          closeStream();
          setPhase('done');
          router.refresh();
        }
      };

      es.onerror = () => {
        // The server closes the connection right after the `done` frame, which
        // also fires onerror. The doneRef guard distinguishes a normal close
        // from a real failure and prevents EventSource auto-reconnect loops.
        if (doneRef.current) return;
        closeStream();
        setPhase('error');
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
  const showPanel = phase === 'running' || (phase === 'done' && lines.length > 0) || phase === 'error';

  function switchTemplate(key: TemplateKey) {
    if (key === template || isPending) return;
    startTransition(() => {
      setTemplateAction(slug, key);
    });
  }

  return (
    <section className="mt-6">
      {/* Toolbar: template switcher + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5" role="group" aria-label="Présentation">
          {TEMPLATE_ORDER.map((key) => (
            <Button
              key={key}
              variant={key === template ? 'default' : 'outline'}
              size="sm"
              onClick={() => switchTemplate(key)}
              disabled={isPending}
              aria-pressed={key === template}
            >
              {TEMPLATE_LABELS[key]}
            </Button>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={() => run(`/api/dossiers/${slug}/refresh`)} disabled={running}>
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

  const [kind, setKind] = React.useState<'item' | 'standing'>('item');
  const [value, setValue] = React.useState('');

  function remove(sourceId: string) {
    startTransition(() => {
      removeSourceAction(slug, sourceId);
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    startTransition(() => {
      addSourceAction(slug, { kind, value: v });
    });
    setValue('');
    setKind('item');
    setDialogOpen(false);
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
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded-md border border-[color:var(--color-border)] px-3 py-2 text-sm"
                >
                  <span className="truncate">{s.label ?? s.connector}</span>
                  <Badge variant="secondary" className="shrink-0">
                    {s.kind === 'standing' ? 'permanente' : 'ponctuelle'}
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
                </li>
              ))}
            </ul>
          )}

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
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
                <div className="flex gap-1.5" role="group" aria-label="Type de source">
                  <Button
                    type="button"
                    variant={kind === 'item' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setKind('item')}
                    aria-pressed={kind === 'item'}
                  >
                    Une page web (URL)
                  </Button>
                  <Button
                    type="button"
                    variant={kind === 'standing' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setKind('standing')}
                    aria-pressed={kind === 'standing'}
                  >
                    Une recherche permanente
                  </Button>
                </div>
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={
                    kind === 'item' ? 'https://exemple.fr/article' : 'Sujet ou requête à suivre'
                  }
                  autoFocus
                />
                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="ghost" size="sm">
                      Annuler
                    </Button>
                  </DialogClose>
                  <Button type="submit" size="sm" disabled={!value.trim()}>
                    Ajouter
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
