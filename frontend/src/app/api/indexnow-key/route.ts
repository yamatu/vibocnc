import { NextRequest, NextResponse } from 'next/server';
function getBackendBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://backend:8080').replace(/\/+$/, '');
}

export async function GET(request: NextRequest) {
  const key = String(request.nextUrl.searchParams.get('key') || '').trim();
  if (!key) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const backendUrl = `${getBackendBaseUrl()}/api/v1/public/indexnow/key`;

  try {
    const res = await fetch(backendUrl, { cache: 'no-store' });
    if (!res.ok) {
      return new NextResponse('Not Found', { status: 404 });
    }
    const json = await res.json();
    const configuredKey = String(json?.data?.key || '').trim();
    if (!configuredKey || configuredKey !== key) {
      return new NextResponse('Not Found', { status: 404 });
    }
    return new NextResponse(configuredKey, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }
}
