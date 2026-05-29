import type { Subject, Fact, SourceConfig } from './types.js';

export type ExportFormat = 'markdown' | 'json';

function shortId(id: string): string {
  return id.slice(0, 8);
}

function sourceLabel(source: SourceConfig): string {
  if (source.input.kind === 'url') return source.input.url;
  if (source.input.kind === 'file') return `file ${source.input.path}`;
  return `text "${source.input.label}" (${source.input.content.length.toLocaleString()} chars)`;
}

function factProvenanceSummary(fact: Fact): string {
  const p = (fact.provenance ?? {}) as Record<string, unknown>;
  if (typeof p['timestampStart'] === 'number' && typeof p['timestampEnd'] === 'number') {
    const s = Math.round(p['timestampStart']);
    const e = Math.round(p['timestampEnd']);
    return s === e ? `at ${s}s` : `${s}–${e}s`;
  }
  if (typeof p['paragraphStart'] === 'number' && typeof p['paragraphEnd'] === 'number') {
    const s = p['paragraphStart'];
    const e = p['paragraphEnd'];
    return s === e ? `paragraph ${s}` : `paragraphs ${s}–${e}`;
  }
  return '';
}

/**
 * Render a Subject as a markdown dossier:
 *   # Subject name
 *   description, metadata
 *   ## Sources (with adapter + input + extracted-at)
 *   ## Facts grouped by source, each with text, sourcePassage quote, provenance, confidence
 */
export function exportSubjectAsMarkdown(subject: Subject): string {
  const lines: string[] = [];

  lines.push(`# ${subject.name}`);
  lines.push('');
  if (subject.description) {
    lines.push(subject.description);
    lines.push('');
  }
  lines.push(`- **Slug:** \`${subject.slug}\``);
  if (subject.language) lines.push(`- **Language:** ${subject.language}`);
  lines.push(`- **Sources:** ${subject.sources.length}`);
  lines.push(`- **Facts:** ${subject.facts.length}`);
  lines.push(`- **Created:** ${subject.createdAt}`);
  lines.push(`- **Last refresh:** ${subject.refreshedAt}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  lines.push('## Sources');
  lines.push('');
  if (subject.sources.length === 0) {
    lines.push('*No sources.*');
  } else {
    for (const s of subject.sources) {
      const extracted = s.lastExtractedAt
        ? `extracted ${s.lastExtractedAt}`
        : 'not yet extracted';
      lines.push(`- \`${shortId(s.id)}\` **${s.adapter}** — ${sourceLabel(s)} (${extracted})`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  lines.push('## Facts');
  lines.push('');
  if (subject.facts.length === 0) {
    lines.push('*No facts yet.*');
    return lines.join('\n');
  }

  // Group facts by their sourceUrl (which is the canonical per-source identifier).
  const groups = new Map<string, Fact[]>();
  for (const f of subject.facts) {
    const arr = groups.get(f.sourceUrl) ?? [];
    arr.push(f);
    groups.set(f.sourceUrl, arr);
  }

  // Stable order: by first occurrence in subject.facts.
  for (const [sourceUrl, facts] of groups) {
    lines.push(`### Source: ${sourceUrl}`);
    lines.push('');
    let idx = 1;
    for (const f of facts) {
      lines.push(`${idx}. **${f.text}**`);
      if (f.sourcePassage) {
        const quoted = f.sourcePassage
          .split('\n')
          .map((l) => `   > ${l}`)
          .join('\n');
        lines.push('');
        lines.push(quoted);
      }
      const meta: string[] = [];
      const prov = factProvenanceSummary(f);
      if (prov) meta.push(prov);
      if (f.confidence !== undefined) meta.push(`confidence ${f.confidence.toFixed(2)}`);
      meta.push(`model \`${f.extractedBy.model}\``);
      lines.push('');
      lines.push(`   *${meta.join(' · ')}*`);
      lines.push('');
      idx++;
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function exportSubjectAsJson(subject: Subject): string {
  return JSON.stringify(subject, null, 2) + '\n';
}

export function exportSubject(subject: Subject, format: ExportFormat): string {
  return format === 'markdown'
    ? exportSubjectAsMarkdown(subject)
    : exportSubjectAsJson(subject);
}

export function exportSubjectMimeType(format: ExportFormat): string {
  return format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8';
}

export function exportSubjectFilename(subject: Subject, format: ExportFormat): string {
  const ext = format === 'markdown' ? 'md' : 'json';
  return `${subject.slug}.${ext}`;
}
