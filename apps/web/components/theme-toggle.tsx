'use client';
import * as React from 'react';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const [theme, setTheme] = React.useState<'light' | 'dark' | null>(null);
  React.useEffect(() => {
    const t = document.documentElement.getAttribute('data-theme');
    setTheme(t === 'dark' ? 'dark' : 'light');
  }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch {}
    setTheme(next);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      className="btn btn-quiet btn-sm"
      aria-label={theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}
      title="Thème clair / sombre"
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
