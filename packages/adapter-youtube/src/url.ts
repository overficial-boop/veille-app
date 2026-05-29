const YOUTUBE_HOSTNAMES = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

export function isYouTubeUrl(url: string): boolean {
  try {
    return YOUTUBE_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function extractVideoId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname === 'youtu.be') {
    const id = u.pathname.slice(1);
    return id || null;
  }
  if (u.pathname === '/watch') {
    return u.searchParams.get('v');
  }
  for (const prefix of ['/shorts/', '/live/', '/embed/']) {
    if (u.pathname.startsWith(prefix)) {
      const id = u.pathname.slice(prefix.length).split('/')[0];
      return id || null;
    }
  }
  return null;
}
