'use client';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';
import { VeilleGlyph, Btn } from '@/components/veille-ui';
import { MailCheck, AlertCircle } from 'lucide-react';

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

  const lines = [12, 28, 44, 60, 76, 88];

  return (
    <div className="signin">
      <div className="signin-bg" aria-hidden="true">
        {lines.map((l) => (
          <span key={l} className="ln" style={{ left: l + '%' }} />
        ))}
      </div>

      <div className="signin-inner">
        <VeilleGlyph size={46} />
        <h1>Veille</h1>
        <p className="sub">Dossiers vivants.</p>

        {sent ? (
          <div className="signin-msg ok">
            <MailCheck />
            <span>
              Vérifiez votre email — un lien de connexion vous attend à l&apos;adresse{' '}
              <b>{email}</b>.
            </span>
          </div>
        ) : (
          <form onSubmit={submit}>
            <input
              className="field"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder="vous@exemple.com"
              aria-label="Adresse email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
            />
            {error && (
              <div className="signin-msg err" role="alert">
                <AlertCircle />
                <span>{error}</span>
              </div>
            )}
            <Btn
              variant="primary"
              size="lg"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Envoi…' : 'Recevoir le lien de connexion'}
            </Btn>
            <div className="hint">
              Connexion sans mot de passe. Un lien à usage unique vous est envoyé par email.
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
