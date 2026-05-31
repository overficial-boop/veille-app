'use client';
import { useState, useRef, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from '@/components/veille-ui';
import { ArrowUp, Sparkles } from 'lucide-react';

const EXAMPLES = [
  'Suivre la carrière de Jules Marie au padel professionnel — résultats, classements, interviews',
  'Chronologie de l\'affaire des écoutes politiques depuis l\'ouverture de l\'enquête',
  'Veille sur le règlement européen de l\'IA et les positions des grands fournisseurs',
];

export function NewDossierForm() {
  const router = useRouter();
  const [intent, setIntent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  async function submit() {
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
      e.preventDefault();
      void submit();
    }
  }

  return (
    <>
      <div className="compose card">
        <div className="compose-inner">
          <div className="compose-label">
            <Sparkles style={{ width: 18, height: 18, color: 'var(--accent)' }} />
            Nouveau dossier
          </div>
          <div className="compose-sub">
            Décrivez en une phrase ce que vous souhaitez suivre. Veille en compose le dossier — sources, présentation et cadence.
          </div>
          <textarea
            ref={taRef}
            className="field"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={loading}
            placeholder="Ex. : Suivre l'application du règlement européen sur l'IA et les positions des grands fournisseurs…"
            rows={3}
            aria-label="Votre intention"
          />
          <div className="compose-foot">
            <span className="kbd">
              <kbd>⌘</kbd><kbd>↵</kbd> pour lancer
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {error && <span style={{ color: 'var(--danger)', fontSize: 'var(--t-sm)' }}>{error}</span>}
              <Btn
                variant="primary"
                icon={loading ? undefined : ArrowUp}
                onClick={() => void submit()}
                disabled={!intent.trim() || loading}
              >
                {loading ? 'Analyse de votre intention…' : 'Créer le dossier'}
              </Btn>
            </div>
          </div>
        </div>
      </div>

      <div className="compose-examples">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            className="chip"
            onClick={() => {
              setIntent(ex);
              taRef.current?.focus();
            }}
          >
            {ex}
          </button>
        ))}
      </div>
    </>
  );
}
