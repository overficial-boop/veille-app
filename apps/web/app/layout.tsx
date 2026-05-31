import './globals.css';
import type { ReactNode } from 'react';
import { Newsreader, Public_Sans, IBM_Plex_Mono } from 'next/font/google';

const newsreader = Newsreader({
  subsets: ['latin'],
  axes: ['opsz'],
  // weight must be omitted or 'variable' when axes are specified
  style: ['normal', 'italic'],
  variable: '--font-newsreader',
  display: 'swap',
});

const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-public-sans',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

export const metadata = {
  title: 'Veille',
  description: 'Living dossiers — subjects that watch the world for you.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="fr"
      className={`${newsreader.variable} ${publicSans.variable} ${ibmPlexMono.variable}`}
    >
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();",
          }}
        />
        {children}
      </body>
    </html>
  );
}
