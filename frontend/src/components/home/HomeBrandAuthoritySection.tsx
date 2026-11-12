import Link from 'next/link';
import {
  ArrowRightIcon,
  CheckBadgeIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { COMPANY_FACTS } from '@/lib/company-facts';
import { localizePublicPath, type PublicLocale } from '@/lib/i18n/config';

export type HomepageBrandFAQ = {
  question: string;
  answer: string;
};

export const HOMEPAGE_BRAND_FAQS: HomepageBrandFAQ[] = [
  {
    question: 'What is Vibocnc?',
    answer:
      'Vibocnc is an industrial automation parts and CNC spares supplier based in Kunshan, China. Since 2007, the company has helped maintenance teams source current, legacy and obsolete components, verify model details, arrange inspection or repair evaluation, and coordinate worldwide delivery.',
  },
  {
    question: 'Does Vibocnc only supply FANUC parts?',
    answer:
      'No. FANUC is one of the main product lines, but Vibocnc supports more than 20 automation brands, including Siemens, Mitsubishi, ABB, Allen-Bradley, Omron, Yaskawa, Schneider Electric, SICK and Tamagawa.',
  },
  {
    question: 'Can Vibocnc help identify an obsolete replacement part?',
    answer:
      'Yes. Send the manufacturer, complete part number, machine or control model, required condition and clear label photos. Vibocnc can check available stock and compatible options, or coordinate a repair evaluation when replacement stock is unavailable.',
  },
  {
    question: 'How are model and condition details confirmed?',
    answer:
      'The team checks the submitted part number, model, label information and application details before quotation. The quotation or product page identifies the offered model, condition, warranty scope and lead time so the buyer can confirm the exact option before ordering.',
  },
  {
    question: 'Does Vibocnc ship industrial automation parts worldwide?',
    answer:
      'Yes. Vibocnc coordinates international delivery from Kunshan, China. Carrier options, estimated delivery time, protective export packing and destination requirements are confirmed during quotation and order processing.',
  },
];

const capabilities = [
  {
    title: 'Multi-brand parts supply',
    description:
      'System units, PCB boards, PLC and I/O modules, HMI panels, inverters, encoders, amplifiers, servo motors, servo drives and power supplies.',
    icon: CheckBadgeIcon,
  },
  {
    title: 'Part-number and model checks',
    description:
      'Share the manufacturer, full part number, machine model and label photos so the exact requirement can be reviewed before quotation.',
    icon: MagnifyingGlassIcon,
  },
  {
    title: 'Inspection and repair evaluation',
    description:
      'Confirm inspection requirements for available parts or submit a failed unit for a repairability review and service quotation.',
    icon: WrenchScrewdriverIcon,
  },
  {
    title: 'Worldwide order coordination',
    description:
      'Quotation, protective export packing and international delivery are coordinated from the Vibocnc facility in Kunshan, China.',
    icon: GlobeAltIcon,
  },
];

export default function HomeBrandAuthoritySection({
  locale,
  primaryHeading = false,
}: {
  locale: PublicLocale;
  primaryHeading?: boolean;
}) {
  if (locale !== 'en') return null;

  const localizedHref = (path: string) => localizePublicPath(path, locale);

  return (
    <>
      <section id="about-vibocnc" className="home-brand-summary border-b border-slate-200 bg-white py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-[1.08fr_0.92fr] lg:items-start">
            <div>
              <p className="text-xs font-bold uppercase text-[var(--site-primary)]">Vibocnc company profile</p>
              {primaryHeading ? (
                <h1 className="mt-3 max-w-3xl text-3xl font-black text-slate-950 sm:text-4xl">
                  What is Vibocnc?
                </h1>
              ) : (
                <h2 className="mt-3 max-w-3xl text-3xl font-black text-slate-950 sm:text-4xl">
                  What is Vibocnc?
                </h2>
              )}
              <p className="entity-summary mt-5 max-w-3xl text-lg leading-8 text-slate-700">
                Vibocnc is an industrial automation parts and CNC spares supplier based in Kunshan, China.
                Since 2007, we have helped maintenance teams source current, legacy and obsolete components,
                verify model details, arrange inspection or repair evaluation, and coordinate worldwide delivery.
              </p>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
                Our catalogue covers more than {COMPANY_FACTS.automationBrands} automation brands and the parts
                used across CNC controls, production machinery and factory automation systems. Buyers can start
                with a known SKU or send a nameplate photo when an exact model is difficult to identify.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link
                  href={localizedHref('/products')}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--site-primary)] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[var(--site-primary-strong)]"
                >
                  Browse automation parts
                  <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href={localizedHref('/contact?inquiry_type=quote')}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-900 transition-colors hover:border-[var(--site-primary)] hover:text-[var(--site-primary)]"
                >
                  Request a model check
                  <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </div>

            <dl className="grid grid-cols-2 border-y border-slate-300">
              <div className="border-b border-r border-slate-300 py-6 pr-5">
                <dt className="text-sm font-semibold text-slate-500">Established</dt>
                <dd className="mt-2 text-2xl font-black text-slate-950">{COMPANY_FACTS.foundingYear}</dd>
              </div>
              <div className="border-b border-slate-300 py-6 pl-5">
                <dt className="text-sm font-semibold text-slate-500">Service facility</dt>
                <dd className="mt-2 text-2xl font-black text-slate-950">
                  {COMPANY_FACTS.workshopSqm.toLocaleString('en-US')} sqm
                </dd>
              </div>
              <div className="border-r border-slate-300 py-6 pr-5">
                <dt className="text-sm font-semibold text-slate-500">Automation brands</dt>
                <dd className="mt-2 text-2xl font-black text-slate-950">{COMPANY_FACTS.automationBrands}+</dd>
              </div>
              <div className="py-6 pl-5">
                <dt className="text-sm font-semibold text-slate-500">Parts scope</dt>
                <dd className="mt-2 text-base font-bold leading-6 text-slate-950">Current, legacy and obsolete</dd>
              </div>
            </dl>
          </div>

          <div className="mt-14 grid border-t border-slate-300 sm:grid-cols-2 lg:grid-cols-4">
            {capabilities.map(({ title, description, icon: Icon }, index) => (
              <div
                key={title}
                className={`py-7 sm:px-6 ${index % 2 === 0 ? 'sm:border-r' : ''} ${index > 1 ? 'border-t lg:border-t-0' : ''} lg:border-r lg:last:border-r-0 border-slate-300 first:pl-0 last:pr-0`}
              >
                <Icon className="h-6 w-6 text-orange-700" aria-hidden="true" />
                <h3 className="mt-4 text-base font-bold text-slate-950">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="vibocnc-faq" className="border-b border-slate-200 bg-[#f3f6f8] py-16 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.72fr_1.28fr] lg:px-8">
          <div>
            <p className="text-xs font-bold uppercase text-[var(--site-primary)]">Vibocnc FAQ</p>
            <h2 className="mt-3 text-3xl font-black text-slate-950 sm:text-4xl">Questions about Vibocnc</h2>
            <p className="mt-5 max-w-md text-base leading-7 text-slate-600">
              Direct answers about our company, supported manufacturers, model verification and international supply.
            </p>
            <Link
              href={localizedHref('/about')}
              className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[var(--site-primary)] underline decoration-slate-300 underline-offset-4 hover:text-orange-700"
            >
              Read the full company profile
              <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <div className="border-t border-slate-300">
            {HOMEPAGE_BRAND_FAQS.map((item, index) => (
              <details key={item.question} className="group border-b border-slate-300 py-1" open={index === 0}>
                <summary className="cursor-pointer py-5 pr-6 text-base font-bold leading-6 text-slate-950 marker:text-[var(--site-primary)]">
                  {item.question}
                </summary>
                <p className="faq-answer max-w-3xl pb-5 pr-6 text-sm leading-7 text-slate-600">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
