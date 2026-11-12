import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import type { TemplateItem, TemplateSectionModel } from '@/lib/section-templates';

type Props = {
  model: TemplateSectionModel;
  sectionId: string;
  /** Maps a site-relative link to the final href (e.g. adds a locale prefix). */
  resolveHref?: (href: string) => string;
};

const SPACING = { compact: 'py-10 sm:py-12', normal: 'py-14 sm:py-20', spacious: 'py-20 sm:py-28' } as const;
const COLUMNS = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' } as const;

function isExternal(href: string) {
  return /^(https?:|mailto:|tel:)/i.test(href);
}

function SmartLink({ href, className, children, resolveHref }: { href: string; className?: string; children: ReactNode; resolveHref?: (h: string) => string }) {
  if (isExternal(href)) {
    return <a href={href} className={className} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">{children}</a>;
  }
  return <Link href={resolveHref ? resolveHref(href) : href} className={className}>{children}</Link>;
}

function Header({ model, center }: { model: TemplateSectionModel; center: boolean }) {
  if (!model.kicker && !model.title && !model.description && !model.subtitle) return null;
  return (
    <div className={`mb-10 max-w-3xl ${center ? 'mx-auto text-center' : ''}`}>
      {model.kicker ? <p className="tpl-kicker mb-3 text-xs font-bold uppercase tracking-[0.18em]">{model.kicker}</p> : null}
      {model.title ? <h2 className="tpl-title text-3xl font-black tracking-tight sm:text-4xl">{model.title}</h2> : null}
      {model.subtitle ? <p className="tpl-muted mt-3 text-lg font-medium">{model.subtitle}</p> : null}
      {model.description ? <p className="tpl-muted mt-4 whitespace-pre-line text-base leading-7">{model.description}</p> : null}
    </div>
  );
}

function Buttons({ model, center, resolveHref }: { model: TemplateSectionModel; center: boolean; resolveHref?: (h: string) => string }) {
  if (!(model.buttonText && model.buttonHref) && !(model.secondaryText && model.secondaryHref)) return null;
  return (
    <div className={`mt-8 flex flex-wrap gap-3 ${center ? 'justify-center' : ''}`}>
      {model.buttonText && model.buttonHref ? (
        <SmartLink href={model.buttonHref} resolveHref={resolveHref} className="tpl-btn-primary inline-flex items-center gap-2 px-6 py-3 text-sm font-bold">
          {model.buttonText}<span aria-hidden="true">→</span>
        </SmartLink>
      ) : null}
      {model.secondaryText && model.secondaryHref ? (
        <SmartLink href={model.secondaryHref} resolveHref={resolveHref} className="tpl-btn-secondary inline-flex items-center px-6 py-3 text-sm font-bold">
          {model.secondaryText}
        </SmartLink>
      ) : null}
    </div>
  );
}

function ItemImage({ item, className }: { item: TemplateItem; className: string }) {
  if (!item.image) return null;
   
  return <img src={item.image} alt={item.title || ''} loading="lazy" decoding="async" className={className} />;
}

function Body({ model, resolveHref }: { model: TemplateSectionModel; resolveHref?: (h: string) => string }) {
  const { style } = model;
  const center = style.align === 'center';
  const radius = style.rounded ? 'rounded-2xl' : 'rounded-md';
  const cols = COLUMNS[style.columns];

  switch (model.template) {
    case 'image_text': {
      const imageFirst = style.imagePosition === 'left';
      return (
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className={imageFirst ? 'lg:order-2' : ''}>
            {model.kicker ? <p className="tpl-kicker mb-3 text-xs font-bold uppercase tracking-[0.18em]">{model.kicker}</p> : null}
            {model.title ? <h2 className="tpl-title text-3xl font-black tracking-tight sm:text-4xl">{model.title}</h2> : null}
            {model.subtitle ? <p className="tpl-muted mt-3 text-lg font-medium">{model.subtitle}</p> : null}
            {model.description ? <p className="tpl-muted mt-4 whitespace-pre-line text-base leading-7">{model.description}</p> : null}
            {model.items.length > 0 ? (
              <ul className="mt-6 space-y-3">
                {model.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="tpl-check mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black" aria-hidden="true">✓</span>
                    <span className="tpl-text font-medium">{item.title}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <Buttons model={model} center={false} resolveHref={resolveHref} />
          </div>
          <div className={`${imageFirst ? 'lg:order-1' : ''}`}>
            {model.image ? (
               
              <img src={model.image} alt={model.title} loading="lazy" decoding="async" className={`tpl-media aspect-[4/3] w-full object-cover ${radius}`} />
            ) : (
              <div className={`tpl-placeholder aspect-[4/3] w-full ${radius}`} />
            )}
          </div>
        </div>
      );
    }
    case 'card_grid':
      return (
        <>
          <Header model={model} center={center} />
          <div className={`grid grid-cols-1 gap-5 ${cols}`}>
            {model.items.map((item, i) => {
              const inner = (
                <>
                  <ItemImage item={item} className={`mb-5 aspect-[16/10] w-full object-cover ${style.rounded ? 'rounded-xl' : 'rounded'}`} />
                  {item.title ? <h3 className="tpl-title text-lg font-bold">{item.title}</h3> : null}
                  {item.text ? <p className="tpl-muted mt-2 text-sm leading-6">{item.text}</p> : null}
                  {item.href ? <span className="tpl-link mt-4 inline-flex items-center gap-1 text-sm font-semibold">Learn more <span aria-hidden="true">→</span></span> : null}
                </>
              );
              const cls = `tpl-card flex h-full flex-col p-6 ${radius} ${center ? 'text-center items-center' : ''}`;
              return item.href
                ? <SmartLink key={i} href={item.href} resolveHref={resolveHref} className={`${cls} tpl-card-hover`}>{inner}</SmartLink>
                : <div key={i} className={cls}>{inner}</div>;
            })}
          </div>
          <Buttons model={model} center={center} resolveHref={resolveHref} />
        </>
      );
    case 'cta_banner':
      return (
        <div className={`tpl-cta relative overflow-hidden px-6 py-12 sm:px-12 sm:py-16 ${radius} ${center ? 'text-center' : ''}`}>
          <div className={`relative max-w-3xl ${center ? 'mx-auto' : ''}`}>
            {model.kicker ? <p className="tpl-kicker mb-3 text-xs font-bold uppercase tracking-[0.18em]">{model.kicker}</p> : null}
            {model.title ? <h2 className="tpl-title text-3xl font-black tracking-tight sm:text-4xl">{model.title}</h2> : null}
            {model.description ? <p className="tpl-muted mt-4 whitespace-pre-line text-lg leading-8">{model.description}</p> : null}
            <Buttons model={model} center={center} resolveHref={resolveHref} />
          </div>
        </div>
      );
    case 'gallery':
      return (
        <>
          <Header model={model} center={center} />
          <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${cols}`}>
            {model.items.map((item, i) => (
              <figure key={i} className={`group relative overflow-hidden ${radius}`}>
                {item.image ? (
                   
                  <img src={item.image} alt={item.title || ''} loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover transition duration-500 group-hover:scale-105" />
                ) : (
                  <div className="tpl-placeholder aspect-[4/3] w-full" />
                )}
                {item.title ? (
                  <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-8 text-sm font-semibold text-white">{item.title}</figcaption>
                ) : null}
              </figure>
            ))}
          </div>
          <Buttons model={model} center={center} resolveHref={resolveHref} />
        </>
      );
    case 'faq':
      return (
        <div className="mx-auto max-w-3xl">
          <Header model={model} center={center} />
          <div className="space-y-3">
            {model.items.map((item, i) => (
              <details key={i} className={`tpl-card group p-5 ${radius}`}>
                <summary className="tpl-title flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                  {item.title}
                  <span className="tpl-link text-xl leading-none transition group-open:rotate-45" aria-hidden="true">+</span>
                </summary>
                <p className="tpl-muted mt-3 whitespace-pre-line text-sm leading-6">{item.text}</p>
              </details>
            ))}
          </div>
          <Buttons model={model} center={center} resolveHref={resolveHref} />
        </div>
      );
    case 'stats_band':
      return (
        <>
          <Header model={model} center={center} />
          <dl className={`grid grid-cols-2 gap-6 ${cols}`}>
            {model.items.map((item, i) => (
              <div key={i} className={center ? 'text-center' : ''}>
                <dt className="sr-only">{item.title}</dt>
                <dd className="tpl-stat text-4xl font-black tracking-tight sm:text-5xl">{item.value}</dd>
                <dd className="tpl-title mt-2 text-sm font-semibold uppercase tracking-wide">{item.title}</dd>
                {item.text ? <dd className="tpl-muted mt-1 text-sm">{item.text}</dd> : null}
              </div>
            ))}
          </dl>
          <Buttons model={model} center={center} resolveHref={resolveHref} />
        </>
      );
    case 'steps':
      return (
        <>
          <Header model={model} center={center} />
          <ol className={`grid grid-cols-1 gap-5 ${cols}`}>
            {model.items.map((item, i) => (
              <li key={i} className={`tpl-card relative p-6 ${radius} ${center ? 'text-center' : ''}`}>
                <span className={`tpl-step mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full text-base font-black ${center ? 'mx-auto' : ''}`}>{i + 1}</span>
                <h3 className="tpl-title text-lg font-bold">{item.title}</h3>
                {item.text ? <p className="tpl-muted mt-2 text-sm leading-6">{item.text}</p> : null}
              </li>
            ))}
          </ol>
          <Buttons model={model} center={center} resolveHref={resolveHref} />
        </>
      );
    case 'logo_wall':
      return (
        <>
          <Header model={model} center={center} />
          <div className={`grid grid-cols-2 gap-4 ${cols}`}>
            {model.items.map((item, i) => {
              const inner = item.image
                 
                ? <img src={item.image} alt={item.title || ''} loading="lazy" decoding="async" className="max-h-12 max-w-[70%] object-contain" />
                : <span className="tpl-title text-lg font-black uppercase">{item.title}</span>;
              const cls = `tpl-card tpl-logo flex h-24 items-center justify-center p-4 ${radius}`;
              return item.href
                ? <SmartLink key={i} href={item.href} resolveHref={resolveHref} className={`${cls} tpl-card-hover`}>{inner}</SmartLink>
                : <div key={i} className={cls}>{inner}</div>;
            })}
          </div>
          <Buttons model={model} center={center} resolveHref={resolveHref} />
        </>
      );
    default:
      return null;
  }
}

export default function TemplateSection({ model, sectionId, resolveHref }: Props) {
  const { style } = model;
  const bgStyle: CSSProperties | undefined =
    style.background === 'image' && style.backgroundImage
      ? { backgroundImage: `linear-gradient(rgba(8,24,39,0.72), rgba(8,24,39,0.72)), url("${style.backgroundImage.replace(/"/g, '%22')}")` }
      : undefined;
  return (
    <section
      id={sectionId}
      className={`tpl home-deferred-section tpl-bg-${style.background} ${SPACING[style.spacing]} ${style.background === 'image' ? 'bg-cover bg-center' : ''}`}
      style={bgStyle}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Body model={model} resolveHref={resolveHref} />
      </div>
    </section>
  );
}
