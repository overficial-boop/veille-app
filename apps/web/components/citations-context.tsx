'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * Shared "show sources" state for the brief's numbered citation superscripts: the toggle
 * reveals/hides them. (The journal is a plain single-stream prose feed and does not read
 * this — sources for journal items live in the Documents tab.)
 */
type CitationsCtx = { show: boolean; toggle: () => void };

const Ctx = React.createContext<CitationsCtx | null>(null);

export function CitationsProvider({ children }: { children: React.ReactNode }) {
  const [show, setShow] = React.useState(false);
  const toggle = React.useCallback(() => setShow((v) => !v), []);
  const value = React.useMemo(() => ({ show, toggle }), [show, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Returns the shared show/toggle. Falls back to a no-op (hidden) outside a provider. */
export function useCitations(): CitationsCtx {
  return React.useContext(Ctx) ?? { show: false, toggle: () => {} };
}

/** The "Afficher les sources" switch, bound to the shared state. Rendered in both
 *  the brief and the journal section headers; either one flips both. */
export function SourcesToggle() {
  const { show, toggle } = useCitations();
  return (
    <div
      className={'fold-toggle' + (show ? ' on' : '')}
      role="switch"
      aria-checked={show}
      tabIndex={0}
      onClick={toggle}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle())}
    >
      {show ? <Eye /> : <EyeOff />}
      {show ? 'Sources affichées' : 'Afficher les sources'}
    </div>
  );
}
