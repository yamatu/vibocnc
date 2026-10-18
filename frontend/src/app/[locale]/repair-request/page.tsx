import type { Metadata } from 'next';
import PublicLayout from '@/components/layout/PublicLayout';
import RepairRequestForm from '@/components/repair/RepairRequestForm';
import { getLocalizedMetadataPaths, resolveRouteLocale, type LocaleRouteParams } from '@/lib/i18n/server';
import { localizePublicPath } from '@/lib/i18n/config';
import { getRepairPageCopy } from '@/lib/i18n/repair';
import { getSiteUrl } from '@/lib/url';
import { withSiteName } from '@/lib/seo';

export async function generateMetadata({ params }: { params: LocaleRouteParams }): Promise<Metadata> {
  const { locale, canonical, languages } = await getLocalizedMetadataPaths(await resolveRouteLocale(params), '/repair-request');
  const copy = getRepairPageCopy(locale);
  const title = copy.title;
  const description = copy.description;
  return {
    title,
    description,
    keywords: 'industrial electronics repair, automation repair service, servo drive repair, HMI repair, PLC repair, CNC board repair',
    alternates: { canonical, languages },
    openGraph: { title: withSiteName(title), description, type: 'website', url: canonical },
  };
}

export default async function RepairRequestPage({ params }: { params: LocaleRouteParams }) {
  const baseUrl = getSiteUrl();
  const locale = await resolveRouteLocale(params);
  const copy = getRepairPageCopy(locale);
  const localizedUrl = `${baseUrl}${localizePublicPath('/repair-request', locale)}`;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'Industrial Automation Parts Repair Evaluation',
    serviceType: 'Industrial electronics repair and replacement evaluation',
    provider: { '@type': 'Organization', '@id': `${baseUrl}/#organization`, name: 'Vibocnc' },
    areaServed: 'Worldwide',
    url: localizedUrl,
    description: copy.description,
  };
  return <PublicLayout>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
    <section className="site-page-hero py-20">
      <div className="site-hero-inner mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl"><p className="site-hero-kicker">{copy.kicker}</p><h1 className="mt-6 text-4xl font-black tracking-tight sm:text-6xl">{copy.title}</h1><p className="mt-6 max-w-3xl text-lg leading-8 text-blue-100">{copy.description}</p></div>
      </div>
    </section>

    <section className="site-page-shell py-16">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.78fr_1.22fr_0.72fr] lg:px-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#0b3e75]">{copy.beforeSubmit}</p>
          <h2 className="mt-3 text-3xl font-black text-slate-950">{copy.informationTitle}</h2>
          <ul className="mt-7 space-y-4">
            {copy.checklist.map((item) => <li key={item} className="flex gap-3 rounded-md border border-slate-200 bg-white p-4 text-sm font-medium text-slate-700"><span className="font-black text-orange-600">✓</span>{item}</li>)}
          </ul>
          <div className="mt-7 rounded-lg bg-slate-950 p-6 text-white"><h3 className="font-bold">{copy.reviewTitle}</h3><p className="mt-2 text-sm leading-6 text-slate-300">{copy.reviewDescription}</p></div>
        </div>
        <RepairRequestForm locale={locale} />
        <aside className="self-start lg:sticky lg:top-24">
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-6 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-700">{copy.quoteTitle}</p>
            <p className="mt-3 text-sm leading-6 text-slate-700">{copy.quoteDescription}</p>
            <a href={localizePublicPath('/contact?inquiry_type=quote', locale)} className="mt-5 inline-flex w-full items-center justify-center rounded-md bg-orange-700 px-5 py-3 text-center text-sm font-bold text-white transition-colors hover:bg-[#0b3e75]">{copy.quoteButton}</a>
          </div>
        </aside>
      </div>
    </section>

    <section className="bg-white py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#0b3e75]">{copy.processKicker}</p><h2 className="mt-3 text-3xl font-black text-slate-950">{copy.processTitle}</h2><div className="mt-9 grid gap-4 md:grid-cols-5">{copy.steps.map(({ title, description }, index) => { const number = String(index + 1).padStart(2, '0'); return <article key={number} className="border-t-4 border-[#0b3e75] bg-slate-50 p-5"><span className="text-xs font-black tracking-widest text-[#0b3e75]">{copy.stepLabel} {number}</span><h3 className="mt-4 font-bold text-slate-950">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{description}</p></article>; })}</div></div>
    </section>
  </PublicLayout>;
}
