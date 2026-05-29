'use client';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export function NewDossierForm() {
  const router = useRouter();
  const [intent, setIntent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = intent.trim();
    if (!value || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dossiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: value }),
      });
      const data = (await res.json()) as { slug?: string; error?: string };
      if (!res.ok || !data.slug) {
        setError(data.error ?? 'Création impossible.');
        setLoading(false);
        return;
      }
      router.push(`/dossier/${data.slug}`);
    } catch {
      setError('Création impossible.');
      setLoading(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      void submit(e);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Textarea
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ex. : suivre la carrière de Jules Marie au padel professionnel — ou la chronologie de l'affaire…"
        rows={3}
        disabled={loading}
        aria-label="Votre intention"
        className="resize-none"
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={loading || !intent.trim()}>
          {loading ? 'Analyse de votre intention…' : 'Créer le dossier'}
        </Button>
        {error ? (
          <span className="text-destructive text-sm">{error}</span>
        ) : (
          <span className="text-muted-foreground text-xs">⌘↵ pour lancer</span>
        )}
      </div>
    </form>
  );
}
