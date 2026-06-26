function isLocalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(host);
}

export function normalizeSiteUrl(input?: string | null): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;

  // If protocol already present, accept as-is.
  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/\/+$/, '');
  }

  // If user only provided host[:port], choose protocol.
  const host = raw.split('/')[0];
  const protocol = isLocalHost(host.split(':')[0]) ? 'http' : 'https';
  return `${protocol}://${raw}`.replace(/\/+$/, '');
}

export function getSiteUrl(): string {
  // Prefer a server-only env var to avoid Next.js inlining NEXT_PUBLIC_* at build time.
  const raw = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  return normalizeSiteUrl(raw) || 'https://www.vibocnc.com';
}
