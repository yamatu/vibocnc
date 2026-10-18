'use client';

import Link from 'next/link';
import Image from 'next/image';
import type { HomepageContent } from '@/types';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';

function isBlankSection(content?: HomepageContent | null): boolean {
  if (!content) return true;
  const hasAnyText =
    Boolean(content.title?.trim()) ||
    Boolean(content.subtitle?.trim()) ||
    Boolean(content.description?.trim()) ||
    Boolean(content.button_text?.trim());
  const hasAnyMedia = Boolean(content.image_url?.trim());
  const rawData: any = (content as any).data;
  const hasAnyData =
    rawData != null &&
    (typeof rawData === 'string'
      ? rawData.trim() !== '' && rawData.trim() !== '{}' && rawData.trim() !== 'null'
      : typeof rawData === 'object'
        ? Object.keys(rawData || {}).length > 0
        : true);
  return !hasAnyText && !hasAnyMedia && !hasAnyData;
}

export default function SimpleContentSection({
  content,
}: {
  content?: HomepageContent | null;
}) {
  const { href } = usePublicI18n();
  if (!content) return null;
  if (content.is_active === false) return null;
  if (isBlankSection(content)) return null;

  const title = content.title || '';
  const subtitle = content.subtitle || '';
  const description = content.description || '';
  const imageUrl = content.image_url || '';
  const buttonText = content.button_text || '';
  const buttonUrl = content.button_url || '';

  return (
    <section className="home-deferred-section py-16 bg-white">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <div className="space-y-4">
            {subtitle ? (
              <p className="text-sm font-medium text-[#003a78] uppercase tracking-wide">{subtitle}</p>
            ) : null}
            {title ? (
              <h2 className="text-3xl lg:text-4xl font-bold text-slate-950">{title}</h2>
            ) : null}
            {description ? (
              <p className="text-slate-600 leading-relaxed whitespace-pre-line">{description}</p>
            ) : null}
            {buttonText && buttonUrl ? (
              <div className="pt-2">
                <Link
                  href={href(buttonUrl)}
                  className="inline-flex items-center px-6 py-3 bg-[#003a78] text-white font-semibold rounded-md hover:bg-orange-600 transition-colors"
                >
                  {buttonText}
                </Link>
              </div>
            ) : null}
          </div>

          {imageUrl ? (
            <div className="relative w-full aspect-[16/10] rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
              <Image
                src={imageUrl}
                alt={title || 'section image'}
                width={1280}
                height={800}
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="h-full w-full object-cover"
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
