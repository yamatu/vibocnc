import { redirect } from 'next/navigation';

/**
 * The eBay market tools used to live on their own admin page.
 *
 * They are now a tab of the drafts hub, because a listing only makes sense in
 * one place: scraped, reviewed, priced and published. This redirect keeps the
 * old bookmark working instead of returning a 404.
 */
export default function EbayMarketPage() {
  redirect('/admin/ebay-import-drafts?tab=market');
}
