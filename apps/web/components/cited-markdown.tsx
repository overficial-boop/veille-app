'use client';

import * as React from 'react';
import { type Components } from 'react-markdown';
import { proseComponents } from './prose';
import { hostOf } from '@/lib/host';

/**
 * Shared citation rendering for the synthesis prose (brief + journal).
 *
 * Links become numbered superscripts (¹²³) at the cited point, each linking to its
 * source. Numbers come from the shared citation map (so brief, journal, and the
 * evidence section all use the same number for a given URL). The superscripts are
 * hidden until an ancestor carries `.show-src` — see the `.cite` rules in globals.css.
 */

/** Drop the space before a citation link so the superscript hugs the preceding word
 *  ("claim¹"), keeping the prose clean when numbers are hidden. */
export function prepareCiteMd(text: string): string {
  return text.replace(/[ \t]+(?=\[[^\]]+\]\()/g, '');
}

/** Markdown renderers (the shared prose set, with `a` overridden to a numbered citation). */
export function citeComponents(citations: Record<string, number>): Components {
  return {
    ...proseComponents,
    a: ({ href, children }) => {
      const n = href ? citations[href] : undefined;
      if (!href || !n) return <>{children}</>;
      return (
        <a className="cite" href={href} target="_blank" rel="noopener noreferrer" title={hostOf(href)}>
          <sup>{n}</sup>
        </a>
      );
    },
  };
}
