export type WebProvenance = {
  pageUrl: string;
  fetchedAt: string;
  publishedAt?: string;
  author?: string;
  title: string;
  paragraphStart: number;
  paragraphEnd: number;
};
