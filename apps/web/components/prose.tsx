import ReactMarkdown from 'react-markdown';

/** Renders trusted-ish LLM markdown as a safe subset (no raw HTML — react-markdown ignores it by default). */
export function Prose({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        components={{
          p: ({ node, ...p }) => <p className="leading-relaxed mb-3" {...p} />,
          ul: ({ node, ...p }) => <ul className="list-disc pl-5 mb-3 space-y-1" {...p} />,
          ol: ({ node, ...p }) => <ol className="list-decimal pl-5 mb-3 space-y-1" {...p} />,
          strong: ({ node, ...p }) => <strong className="font-semibold" {...p} />,
          a: ({ node, ...p }) => <a className="underline underline-offset-4 hover:text-foreground text-muted-foreground" target="_blank" rel="noopener noreferrer" {...p} />,
          h1: ({ node, ...p }) => <h2 className="font-display text-xl mt-4 mb-2 text-foreground" {...p} />,
          h2: ({ node, ...p }) => <h3 className="font-display text-lg mt-4 mb-2 text-foreground" {...p} />,
          h3: ({ node, ...p }) => <h4 className="font-medium mt-3 mb-1" {...p} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
