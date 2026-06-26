import { Metadata } from 'next';
import { Suspense } from 'react';
import { getSiteUrl } from '@/lib/url';
import { NewsService } from '@/services/news.service';
import NewsPageClient from './NewsPageClient';

export async function generateMetadata({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}): Promise<Metadata> {
  const params = await searchParams;
  const search = params.search;

  let title = 'News & Articles | Vcocnc';
  let description = 'Latest news, insights, and technical articles about industrial automation, FANUC parts, and CNC equipment from Vcocnc.';

  if (search) {
    title = `Search: ${search} - News | Vcocnc`;
    description = `Search results for "${search}" in news and articles.`;
  }

  const baseUrl = getSiteUrl();
  const hasSearch = typeof search === 'string' && search.trim().length > 0;

  return {
    title,
    description,
    robots: hasSearch ? { index: false, follow: true } : { index: true, follow: true },
    keywords: ['FANUC news', 'CNC articles', 'industrial automation', 'technical blog', search].filter(Boolean).join(', '),
    openGraph: {
      title,
      description,
      type: 'website',
      url: `${baseUrl}/news`,
    },
    alternates: {
      canonical: `${baseUrl}/news`,
    },
  };
}

async function getServerSideData(searchParams: { [key: string]: string | string[] | undefined }) {
  const search = searchParams.search;
  const page = parseInt((searchParams.page as string) || '1', 10);

  const searchStr = typeof search === 'string' && search.trim() ? search.trim() : undefined;

  try {
    const data = await NewsService.getArticles({
      search: searchStr,
      page,
      page_size: 12,
    });

    return {
      articles: data.data || [],
      totalPages: data.total_pages || 1,
      total: data.total || 0,
      currentPage: page,
      searchQuery: (search as string) || '',
    };
  } catch (error) {
    console.error('Failed to fetch news:', error);
    return {
      articles: [],
      totalPages: 1,
      total: 0,
      currentPage: 1,
      searchQuery: '',
    };
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams;
  const serverData = await getServerSideData(params);

  const baseUrl = getSiteUrl();
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    'name': 'Vcocnc News & Articles',
    'description': 'Latest news and insights about industrial automation and FANUC parts.',
    'url': `${baseUrl}/news`,
    'publisher': {
      '@type': 'Organization',
      'name': 'Vcocnc',
      'url': baseUrl,
    },
    'blogPost': serverData.articles.slice(0, 10).map((article: any) => ({
      '@type': 'BlogPosting',
      'headline': article.title,
      'description': article.summary || '',
      'url': `${baseUrl}/news/${article.slug}`,
      'datePublished': article.published_at || article.created_at,
      'dateModified': article.updated_at,
      'image': article.featured_image || undefined,
      'author': {
        '@type': 'Person',
        'name': article.author?.full_name || 'Vcocnc',
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-800" />
          </div>
        }
      >
        <NewsPageClient initialData={serverData} searchParams={params} />
      </Suspense>
    </>
  );
}
