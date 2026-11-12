export type CarouselBrand = { name: string; logo?: string; href?: string };

export type BrandCarouselData = {
  brands: CarouselBrand[];
  speed: number;
  rows: 1 | 2;
  grayscale: boolean;
  kicker: string;
};

// Bundled logos (official marks from Wikimedia Commons). An administrator can
// replace any of them with an uploaded image from the homepage editor.
const BUNDLED_LOGOS: Record<string, string> = {
  fanuc: '/images/brands/fanuc.svg',
  siemens: '/images/brands/siemens.svg',
  allenbradley: '/images/brands/allen-bradley.svg',
  ab: '/images/brands/allen-bradley.svg',
  abb: '/images/brands/abb.svg',
  sick: '/images/brands/sick.svg',
  mitsubishi: '/images/brands/mitsubishi.svg',
  mitsubishielectric: '/images/brands/mitsubishi.svg',
  omron: '/images/brands/omron.svg',
  yaskawa: '/images/brands/yaskawa.svg',
  schneider: '/images/brands/schneider.svg',
  schneiderelectric: '/images/brands/schneider.svg',
  keyence: '/images/brands/keyence.svg',
  panasonic: '/images/brands/panasonic.svg',
  heidenhain: '/images/brands/heidenhain.svg',
  boschrexroth: '/images/brands/bosch-rexroth.svg',
  rexroth: '/images/brands/bosch-rexroth.svg',
  delta: '/images/brands/delta.svg',
  fluke: '/images/brands/fluke.svg',
  lenze: '/images/brands/lenze.svg',
  danfoss: '/images/brands/danfoss.svg',
};

export function brandKey(name: string): string {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function bundledBrandLogo(name: string): string | undefined {
  return BUNDLED_LOGOS[brandKey(name)];
}

export const DEFAULT_CAROUSEL_BRANDS: CarouselBrand[] = [
  'FANUC', 'Siemens', 'Allen-Bradley', 'ABB', 'SICK', 'Mitsubishi', 'Omron', 'Yaskawa', 'Schneider',
  'Keyence', 'Panasonic', 'Heidenhain', 'Bosch Rexroth', 'Delta', 'Fluke', 'Lenze', 'Danfoss',
].map((name) => ({ name }));

export const DEFAULT_BRAND_CAROUSEL_DATA: BrandCarouselData = {
  brands: DEFAULT_CAROUSEL_BRANDS,
  speed: 45,
  rows: 1,
  grayscale: true,
  kicker: 'Multi-brand supply',
};

function parseRecord(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

export function normalizeBrandCarouselData(raw: unknown): BrandCarouselData {
  const data = parseRecord(raw);
  const brands = Array.isArray(data.brands)
    ? (data.brands as unknown[])
        .map((item) => {
          const b = item as Record<string, unknown>;
          return {
            name: String(b?.name || '').trim(),
            logo: String(b?.logo || '').trim() || undefined,
            href: String(b?.href || '').trim() || undefined,
          };
        })
        .filter((b) => b.name)
    : [];
  const speed = Number(data.speed);
  return {
    brands: brands.length > 0 ? brands : DEFAULT_CAROUSEL_BRANDS,
    speed: Number.isFinite(speed) && speed >= 10 && speed <= 200 ? speed : DEFAULT_BRAND_CAROUSEL_DATA.speed,
    rows: Number(data.rows) === 2 ? 2 : 1,
    grayscale: data.grayscale === undefined ? true : Boolean(data.grayscale),
    kicker: typeof data.kicker === 'string' ? data.kicker : DEFAULT_BRAND_CAROUSEL_DATA.kicker,
  };
}
