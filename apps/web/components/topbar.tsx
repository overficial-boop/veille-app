/**
 * topbar.tsx — sticky Ardoise shell top bar (server component)
 * Renders: wordmark (glyph + "Veille") · spacer · account area (email + sign-out)
 */
import { VeilleGlyph } from './veille-ui';
import { SignOutButton } from './sign-out-button';

interface TopBarProps {
  email: string;
}

export function TopBar({ email }: TopBarProps) {
  return (
    <div className="topbar">
      <a href="/" className="wordmark" aria-label="Veille — accueil">
        <VeilleGlyph size={22} />
        Veille
      </a>
      <div className="topbar-spacer" />
      <div className="topbar-acct">
        <span className="topbar-email">{email}</span>
        <SignOutButton />
      </div>
    </div>
  );
}
