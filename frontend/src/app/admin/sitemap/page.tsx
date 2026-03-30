'use client';

import { useState, useEffect } from 'react';
import { ProductService } from '@/services/product.service';
import AdminLayout from '@/components/admin/AdminLayout';
import { getSiteUrl } from '@/lib/url';
import { useAdminI18n } from '@/lib/admin-i18n';

export default function SitemapManagementPage() {
  const { t } = useAdminI18n();
  const [stats, setStats] = useState({
    totalProducts: 0,
    totalSitemaps: 0,
    productsPerSitemap: 100,
    lastUpdated: '',
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSitemapStats();
  }, []);

  const fetchSitemapStats = async () => {
    try {
      setLoading(true);
      const response = await ProductService.getProducts({
        page: 1,
        page_size: 1,
        is_active: 'true'
      });
      
      const totalProducts = response.total || 0;
      const totalSitemaps = Math.ceil(totalProducts / 100);
      
      setStats({
        totalProducts,
        totalSitemaps,
        productsPerSitemap: 100,
        lastUpdated: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error fetching sitemap stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const baseUrl = getSiteUrl();

  const sitemapUrls = [
    { name: 'Sitemap Index', url: `${baseUrl}/sitemap-index.xml`, description: 'Primary sitemap submission URL' },
    { name: 'Main Sitemap', url: `${baseUrl}/sitemap.xml`, description: 'MetadataRoute summary sitemap' },
    { name: 'Static Pages', url: `${baseUrl}/sitemap-static.xml`, description: 'All static pages' },
    { name: 'Categories', url: `${baseUrl}/sitemap-categories.xml`, description: 'All category pages' },
    { name: 'Products Index', url: `${baseUrl}/sitemap-products-index.xml`, description: 'Product sitemap index' },
    { name: 'News & Articles', url: `${baseUrl}/sitemap-news.xml`, description: 'All published articles' },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">{t('sitemap.title', 'Sitemap Management')}</h1>
            <button
              onClick={fetchSitemapStats}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
            >
              {loading ? t('sitemap.refreshing', 'Refreshing...') : t('sitemap.refresh', 'Refresh Stats')}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
                      <span className="text-white text-sm font-bold">P</span>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
	                    <dl>
	                      <dt className="text-sm font-medium text-gray-500 truncate">{t('sitemap.stats.totalProducts', 'Total Products')}</dt>
	                      <dd className="text-lg font-medium text-gray-900">{stats.totalProducts.toLocaleString()}</dd>
	                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-green-500 rounded-md flex items-center justify-center">
                      <span className="text-white text-sm font-bold">S</span>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
	                    <dl>
	                      <dt className="text-sm font-medium text-gray-500 truncate">{t('sitemap.stats.productSitemaps', 'Product Sitemaps')}</dt>
	                      <dd className="text-lg font-medium text-gray-900">{stats.totalSitemaps}</dd>
	                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-yellow-500 rounded-md flex items-center justify-center">
                      <span className="text-white text-sm font-bold">L</span>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
	                    <dl>
	                      <dt className="text-sm font-medium text-gray-500 truncate">{t('sitemap.stats.perSitemap', 'Per Sitemap')}</dt>
	                      <dd className="text-lg font-medium text-gray-900">{stats.productsPerSitemap.toLocaleString()}</dd>
	                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-purple-500 rounded-md flex items-center justify-center">
                      <span className="text-white text-sm font-bold">T</span>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
	                    <dl>
	                      <dt className="text-sm font-medium text-gray-500 truncate">{t('sitemap.stats.lastUpdated', 'Last Updated')}</dt>
	                      <dd className="text-sm font-medium text-gray-900">
	                        {stats.lastUpdated ? new Date(stats.lastUpdated).toLocaleString() : t('common.loading', 'Loading...')}
	                      </dd>
	                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">{t('sitemap.urls.title', 'Sitemap URLs')}</h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">
                {t('sitemap.urls.subtitle', 'All available sitemap files for your website')}
              </p>
            </div>
            <ul className="divide-y divide-gray-200">
              {sitemapUrls.map((sitemap, index) => (
                <li key={index}>
                  <div className="px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                          <span className="text-gray-600 text-sm font-medium">XML</span>
                        </div>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{sitemap.name}</div>
                        <div className="text-sm text-gray-500">{sitemap.description}</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <a
                        href={sitemap.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-500 text-sm font-medium"
                      >
                        {t('sitemap.view', 'View')}
                      </a>
                      <button
                        onClick={() => navigator.clipboard.writeText(sitemap.url)}
                        className="text-gray-400 hover:text-gray-500 text-sm font-medium"
                      >
                        {t('sitemap.copy', 'Copy URL')}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-blue-800">{t('sitemap.instructions.title', 'SEO Instructions')}</h3>
                <div className="mt-2 text-sm text-blue-700">
                  <ul className="list-disc list-inside space-y-1">
                    <li>{t('sitemap.instructions.1', 'Submit sitemap-index.xml to Google Search Console and Bing Webmaster Tools')}</li>
                    <li>{t('sitemap.instructions.2', 'Sitemaps are automatically updated every 30 minutes')}</li>
                    <li>{t('sitemap.instructions.3', 'Each product sitemap contains up to 100 products')}</li>
                    <li>{t('sitemap.instructions.4', 'New products are automatically included in sitemaps')}</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
    </AdminLayout>
  );
}
