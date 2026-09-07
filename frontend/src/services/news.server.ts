import { cache } from 'react';
import { isAxiosError } from 'axios';
import { notFound } from 'next/navigation';
import { NewsService } from './news.service';

// Metadata and page rendering must share the same result for a request.
// Only a confirmed missing article is a 404; outages must remain server errors.
export const getArticleBySlug = cache(async (slug: string, contentType: 'news' | 'blog') => {
  try {
    return await NewsService.getArticleBySlug(slug, contentType);
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) notFound();
    throw error;
  }
});

export const getArticleByPath = cache(async (path: string) => {
  try {
    return await NewsService.getArticleByPath(path);
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) notFound();
    throw error;
  }
});
