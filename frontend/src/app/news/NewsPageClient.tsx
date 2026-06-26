'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MagnifyingGlassIcon, NewspaperIcon, CalendarDaysIcon, EyeIcon } from '@heroicons/react/24/outline';
import Layout from '@/components/layout/Layout';
import SmartPagination from '@/components/ui/SmartPagination';
import type { Article } from '@/types';

interface NewsPageClientProps {
  initialData: {
    articles: Article[];
    totalPages: number;
    total: number;
    currentPage: number;
    searchQuery: string;
  };
  searchParams: { [key: string]: string | string[] | undefined };
}

function markdownToExcerpt(md: string, maxLen = 160): string {
  let text = md;
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/#{1,6}\s*/g, '');
  text = text.replace(/\*\*(.+?)\*\*/g, '$1');
  text = text.replace(/\*(.+?)\*/g, '$1');
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/\n+/g, ' ').trim();
  if (text.length > maxLen) text = text.substring(0, maxLen) + '...';
  return text;
}

export default function NewsPageClient({ initialData, searchParams }: NewsPageClientProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState(initialData.searchQuery);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set('search', searchQuery.trim());
    params.set('page', '1');
    router.push(`/news?${params.toString()}`);
  };

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams();
    if (initialData.searchQuery) params.set('search', initialData.searchQuery);
    params.set('page', String(page));
    router.push(`/news?${params.toString()}`);
  };

  const featuredArticles = initialData.articles.filter((a) => a.is_featured);
  const regularArticles = initialData.articles.filter((a) => !a.is_featured);

  return (
    <Layout>
      <div className="site-page-shell min-h-screen">
        {/* Hero Header */}
        <div className="site-page-hero">
          <div className="site-hero-inner max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
            <div className="text-center">
              <span className="site-hero-kicker">Insights library</span>
              <h1 className="mt-5 text-3xl sm:text-4xl font-bold mb-4">News & Articles</h1>
              <p className="text-blue-100 text-lg max-w-2xl mx-auto mb-8">
                Latest insights, technical guides, and industry news about industrial automation and CNC equipment.
              </p>

              {/* Search */}
              <form onSubmit={handleSearch} className="max-w-xl mx-auto">
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search articles..."
                    className="site-input w-full pl-12 pr-4 py-3 bg-white text-gray-900 text-sm"
                  />
                </div>
              </form>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          {/* Search results info */}
          {initialData.searchQuery && (
            <div className="mb-6 flex items-center justify-between">
              <p className="text-gray-600">
                {initialData.total} result{initialData.total !== 1 ? 's' : ''} for &quot;{initialData.searchQuery}&quot;
              </p>
              <button
                onClick={() => router.push('/news')}
                className="text-sm text-blue-600 hover:underline"
              >
                Clear search
              </button>
            </div>
          )}

          {initialData.articles.length === 0 ? (
            <div className="text-center py-16">
              <NewspaperIcon className="h-16 w-16 mx-auto text-gray-300 mb-4" />
              <h2 className="text-xl font-semibold text-gray-600 mb-2">No articles found</h2>
              <p className="text-gray-500">Check back later for new content.</p>
            </div>
          ) : (
            <>
              {/* Featured Articles */}
              {!initialData.searchQuery && initialData.currentPage === 1 && featuredArticles.length > 0 && (
                <div className="mb-12">
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">Featured</h2>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {featuredArticles.slice(0, 2).map((article) => (
                      <Link
                        key={article.id}
                        href={`/news/${article.slug}`}
                        className="group site-product-card block"
                      >
                        {article.featured_image ? (
                          <div className="aspect-[16/9] overflow-hidden">
                            <img
                              src={article.featured_image}
                              alt={article.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          </div>
                        ) : (
                          <div className="aspect-[16/9] bg-gradient-to-br from-blue-100 to-blue-50 flex items-center justify-center">
                            <NewspaperIcon className="h-16 w-16 text-blue-300" />
                          </div>
                        )}
                        <div className="p-6">
                          <h3 className="text-xl font-bold text-gray-900 group-hover:text-blue-800 transition-colors mb-2 line-clamp-2">
                            {article.title}
                          </h3>
                          <p className="text-gray-600 text-sm line-clamp-3 mb-4">
                            {article.summary || markdownToExcerpt(article.content)}
                          </p>
                          <div className="flex items-center gap-4 text-xs text-gray-400">
                            <span className="flex items-center gap-1">
                              <CalendarDaysIcon className="h-4 w-4" />
                              {new Date(article.published_at || article.created_at).toLocaleDateString()}
                            </span>
                            <span className="flex items-center gap-1">
                              <EyeIcon className="h-4 w-4" />
                              {article.view_count} views
                            </span>
                            {article.author?.full_name && (
                              <span>By {article.author.full_name}</span>
                            )}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Article Grid */}
              <div>
                {!initialData.searchQuery && regularArticles.length > 0 && featuredArticles.length > 0 && (
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">Latest Articles</h2>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {(initialData.searchQuery ? initialData.articles : regularArticles).map((article) => (
                    <Link
                      key={article.id}
                      href={`/news/${article.slug}`}
                      className="group site-product-card flex flex-col"
                    >
                      {article.featured_image ? (
                        <div className="aspect-[16/10] overflow-hidden">
                          <img
                            src={article.featured_image}
                            alt={article.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                      ) : (
                        <div className="aspect-[16/10] bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center">
                          <NewspaperIcon className="h-12 w-12 text-gray-300" />
                        </div>
                      )}
                      <div className="p-5 flex-1 flex flex-col">
                        <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-800 transition-colors mb-2 line-clamp-2">
                          {article.title}
                        </h3>
                        <p className="text-gray-600 text-sm line-clamp-3 mb-4 flex-1">
                          {article.summary || markdownToExcerpt(article.content)}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                          <span className="flex items-center gap-1">
                            <CalendarDaysIcon className="h-3.5 w-3.5" />
                            {new Date(article.published_at || article.created_at).toLocaleDateString()}
                          </span>
                          <span className="flex items-center gap-1">
                            <EyeIcon className="h-3.5 w-3.5" />
                            {article.view_count}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Pagination */}
              {initialData.totalPages > 1 && (
                <div className="mt-10 flex justify-center">
                  <SmartPagination
                    currentPage={initialData.currentPage}
                    totalPages={initialData.totalPages}
                    onPageChange={handlePageChange}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
