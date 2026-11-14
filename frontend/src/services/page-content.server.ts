import type { HomepageContent } from '@/types';
import { applyHomepageDrafts } from '@/lib/homepage-drafts.server';
import { PAGE_SECTION_KEYS, parsePageData, type EditablePage, type PageData } from '@/lib/page-content';

/**
 * Admin-edited copy for an editable page. Published pages are cached under the
 * "homepage-content" tag, which the backend revalidates on every save; the
 * admin preview reads fresh content with the editor's unsaved drafts applied.
 */
export async function getEditablePageData(page: EditablePage, options: { preview?: boolean } = {}): Promise<PageData> {
  const sectionKey = PAGE_SECTION_KEYS[page];
  const backendUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
  let content: HomepageContent | null = null;
  try {
    const res = await fetch(
      `${backendUrl}/api/v1/public/homepage-content/section/${sectionKey}`,
      options.preview
        ? { cache: 'no-store', signal: AbortSignal.timeout(8000) }
        : { next: { revalidate: 300, tags: ['homepage-content'] }, signal: AbortSignal.timeout(8000) },
    );
    if (res.ok) {
      // The section endpoint returns the record itself; its own `data` field holds the page copy.
      const json = await res.json();
      content = (json && typeof json === 'object' && 'section_key' in json ? json : json?.data) as HomepageContent;
    }
  } catch {
    // Without the backend (e.g. during the Docker build) the built-in copy is shown.
  }

  if (options.preview) {
    const merged = await applyHomepageDrafts(content ? [content] : []);
    content = merged.find((item) => item.section_key === sectionKey) ?? content;
  }
  return parsePageData(content);
}
