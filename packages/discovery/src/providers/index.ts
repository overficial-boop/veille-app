import type { DiscoveryTool } from '@veille/core';
import type { Candidate } from '../types.js';
import { discoverRss } from './rss.js';
import { discoverTavily } from './tavily.js';
import { discoverYouTubeChannel } from './youtube-channel.js';

/** Run the appropriate provider for a discovery tool. */
export async function runDiscoveryProvider(tool: DiscoveryTool): Promise<Candidate[]> {
  switch (tool.kind) {
    case 'tavily':
      return discoverTavily(tool.config);
    case 'rss':
      return discoverRss(tool.config);
    case 'youtube-channel':
      return discoverYouTubeChannel(tool.config);
  }
}

export { discoverRss } from './rss.js';
export { discoverTavily } from './tavily.js';
export { discoverYouTubeChannel } from './youtube-channel.js';
