import { NextRequest, NextResponse } from 'next/server';
import { getRequestBaseUrl } from '@/lib/request-url';

export const dynamic = 'force-dynamic';
export const revalidate = 1800;

function getBackendBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
}

export async function GET(request: NextRequest) {
  const baseUrl = await getRequestBaseUrl();
  const qs = new URLSearchParams();
  qs.set('base_url', baseUrl);
  const country = request.nextUrl.searchParams.get('country');
  if (country && country.trim()) qs.set('country', country.trim());
  const limit = request.nextUrl.searchParams.get('limit');
  if (limit && limit.trim()) qs.set('limit', limit.trim());

  try {
    const upstream = await fetch(`${getBackendBaseUrl()}/api/v1/public/merchant/feed.xml?${qs.toString()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/xml, text/xml' },
    });
    if (!upstream.ok) return new NextResponse('Unable to generate merchant feed', { status: 502 });
    const xml = await upstream.text();
    const headers: Record<string, string> = {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=1800, s-maxage=1800',
    };
    const itemCount = upstream.headers.get('x-merchant-items');
    if (itemCount) headers['X-Merchant-Items'] = itemCount;
    return new NextResponse(xml, { status: 200, headers });
  } catch (error) {
    console.error('Error proxying merchant feed:', error);
    return new NextResponse('Error generating merchant feed', { status: 500 });
  }
}
