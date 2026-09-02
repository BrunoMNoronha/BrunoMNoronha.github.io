import siteData from '@/content/site.json';

export type Locale = 'pt-BR' | 'en';
export type CollectionName = 'projects' | 'articles' | 'posts';
export type Translation = {
  title: string;
  summary: string;
  coverAlt: string;
  body: string[];
  status: 'draft' | 'published';
  publishedAt: string | null;
};
export type ContentItem = {
  id: string;
  slug: string;
  featured: boolean;
  cover: string | null;
  technologies?: string[];
  tags?: string[];
  links?: { label: string; url: string }[];
  translations: Record<Locale, Translation>;
};

export const site = siteData;

export function isPublished(item: ContentItem, locale: Locale, today = new Date()): boolean {
  const translation = item.translations[locale];
  if (!translation || translation.status !== 'published' || !translation.publishedAt) return false;
  const publishDate = new Date(`${translation.publishedAt}T00:00:00Z`);
  return Number.isFinite(publishDate.valueOf()) && publishDate <= today;
}

export function getPublished(collection: CollectionName, locale: Locale): ContentItem[] {
  return (site[collection] as ContentItem[])
    .filter((item) => isPublished(item, locale))
    .sort((a, b) => String(b.translations[locale].publishedAt).localeCompare(String(a.translations[locale].publishedAt)));
}

export function getPublishedItem(collection: CollectionName, slug: string, locale: Locale): ContentItem | undefined {
  return getPublished(collection, locale).find((item) => item.slug === slug);
}

export function getRoutable(collection: CollectionName): ContentItem[] {
  return (site[collection] as ContentItem[]).filter((item) => isPublished(item, 'pt-BR') || isPublished(item, 'en'));
}

export function formatDate(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}
