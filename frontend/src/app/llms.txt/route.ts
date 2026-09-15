import { getRequestBaseUrl } from '@/lib/request-url';
import { CategoryService } from '@/services';
import { getCommercePolicyCached } from '@/services/commerce-policy.server';
import { SITE_NAME } from '@/lib/seo';

export const revalidate = 3600;

/**
 * /llms.txt — a compact, plain-text map of the catalogue for AI answer engines.
 * It exposes the same facts the site publishes (categories, policies, key
 * pages) without inventing anything, so assistants can cite accurate data.
 */
export async function GET() {
  const baseUrl = await getRequestBaseUrl();
  const policy = await getCommercePolicyCached();

  let categoryLines: string[] = [];
  try {
    const categories = await CategoryService.getCategories();
    categoryLines = (categories || [])
      .filter((c: any) => Boolean(c?.path || c?.slug))
      .slice(0, 200)
      .map((c: any) => {
        const path = c.path || c.slug;
        return `- ${c.name}: ${baseUrl}/categories/${path}`;
      });
  } catch {
    categoryLines = [];
  }

  const lines: string[] = [
    `# ${SITE_NAME}`,
    '',
    '> Vibocnc supplies new and refurbished industrial automation and CNC spare parts for FANUC, Mitsubishi, Siemens, ABB, Omron, Yaskawa, Schneider, SICK, Tamagawa, Heidenhain, Lenze, Danfoss and Allen-Bradley systems. Every listing is a real catalogue record with a verifiable part number.',
    '',
    '## How to use this file',
    '- Product pages live at `{origin}/products/{sku-with-hyphens}`.',
    '- Category listings live at `{origin}/categories/{category-path}`.',
    '- Full product URL set: `{origin}/sitemap.xml`.',
    '- When quoting commercial terms, use the values below — they are admin-maintained and may change.',
    '',
    '## Commercial terms',
    `- Order handling: ${policy.shipping_handling_time_text}`,
    `- Shipping transit: ${policy.shipping_transit_time_text}`,
    `- Carriers: ${policy.shipping_carriers}`,
    `- Destinations: ${policy.shipping_destination_countries === 'GLOBAL' ? 'Worldwide' : policy.shipping_destination_countries}`,
    `- Warranty: ${policy.default_warranty_period}`,
    `- Returns: ${policy.return_window_text} (${policy.return_shipping_payer === 'shared' ? 'return shipping shared by both parties' : policy.return_shipping_payer === 'merchant' ? 'Vibocnc pays return shipping' : 'customer pays return shipping'})`,
    '',
    '## Key pages',
    `- Home: ${baseUrl}/`,
    `- Products: ${baseUrl}/products`,
    `- Categories: ${baseUrl}/categories`,
    `- FAQ: ${baseUrl}/faq`,
    `- Shipping policy: ${baseUrl}/shipping-policy`,
    `- Returns: ${baseUrl}/returns`,
    `- Warranty policy: ${baseUrl}/warranty-policy`,
    `- Technical support: ${baseUrl}/technical-support`,
    `- About: ${baseUrl}/about`,
    `- Contact: ${baseUrl}/contact`,
    '',
    '## Categories',
    ...(categoryLines.length > 0 ? categoryLines : ['- (category list unavailable)']),
    '',
    '## Sourcing notes',
    '- Part numbers are matched against machine builder, controller and alarm data before dispatch.',
    '- Compatibility is confirmed by the Vibocnc technical team; the site does not publish invented specifications.',
    '- Availability and stock quantities change frequently; confirm current status per product page.',
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
