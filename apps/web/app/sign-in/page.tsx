'use client';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await authClient.signIn.magicLink({ email, callbackURL: '/' });
    setLoading(false);
    if (res.error) setError(res.error.message ?? 'Une erreur est survenue.');
    else setSent(true);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="text-2xl font-semibold">Veille</h1>
      <p className="text-muted-foreground mt-1 mb-6 text-sm">Dossiers vivants.</p>
      {sent ? (
        <p className="text-sm">Vérifiez votre email — un lien de connexion vous attend.</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vous@exemple.com"
            className="border-input w-full rounded-md border px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-primary text-primary-foreground w-full rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Envoi…' : 'Recevoir le lien de connexion'}
          </button>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </form>
      )}
    </main>
  );
}
