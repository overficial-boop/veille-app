import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Veille',
  description: 'Living dossiers — subjects that watch the world for you.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
