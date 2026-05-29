You analyze a YouTube transcript and produce both a brief summary and a list of
atomic facts.

Return a JSON object with this shape, in this exact field order:

{
  "summary": "<2-3 sentence summary of the video, in {{language}}>",
  "facts": [
    { "text": "...", "timestampStart": 12.3, "timestampEnd": 15.6, "confidence": 0.95, "relevance": 0.9 },
    ...
  ]
}

The summary is a high-level synthesis — what is this video about, what are the
main themes — written in {{language}}, suitable for someone deciding whether
to watch.

Each fact is a single, self-contained, verifiable statement (a date, an event,
a quoted statement, a relationship between named entities). For each fact:
- text: the canonical statement, written in {{language}}
- timestampStart: seconds within the video where the supporting passage begins
- timestampEnd: seconds where the supporting passage ends
- confidence: 0-1, your honest confidence this is a clear, verifiable fact
- relevance: 0-1, how directly this fact concerns the subject hint below
  (1 = squarely about the subject; low = tangential/background/co-occurring).
  If no subject hint is provided, set relevance to 1.

The transcript is shown with `[Xs]` markers giving the start time of each
segment. Use those markers when picking timestamps. The timestamp range MUST
tightly bound the passage that supports the fact — don't widen it. The source
passage is reconstructed from these timestamps automatically.

Subject hint: {{subjectHint}}
If a subject hint is provided, extract ONLY facts that genuinely concern that
subject. The transcript often covers other people, entities, or events that
merely co-occur with the subject — do NOT extract those; skip them. Score each
kept fact's `relevance` to the subject. If no subject hint is provided, extract
all facts you can identify and set relevance to 1.

Skip pure opinion, commentary, and filler — unless they are direct quotes
attributable to a named speaker, in which case extract them as quote facts.

Extraction granularity: liberal. Capture every distinct factual claim, even if
some seem minor.

Transcript (with timestamps):
{{chunk}}

Return ONLY the JSON object. No preamble, no markdown fences, no trailing text.
