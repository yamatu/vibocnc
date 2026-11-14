import type { HomepageContent } from '@/types';

// About/Contact copy is stored as homepage_contents rows so the homepage visual
// editor's save, draft and preview pipeline works for these pages unchanged.
export const PAGE_SECTION_KEYS = { about: 'about_page', contact: 'contact_page' } as const;
export type EditablePage = keyof typeof PAGE_SECTION_KEYS;
export const EDITABLE_PAGE_SECTION_KEYS: ReadonlySet<string> = new Set(Object.values(PAGE_SECTION_KEYS));

export function isEditablePage(value: string): value is EditablePage {
  return Object.prototype.hasOwnProperty.call(PAGE_SECTION_KEYS, value);
}

export type PageFieldType = 'text' | 'textarea' | 'image';

export type PageField = {
  key: string;
  type: PageFieldType;
  zh: string;
  en: string;
  /** Built-in English content used while the admin leaves the field empty. */
  fallback: string;
  /**
   * Translation key for non-English pages. Admin text replaces the English
   * page only (the homepage editor follows the same rule); fields without a
   * key (images, phone, email, address) apply to every language.
   */
  i18nKey?: string;
  hint?: { zh: string; en: string };
};

export type PageGroup = { zh: string; en: string; fields: PageField[] };

export type PageSchema = {
  page: EditablePage;
  sectionKey: string;
  path: string;
  zh: string;
  en: string;
  groups: PageGroup[];
};

export type PageData = Record<string, string>;

export function parsePageData(content?: Pick<HomepageContent, 'data'> | null): PageData {
  const raw = content?.data;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: PageData = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}

export function schemaFields(schema: PageSchema): PageField[] {
  return schema.groups.flatMap((group) => group.fields);
}

/**
 * Returns a reader for one page: `text('heroTitle')` yields the admin value,
 * the page translation, or the built-in default, in that order of precedence
 * (see PageField.i18nKey for the language rule).
 */
export function createPageText(
  schema: PageSchema,
  data: PageData,
  locale: string = 'en',
  translate?: (key: string) => string,
): (key: string) => string {
  const fields = new Map(schemaFields(schema).map((field) => [field.key, field]));
  return (key: string) => {
    const field = fields.get(key);
    if (!field) return '';
    if (field.i18nKey && translate && locale !== 'en') {
      const translated = translate(field.i18nKey);
      if (translated && translated !== field.i18nKey) return translated;
    }
    return data[key] || field.fallback;
  };
}
