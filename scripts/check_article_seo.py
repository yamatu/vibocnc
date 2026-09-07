#!/usr/bin/env python3
"""Audit published article HTML without JavaScript or third-party dependencies.

Usage: python scripts/check_article_seo.py [origin] [--limit N]
Canonical URLs are expected to use https://vibocnc.com by default.
"""
import argparse
import json
import os
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class ArticleHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta = {}
        self.links = []
        self.hrefs = []
        self.h1_count = 0
        self.article_depth = 0
        self.article_text = []
        self.schema_text = None
        self.schemas = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta':
            self.meta.setdefault(attrs.get('name', '').lower(), []).append(attrs.get('content', ''))
        if tag == 'link':
            self.links.append(attrs)
        if tag == 'a':
            self.hrefs.append(attrs.get('href', ''))
        if tag == 'h1':
            self.h1_count += 1
        if tag == 'article':
            self.article_depth += 1
        if tag == 'script' and attrs.get('type') == 'application/ld+json':
            self.schema_text = []

    def handle_endtag(self, tag):
        if tag == 'article':
            self.article_depth -= 1
        if tag == 'script' and self.schema_text is not None:
            self.schemas.append(json.loads(''.join(self.schema_text)))
            self.schema_text = None

    def handle_data(self, data):
        if self.article_depth:
            self.article_text.append(data)
        if self.schema_text is not None:
            self.schema_text.append(data)


def fetch(url):
    request = Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'})
    with urlopen(request, timeout=60) as response:
        return response.read(), response.headers, response.url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('origin', nargs='?', default='https://vibocnc.com')
    parser.add_argument('--limit', type=int, default=0, help='Maximum articles per sitemap; 0 audits all')
    args = parser.parse_args()
    origin = args.origin.rstrip('/')
    canonical_origin = os.environ.get('SEO_CANONICAL_ORIGIN', 'https://vibocnc.com').rstrip('/')
    namespace = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    failures = 0
    for kind, schema_type in [('blog', 'BlogPosting'), ('news', 'NewsArticle')]:
        try:
            xml, _, _ = fetch(origin + '/sitemap-' + kind + '.xml')
            locations = [node.text for node in ET.fromstring(xml).findall('s:url/s:loc', namespace)]
            article_urls = [url for url in locations if urlsplit(url).path.startswith('/' + kind + '/')]
            if not article_urls:
                raise ValueError('sitemap has no English article URLs')
            if len(locations) != len(set(locations)):
                raise ValueError('sitemap contains duplicate URLs')
            print(f'PASS /sitemap-{kind}.xml: {len(article_urls)} English articles', flush=True)
        except Exception as error:
            print(f'FAIL /sitemap-{kind}.xml: {error}', flush=True)
            failures += 1
            continue

        try:
            first, _, _ = fetch(origin + '/api/v1/public/news?content_type=' + kind + '&page_size=12')
            pagination = json.loads(first)['data']
            for page in range(1, max(1, pagination['total_pages']) + 1):
                page_path = '/' + kind + (f'?page={page}' if page > 1 else '')
                if page == 1:
                    expected = pagination['data']
                else:
                    payload, _, _ = fetch(origin + f'/api/v1/public/news?content_type={kind}&page_size=12&page={page}')
                    expected = json.loads(payload)['data']['data']
                html, _, _ = fetch(origin + page_path)
                document = ArticleHTML()
                document.feed(html.decode('utf-8'))
                paths = [urlsplit(href).path for href in document.hrefs]
                for article in expected:
                    expected_path = article.get('public_path') or f"/{kind}/{article['slug']}"
                    if expected_path not in paths:
                        raise ValueError(f'{page_path} omits published article {expected_path}')
                if page < pagination['total_pages'] and f'/{kind}?page={page + 1}' not in document.hrefs:
                    raise ValueError(f'{page_path} has no crawlable next-page link')
                print(f'PASS {page_path}: all {len(expected)} articles linked, pagination discoverable', flush=True)
        except Exception as error:
            print(f'FAIL /{kind} discovery: {error}', flush=True)
            failures += 1

        for article_url in article_urls[:args.limit or None]:
            path = urlsplit(article_url).path
            try:
                html, headers, final_url = fetch(origin + path)
                document = ArticleHTML()
                document.feed(html.decode('utf-8'))
                errors = []
                robots = ','.join(document.meta.get('robots', []) + [headers.get('X-Robots-Tag', '')]).lower()
                canonical = [link.get('href') for link in document.links if link.get('rel') == 'canonical']
                if urlsplit(final_url).path != path:
                    errors.append('article redirected to a different path')
                if 'noindex' in robots or 'nofollow' in robots:
                    errors.append('article blocks indexing or link following')
                if canonical != [canonical_origin + path]:
                    errors.append('missing, duplicate or incorrect canonical')
                if document.h1_count != 1:
                    errors.append(f'expected one H1, got {document.h1_count}')
                if len(' '.join(document.article_text).strip()) < 100:
                    errors.append('article body missing from server HTML')
                if not any(node.get('@type') == schema_type for node in document.schemas):
                    errors.append('missing article structured data')
                if not any(node.get('@type') == 'BreadcrumbList' for node in document.schemas):
                    errors.append('missing breadcrumb structured data')
                if not document.meta.get('description', [''])[0].strip():
                    errors.append('missing description')
                if not any('/' + kind + '/' in href and path != urlsplit(href).path for href in document.hrefs):
                    errors.append('no related article links')
                if errors:
                    raise ValueError('; '.join(errors))
                print(f'PASS {path}: body, H1, canonical, robots, schema, internal links', flush=True)
            except Exception as error:
                print(f'FAIL {path}: {error}', flush=True)
                failures += 1
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
