/**
 * veille-ui.tsx — Ardoise design primitives
 * Replicates primitives.jsx + icon mapping, typed for the web app.
 * No 'use client' needed — purely presentational, no hooks.
 */
import type { ComponentType, ReactNode, ButtonHTMLAttributes } from 'react';
import { Globe, Search, Rss, Youtube } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  VeilleGlyph — exact replica of the brand mark from icons.jsx       */
/* ------------------------------------------------------------------ */
export function VeilleGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
    >
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent)" />
      <circle
        cx="16"
        cy="16"
        r="9"
        stroke="var(--accent-ink)"
        strokeWidth="1.6"
        opacity="0.5"
      />
      <circle
        cx="16"
        cy="16"
        r="5.2"
        stroke="var(--accent-ink)"
        strokeWidth="1.6"
        opacity="0.8"
      />
      <circle cx="16" cy="16" r="2" fill="var(--accent-ink)" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Btn                                                                 */
/* ------------------------------------------------------------------ */
type BtnVariant = 'primary' | 'ghost' | 'soft' | 'quiet' | 'danger';
type BtnSize = 'sm' | 'lg';

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: ComponentType<{ className?: string }>;
  children?: ReactNode;
  className?: string;
}

export function Btn({
  variant = 'soft',
  size,
  icon: Icon,
  children,
  className = '',
  ...rest
}: BtnProps) {
  const cls = [
    'btn',
    `btn-${variant}`,
    size ? `btn-${size}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={cls} {...rest}>
      {Icon ? <Icon /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  StatusPill                                                          */
/* ------------------------------------------------------------------ */
type DossierStatus = 'building' | 'active' | 'idle';

interface StatusPillProps {
  status: DossierStatus | string;
  /** When true, override with the animated "live" (assembling) style */
  live?: boolean;
}

const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  prep:     { cls: 'status-prep',   label: 'En préparation' },
  building: { cls: 'status-prep',   label: 'En préparation' },
  active:   { cls: 'status-active', label: 'Actif' },
  idle:     { cls: 'status-idle',   label: 'En veille' },
  live:     { cls: 'status-live',   label: 'Assemblage' },
};

export function StatusPill({ status, live }: StatusPillProps) {
  const key = live ? 'live' : status;
  const { cls, label } = STATUS_MAP[key] ?? { cls: 'status-idle', label: status };
  return (
    <span className={`status ${cls}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  SourceBadge                                                         */
/* ------------------------------------------------------------------ */
interface SourceBadgeProps {
  /** The app's connector value: 'web' | 'tavily' | 'rss' */
  connector: string;
  /** The source.input.source value — used to distinguish youtube RSS */
  source?: string;
}

function resolveSourceType(connector: string, source?: string) {
  if (connector === 'rss' && source === 'youtube') {
    return { Icon: Youtube, label: 'Chaîne YouTube' };
  }
  switch (connector) {
    case 'web':    return { Icon: Globe,  label: 'Page web' };
    case 'tavily':
    case 'google-news': return { Icon: Search, label: 'Recherche' };
    case 'rss':    return { Icon: Rss,    label: 'Flux RSS' };
    default:       return { Icon: Globe,  label: connector };
  }
}

export function SourceBadge({ connector, source }: SourceBadgeProps) {
  const { Icon, label } = resolveSourceType(connector, source);
  return (
    <span className="badge">
      <Icon />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  ConfBars + confLevel helper                                         */
/* ------------------------------------------------------------------ */
const CONF_LABELS: Record<1 | 2 | 3, string> = {
  1: 'indice faible',
  2: 'indice moyen',
  3: 'indice élevé',
};

/** Map a 0–1 confidence (or undefined) to a display level 1/2/3. */
export function confLevel(confidence?: number): 1 | 2 | 3 {
  if (confidence === undefined || confidence === null) return 2;
  if (confidence >= 0.75) return 3;
  if (confidence >= 0.45) return 2;
  return 1;
}

interface ConfBarsProps {
  level: 1 | 2 | 3;
  /** Show the text label ("indice élevé"). The bars carry the level; the label is redundant in
   *  dense lists, so callers can hide it (the title tooltip still names the level). */
  showLabel?: boolean;
}

export function ConfBars({ level, showLabel = true }: ConfBarsProps) {
  const label = CONF_LABELS[level];
  return (
    <span className="conf" title={`Confiance : ${label}`}>
      <span className="bars">
        {([1, 2, 3] as const).map((i) => (
          <i key={i} className={i <= level ? 'on' : ''} />
        ))}
      </span>
      {showLabel && <span>{label}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Eyebrow                                                             */
/* ------------------------------------------------------------------ */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}
