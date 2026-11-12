import { cookies } from 'next/headers';
import type { HomepageContent } from '@/types';

type DraftItem = { section_key: string; payload: Partial<HomepageContent> | null };

const ADMIN_TOKEN_COOKIES = ['admin_token', 'auth_token'];

/**
 * Overlays the signed-in administrator's unsaved homepage edits onto the
 * published sections. Only the admin preview route calls this; without a valid
 * admin session the backend returns 401 and the published content is used.
 */
export async function applyHomepageDrafts(list: HomepageContent[]): Promise<HomepageContent[]> {
  const jar = await cookies();
  const token = ADMIN_TOKEN_COOKIES.map((name) => jar.get(name)?.value).find(Boolean);
  if (!token) return list;

  const backendUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';
  let drafts: DraftItem[] = [];
  try {
    const res = await fetch(`${backendUrl}/api/v1/admin/homepage-content/drafts`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return list;
    const json = await res.json();
    drafts = Array.isArray(json?.data) ? json.data : [];
  } catch {
    return list;
  }
  if (drafts.length === 0) return list;

  const byKey = new Map(list.map((c) => [c.section_key, c]));
  for (const draft of drafts) {
    if (!draft?.section_key || !draft.payload || typeof draft.payload !== 'object') continue;
    const existing = byKey.get(draft.section_key);
    const base = existing ?? ({
      id: 0,
      section_key: draft.section_key,
      title: '',
      subtitle: '',
      description: '',
      image_url: '',
      button_text: '',
      button_url: '',
      data: null,
      sort_order: 999,
      is_active: true,
      created_at: '',
      updated_at: '',
    } as unknown as HomepageContent);
    byKey.set(draft.section_key, { ...base, ...draft.payload, section_key: draft.section_key } as HomepageContent);
  }
  return Array.from(byKey.values());
}
