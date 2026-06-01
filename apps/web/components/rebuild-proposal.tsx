'use client';

import * as React from 'react';
import { regenerateBriefAction, dismissBriefSuggestionAction } from '@/app/dossier/[slug]/actions';

/** Quiet banner proposing a brief rebuild when older-than-brief material has been found.
 *  "Reconstruire" reuses the existing full-rewrite action; "Plus tard" snoozes until newer
 *  old facts arrive. After either, the server revalidates and the recomputed count clears it. */
export function RebuildProposal({ count, slug }: { count: number; slug: string }) {
  const [pending, start] = React.useTransition();
  if (count <= 0) return null;
  const plural = count > 1;
  return (
    <div className="rebuild-proposal">
      <span className="rebuild-msg">
        <b>{count}</b> élément{plural ? 's' : ''} plus ancien{plural ? 's' : ''} à intégrer au brief.
      </span>
      <span className="rebuild-actions">
        <button
          type="button"
          className="btn btn-soft btn-sm"
          disabled={pending}
          onClick={() => start(() => { void regenerateBriefAction(slug); })}
        >
          {pending ? 'Réécriture…' : 'Reconstruire le brief'}
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          disabled={pending}
          onClick={() => start(() => { void dismissBriefSuggestionAction(slug); })}
        >
          Plus tard
        </button>
      </span>
    </div>
  );
}
