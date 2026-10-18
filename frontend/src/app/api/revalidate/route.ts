import { revalidatePath, revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { PUBLIC_LOCALES, stripLocaleFromPathname } from '@/lib/i18n/config';

// Public pages are cached under /{locale}{path} (see middleware) while the
// backend sends unprefixed public paths, so purge every locale variant.
function revalidatePublicPath(path: string) {
  if (!path.startsWith('/') || path.startsWith('/admin') || path.startsWith('/api/') || /^\/[^/]+\.[a-z0-9]+$/i.test(path)) {
    revalidatePath(path);
    return;
  }
  const publicPath = stripLocaleFromPathname(path);
  for (const { code } of PUBLIC_LOCALES) {
    revalidatePath(`/${code}${publicPath === '/' ? '' : publicPath}`);
  }
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get('X-Revalidate-Secret');
  if (secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
  }

  try {
    const { path, tag } = await request.json();

    if (typeof path === 'string' && path) revalidatePublicPath(path);
    if (tag) revalidateTag(tag);

    return NextResponse.json({ revalidated: true, path, tag });
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}
