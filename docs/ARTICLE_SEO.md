# Article SEO Verification

## Confirmed defects

- The listing selected every featured article out of the regular grid but rendered only two featured articles on page one. Extra featured articles and featured articles on later pages had no visible links.
- Pagination used buttons without crawlable URLs.
- Article metadata and page rendering fetched the same article separately and converted every API failure into missing-content/noindex behavior. The public API also returned 404 for database failures.
- Article sitemaps returned cacheable HTTP 200 listing-only documents when article retrieval failed.
- Markdown article titles generated a second H1 below the page title.

The fix preserves published content, existing URLs, the admin UI and database schema. It also keeps English news/blog URLs stable regardless of browser language, links untranslated articles to their English URLs, enables large image previews, and treats out-of-range archive pages as missing pages.

## Checks

From the repository root, with frontend dependencies installed:

```sh
node scripts/check_article_seo_helpers.cjs
python scripts/check_article_seo.py http://127.0.0.1:3000
python scripts/check_article_seo.py https://vibocnc.com
```

The Python audit uses only the standard library. It compares each archive page with the public API, checks pagination links, then checks English article URLs from both sitemaps for server-rendered content, one H1, canonical URLs, robots directives, structured data and related links. `--limit 2` limits detail checks per sitemap while retaining archive coverage. Set `SEO_CANONICAL_ORIGIN` to test another canonical domain.

The helper checks cover featured overflow, later pages, search results, pagination anchors, article 404 versus outage handling, and non-cacheable sitemap failures. Error messages about an unavailable database are expected in the simulated sitemap outage tests.

Backend check:

```sh
cd backend
go test ./controllers -run 'Test(ArticleRead|NormalizeContentType|GetArticlePublicPath|DefaultArticleCustomPath|IsGeneratedArticleCustomPath)' -count=1
```

## Validation on 2026-09-08

- Production frontend build succeeded using the public API as its read-only data source.
- Changed frontend files passed ESLint with zero errors and three existing image warnings.
- TypeScript diagnostics compared with HEAD: 44 existing errors before and after; no additional diagnostics. The repository already disables build-time type and lint validation, so build success does not mean a clean global type check.
- All 13 English blog articles and 11 English news articles passed the local production HTML audit.
- Blog page one linked all 12 returned articles, page two linked its remaining article, and news linked all 11 returned articles.
- Desktop/mobile browser navigation and pagination passed with no page exceptions; article images loaded and the mobile page had no horizontal overflow.
- Missing article URLs and archive page 9999 returned HTTP 404 with noindex.
- The same audit against the unchanged live site reproduced missing archive links and duplicate H1 elements.

## Release and indexing

Both frontend and backend need deployment. No schema migration or article-content rewrite is required. Use the existing server checkout and deployment configuration, retain the previous images for rollback, rebuild the two application services, and leave database/storage services intact. Invalidate cached news/blog listing pages, affected article pages and the two article sitemaps through the existing cache controls, then rerun the public audit.

At handoff, SSH to the supplied server did not complete its protocol handshake, so no server files or services were modified. GitHub build/revalidation workflows do not deploy the application containers.

After deployment, submit `/sitemap.xml` in Google Search Console and use URL Inspection on representative detail URLs. The article child sitemaps are already referenced by the primary index. This work improves discovery and technical indexability; confirming Google's exclusion reason and subsequent indexing requires Search Console access.
