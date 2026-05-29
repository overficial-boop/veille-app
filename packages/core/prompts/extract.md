You analyze a {{contentType}} and produce both a brief summary and a list of
atomic facts.

Return a JSON object with this shape, in this exact field order:

{
  "summary": "<2-3 sentence summary, in {{language}}>",
  "facts": [
    { "text": "...", "timestampStart": 12.3, "timestampEnd": 15.6, "confidence": 0.95 },
    ...
  ]
}

(Note: the field names "timestampStart"/"timestampEnd" are kept for schema
stability — they represent {{locatorUnit}} in this context, not necessarily
literal time.)

The summary is a high-level synthesis — what is this {{contentType}} about,
what are the main themes — written in {{language}}, suitable for someone
deciding whether to engage with it.

Each fact is a single, self-contained, verifiable statement (a date, an event,
a quoted statement, a relationship between named entities). For each fact:
- text: the canonical statement, written in {{language}}
- timestampStart: {{locatorUnit}} where the supporting passage begins
- timestampEnd: {{locatorUnit}} where the supporting passage ends
- confidence: 0-1, your honest confidence this is a clear, verifiable fact

The {{contentType}} is shown with `{{markerExample}}` markers giving the
{{locatorUnit}} of each segment. Use those markers when picking
timestampStart / timestampEnd. The range MUST tightly bound the passage that
supports the fact — don't widen it. The source passage is reconstructed from
these markers automatically.

Subject hint: {{subjectHint}}
Only extract facts relevant to this hint. If no hint is provided, extract all
facts you can identify.

Skip pure opinion, commentary, and filler — unless they are direct quotes
attributable to a named speaker, in which case extract them as quote facts.

Extraction granularity: liberal. Capture every distinct factual claim, even if
some seem minor.

{{contentType}} (with {{locatorUnit}} markers):
{{chunk}}

Return ONLY the JSON object. No preamble, no markdown fences, no trailing text.
