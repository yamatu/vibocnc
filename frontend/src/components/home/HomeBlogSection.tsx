'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { Article, HomepageContent } from '@/types';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';

export default function HomeBlogSection({ content, articles }: { content?: HomepageContent | null; articles: Article[] }) {
  const { href } = usePublicI18n();
  if (!articles.length) return null;
  return (
    <section className="home-deferred-section border-y border-slate-200 bg-[#eef3f8] py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#0b3e75]">Technical knowledge</p>
            <h2 className="mt-3 text-3xl font-black text-slate-950 sm:text-4xl">{content?.title || 'From the Automation Blog'}</h2>
            <p className="mt-4 text-base leading-7 text-slate-600">{content?.description || 'Practical product selection, troubleshooting and maintenance guidance from our industrial automation team.'}</p>
          </div>
          <Link href={href(content?.button_url || '/blog')} className="font-bold text-[#0b3e75] hover:text-orange-700">{content?.button_text || 'View All Blog Articles'} →</Link>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {articles.slice(0, 3).map((article) => {
            const path = article.public_path || `/blog/${article.slug}`;
            return <article key={article.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
              {article.featured_image ? <Link href={href(path)} className="block aspect-[16/9] overflow-hidden bg-slate-100"><Image src={article.featured_image} alt={article.title} width={720} height={405} className="h-full w-full object-cover transition duration-500 hover:scale-105" /></Link> : <div className="aspect-[16/9] bg-[linear-gradient(135deg,#082f5a,#0b3e75)]" />}
              <div className="p-6">
                <p className="text-xs font-bold uppercase tracking-wider text-orange-700">Featured guide</p>
                <h3 className="mt-3 text-xl font-bold leading-7 text-slate-950"><Link href={href(path)} className="hover:text-[#0b3e75]">{article.title}</Link></h3>
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{article.summary}</p>
                <Link href={href(path)} className="mt-5 inline-flex font-bold text-[#0b3e75] hover:text-orange-700">Read article →</Link>
              </div>
            </article>;
          })}
        </div>
      </div>
    </section>
  );
}
