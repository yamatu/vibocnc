const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const frontendRequire = createRequire(path.resolve(__dirname, '../frontend/package.json'));
const ts = frontendRequire('typescript');
const React = frontendRequire('react');
const { renderToStaticMarkup } = frontendRequire('react-dom/server');

function load(relativePath, mocks) {
  const filename = path.resolve(__dirname, '../frontend/src', relativePath);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : frontendRequire(name),
    console, URLSearchParams, Set,
  }, { filename });
  return module.exports;
}

async function main() {
  const missing = new Error('NEXT_NOT_FOUND');
  let apiError;
  const article = { id: 1, title: 'Test article' };
  const request = async () => { if (apiError) throw apiError; return article; };
  const server = load('services/news.server.ts', {
    react: { cache: fn => fn },
    'next/navigation': { notFound: () => { throw missing; } },
    './news.service': { NewsService: { getArticleBySlug: request, getArticleByPath: request } },
  });
  for (const fetchArticle of [() => server.getArticleBySlug('test', 'news'), () => server.getArticleByPath('guides/test')]) {
    apiError = undefined;
    assert.equal(await fetchArticle(), article);
    apiError = { isAxiosError: true, response: { status: 404 } };
    await assert.rejects(fetchArticle, error => error === missing);
    for (const failure of [{ isAxiosError: true, response: { status: 503 } }, new Error('ECONNRESET')]) {
      apiError = failure;
      await assert.rejects(fetchArticle, error => error === failure);
    }
  }
  console.log('PASS article loading distinguishes missing content from outages');

  for (const kind of ['news', 'blog']) {
    const route = load(`app/sitemap-${kind}.xml/route.ts`, {
      'next/server': { NextResponse: Response },
      '@/lib/request-url': { getRequestBaseUrl: async () => 'https://vibocnc.com' },
      '@/lib/article-sitemap': { getAllPublishedArticles: async () => { throw new Error('database unavailable'); } },
      '@/lib/i18n/sitemap': { renderLocalizedSitemap: () => '<urlset/>' },
      '@/lib/i18n/content': { getAvailableTranslationLocales: () => ['en'] },
      '@/lib/i18n/config': { PUBLIC_LOCALES: [{ code: 'en' }] },
    });
    const response = await route.GET();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('retry-after'), '300');
  }
  console.log('PASS sitemap outages return non-cacheable 503 responses');

  const Link = ({ href, children, className, ...props }) => React.createElement('a', { href, className, 'aria-current': props['aria-current'] }, children);
  const Pagination = load('components/ui/SmartPagination.tsx', { 'next/link': Link }).default;
  const NewsPage = load('app/news/NewsPageClient.tsx', {
    'next/link': Link,
    'next/navigation': { useRouter: () => ({ push() {} }) },
    '@/components/layout/Layout': ({ children }) => children,
    '@/components/ui/SmartPagination': Pagination,
    '@/lib/i18n/PublicI18nProvider': { usePublicI18n: () => ({ locale: 'en', t: key => key, href: value => value }) },
    '@/lib/i18n/content': { hasTranslationForLocale: () => true },
  }).default;
  const articles = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1, slug: `article-${index}`, title: `Article ${index}`, content: 'Article body',
    is_featured: index < 6, content_type: 'blog', created_at: '2026-01-01T00:00:00Z', view_count: 0,
  }));
  for (const [page, search] of [[1, ''], [2, ''], [1, 'servo']]) {
    const html = renderToStaticMarkup(React.createElement(NewsPage, {
      initialData: { articles, totalPages: 3, total: 36, currentPage: page, searchQuery: search },
      searchParams: {}, contentType: 'blog',
    }));
    for (const article of articles) {
      assert.equal(html.split(`href="/blog/${article.slug}"`).length - 1, 1, `article must appear once: ${article.slug}, page ${page}, search ${search}`);
    }
    assert.ok(html.includes(search ? '/blog?search=servo&amp;page=2' : `/blog?page=${page + 1}`));
  }
  console.log('PASS featured overflow, later pages, search results and crawlable pagination');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
