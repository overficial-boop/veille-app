/**
 * State machine that consumes streamed JSON text incrementally and emits the
 * characters of the top-level "summary" string value as they arrive. Once the
 * closing `"` of the summary value is encountered, the parser stops emitting
 * (subsequent feed() calls are accepted but produce no output).
 *
 * Tolerant of arbitrary whitespace and the leading `{`. Decodes basic JSON
 * escape sequences in the summary value (\n, \", \\, \t, \r) on the fly.
 *
 * Usage:
 *   const parser = createSummaryStreamParser((chunk) => process.stderr.write(chunk));
 *   parser.feed('{"summary": "Hello, ');
 *   parser.feed('world!", "facts": ...');
 *   parser.done(); // signals end-of-stream
 */
export type SummaryStreamParser = {
  feed(text: string): void;
  done(): void;
  isComplete(): boolean;
};

type Phase = 'before_summary' | 'in_summary' | 'after_summary';

export function createSummaryStreamParser(
  emit: (chunk: string) => void,
): SummaryStreamParser {
  let phase: Phase = 'before_summary';
  let buffer = '';
  let escape = false;

  function processChar(ch: string): void {
    if (phase !== 'in_summary') return;
    if (escape) {
      const decoded =
        ch === 'n' ? '\n' :
        ch === 't' ? '\t' :
        ch === 'r' ? '\r' :
        ch === '"' ? '"' :
        ch === '\\' ? '\\' :
        ch === '/' ? '/' :
        ch;
      emit(decoded);
      escape = false;
      return;
    }
    if (ch === '\\') { escape = true; return; }
    if (ch === '"') { phase = 'after_summary'; return; }
    emit(ch);
  }

  return {
    feed(text: string): void {
      if (phase === 'after_summary') return;
      if (phase === 'before_summary') {
        buffer += text;
        const m = buffer.match(/"summary"\s*:\s*"/);
        if (!m) return;
        const startIdx = (m.index ?? 0) + m[0].length;
        const remainder = buffer.slice(startIdx);
        buffer = '';
        phase = 'in_summary';
        for (const c of remainder) processChar(c);
        return;
      }
      for (const c of text) processChar(c);
    },
    done(): void {
      // No-op; emit() has been called for everything we'll emit.
    },
    isComplete(): boolean {
      return phase === 'after_summary';
    },
  };
}
