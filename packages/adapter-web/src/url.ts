import { isYouTubeUrl } from '@veille/adapter-youtube';

export function isWebUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (isYouTubeUrl(url)) return false;
  return true;
}
