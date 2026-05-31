'use client';

import * as React from 'react';
import { Prose } from './prose';

/**
 * Remove inline source citations (`[text](url)`, with any leading whitespace) so the brief
 * reads as clean prose. The synthesis brief embeds source links inline; hiding them by default
 * keeps the brief legible, and the toggle reveals the clickable sources on demand.
 */
function stripSourceLinks(markdown: string): string {
  return markdown.replace(/\s*\[[^\]]+\]\((?:[^()]|\([^()]*\))*\)/g, '');
}

/** The dossier brief, with a hide/show toggle for its inline source links (hidden by default). */
export function Brief({ brief }: { brief: string }) {
  const [showSources, setShowSources] = React.useState(false);
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => setShowSources((s) => !s)}
          aria-pressed={showSources}
          className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] text-xs font-medium transition-colors"
        >
          {showSources ? 'Masquer les sources' : 'Afficher les sources'}
        </button>
      </div>
      <Prose className="text-[color:var(--color-foreground)]">
        {showSources ? brief : stripSourceLinks(brief)}
      </Prose>
    </div>
  );
}
