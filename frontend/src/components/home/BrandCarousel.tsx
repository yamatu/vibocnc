import Image from 'next/image';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { HomepageContent } from '@/types';
import { localizePublicPath, type PublicLocale } from '@/lib/i18n/config';
import {
  brandKey,
  bundledBrandLogo,
  normalizeBrandCarouselData,
  type CarouselBrand,
} from '@/lib/brand-logos';

const CANONICAL_BRAND_PATHS: Record<string, string> = {
  fanuc: '/categories/fanuc',
  mitsubishi: '/categories/mitsubishi',
  sick: '/categories/sick',
  tamagawa: '/categories/tamagawa',
  allenbradley: '/categories/ab',
  ab: '/categories/ab',
  huawei: '/categories/huawei',
};

function brandHref(brand: CarouselBrand): string {
  return brand.href || CANONICAL_BRAND_PATHS[brandKey(brand.name)] || `/products?brand=${encodeURIComponent(brand.name)}`;
}

function BrandTile({ brand, locale, grayscale, hidden }: { brand: CarouselBrand; locale: PublicLocale; grayscale: boolean; hidden?: boolean }) {
  const logo = brand.logo || bundledBrandLogo(brand.name);
  return (
    <li className="shrink-0" aria-hidden={hidden || undefined}>
      <Link
        href={localizePublicPath(brandHref(brand), locale)}
        tabIndex={hidden ? -1 : undefined}
        aria-label={`${brand.name} parts`}
        className={`brand-tile group flex h-20 w-40 items-center justify-center px-5 sm:h-24 sm:w-48 ${grayscale ? 'brand-tile-mono' : ''}`}
      >
        {logo ? (
          <Image
            src={logo}
            alt={`${brand.name} logo`}
            width={150}
            height={48}
            unoptimized
            loading="lazy"
            className="h-9 w-auto max-w-[128px] object-contain sm:h-11 sm:max-w-[150px]"
          />
        ) : (
          <span className="brand-tile-wordmark text-center text-lg font-black uppercase tracking-wide">
            {brand.name}
          </span>
        )}
      </Link>
    </li>
  );
}

function MarqueeRow({ brands, locale, grayscale, speed, reverse }: { brands: CarouselBrand[]; locale: PublicLocale; grayscale: boolean; speed: number; reverse?: boolean }) {
  return (
    <div className="brand-marquee" data-reverse={reverse ? 'true' : undefined} style={{ '--marquee-duration': `${speed}s` } as CSSProperties}>
      <ul className="brand-marquee-track">
        {brands.map((brand) => <BrandTile key={`a-${brand.name}`} brand={brand} locale={locale} grayscale={grayscale} />)}
        {brands.map((brand) => <BrandTile key={`b-${brand.name}`} brand={brand} locale={locale} grayscale={grayscale} hidden />)}
      </ul>
    </div>
  );
}

export default function BrandCarousel({ content, locale }: { content?: HomepageContent | null; locale: PublicLocale }) {
  const data = normalizeBrandCarouselData(content?.data);
  const title = content?.title || 'Brands We Supply';
  const subtitle = content?.subtitle
    || 'Genuine CNC, PLC, drive, servo and sensor parts from the world’s leading automation manufacturers.';
  const buttonText = content?.button_text || 'View all products';
  const buttonUrl = content?.button_url || '/products';
  const rows = data.rows === 2
    ? [data.brands.filter((_, i) => i % 2 === 0), data.brands.filter((_, i) => i % 2 === 1)]
    : [data.brands];

  return (
    <section aria-labelledby="brand-carousel-title" className="brand-carousel relative overflow-hidden py-10 sm:py-14">
      <div className="mx-auto mb-7 flex max-w-7xl flex-col gap-3 px-4 sm:mb-9 sm:flex-row sm:items-end sm:justify-between sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          {data.kicker ? (
            <p className="brand-carousel-kicker mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.16em]">
              {data.kicker}
            </p>
          ) : null}
          <h2 id="brand-carousel-title" className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base">{subtitle}</p>
        </div>
        <Link
          href={localizePublicPath(buttonUrl, locale)}
          className="brand-carousel-link inline-flex shrink-0 items-center gap-1.5 self-start rounded-full px-4 py-2 text-sm font-semibold transition sm:self-auto"
        >
          {buttonText}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className="space-y-4">
        {rows.map((row, index) => (
          <MarqueeRow key={index} brands={row} locale={locale} grayscale={data.grayscale} speed={data.speed} reverse={index === 1} />
        ))}
      </div>
    </section>
  );
}
