/** Deterministic oklch hue from a seed string (stable hash mod 360). */
export function pubHue(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffffffff;
  return `oklch(0.5 0.13 ${Math.abs(h) % 360})`;
}

/** Two-letter monogram from a publication name ("lemonde.fr" → "LE", "Le Média" → "LE"). */
export function pubMono(name: string): string {
  const label = name.replace(/^www\./, '').split('.')[0] ?? name;
  const chars = label.replace(/[^a-zA-Z0-9]/g, '');
  return (chars.slice(0, 2) || label.slice(0, 2)).toUpperCase();
}
