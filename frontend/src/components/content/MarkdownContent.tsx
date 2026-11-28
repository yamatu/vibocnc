import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { normalizeCompactTables } from '@/lib/normalize-markdown';

interface MarkdownContentProps {
  content: string;
  className?: string;
  minHeadingLevel?: 1 | 2;
}

const VIDEO_LINK_PREFIX = 'https://markdown-video.invalid/embed?url=';

function videoEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return null;

    let id = '';
    if (url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be') {
      id = url.pathname.slice(1).split('/')[0];
    }
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      id = url.searchParams.get('v') || '';
      const match = url.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/);
      if (!id && match) id = match[1];
    }
    if (/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
      return `https://www.youtube-nocookie.com/embed/${id}`;
    }

    if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(url.hostname)) {
      const vimeoId = url.pathname.split('/').filter(Boolean).pop() || '';
      if (/^\d{6,12}$/.test(vimeoId)) return `https://player.vimeo.com/video/${vimeoId}`;
    }
    return null;
  } catch {
    return null;
  }
}

/** GFM expects table rows on separate lines. Repair common one-line pasted tables. */
function normalizeMarkdown(content: string): string {
  return normalizeCompactTables(content)
    .replace(/^[ \t]*@\[(?:youtube|video)\]\(([^)\r\n]+)\)[ \t]*$/gim, (line, url: string) => {
      const embed = videoEmbedUrl(url);
      return embed ? `[video](${VIDEO_LINK_PREFIX}${encodeURIComponent(url.trim())})` : line;
    })
    .replace(/^https:\/\/[^\s]+$/gim, (line) => {
      const embed = videoEmbedUrl(line);
      return embed ? `[video](${VIDEO_LINK_PREFIX}${encodeURIComponent(line.trim())})` : line;
    });
}

function getVideoEmbedFromLink(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.hostname !== 'markdown-video.invalid' || url.pathname !== '/embed') return null;
    const originalUrl = url.searchParams.get('url');
    return originalUrl ? videoEmbedUrl(originalUrl) : null;
  } catch {
    return null;
  }
}

export default function MarkdownContent({ content, className = '', minHeadingLevel = 1 }: MarkdownContentProps) {
  const components: Components = {
    h1: ({ children, id }) => minHeadingLevel === 2
      ? <h2 id={id} className="mb-4 mt-10 text-3xl font-bold">{children}</h2>
      : <h1 id={id} className="mb-4 mt-10 text-3xl font-bold">{children}</h1>,
    h2: ({ children, id }) => <h2 id={id} className="mb-3 mt-9 text-2xl font-bold">{children}</h2>,
    h3: ({ children, id }) => <h3 id={id} className="mb-3 mt-7 text-xl font-semibold">{children}</h3>,
    h4: ({ children, id }) => <h4 id={id} className="mb-2 mt-6 text-lg font-semibold">{children}</h4>,
    h5: ({ children, id }) => <h5 id={id} className="mb-2 mt-5 text-base font-semibold">{children}</h5>,
    h6: ({ children, id }) => <h6 id={id} className="mb-2 mt-5 text-sm font-semibold">{children}</h6>,
    p: ({ children }) => <p className="mb-5 leading-8 text-gray-700">{children}</p>,
    a: ({ href, children, id, title, ...props }) => {
      if (!href) return <>{children}</>;
      const embedUrl = getVideoEmbedFromLink(href);
      if (embedUrl) {
        return <span className="my-8 block aspect-video overflow-hidden rounded-md bg-black">
          <iframe src={embedUrl} title="Embedded video" className="h-full w-full" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
        </span>;
      }
      const external = /^https?:\/\//i.test(href);
      return <a aria-describedby={props['aria-describedby']} id={id} title={title} href={href} className="text-blue-700 underline hover:text-blue-900" {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>;
    },
    img: ({ src, alt }) => typeof src === 'string'
      ? <img src={src} alt={alt || ''} className="my-6 h-auto max-w-full rounded-md" loading="lazy" />
      : null,
    ul: ({ children, className: markdownClassName }) => <ul className={`my-5 list-disc space-y-2 pl-6 ${markdownClassName || ''}`}>{children}</ul>,
    ol: ({ children, className: markdownClassName, start }) => <ol start={start} className={`my-5 list-decimal space-y-2 pl-6 ${markdownClassName || ''}`}>{children}</ol>,
    li: ({ children, className: markdownClassName }) => <li className={`pl-1 ${markdownClassName || ''}`}>{children}</li>,
    blockquote: ({ children }) => <blockquote className="my-5 border-l-4 border-blue-600 pl-4 italic text-gray-700">{children}</blockquote>,
    hr: () => <hr className="my-8 border-gray-200" />,
    del: ({ children }) => <del>{children}</del>,
    table: ({ children }) => <div className="my-6 w-full overflow-x-auto rounded-md border border-gray-200"><table className="w-full border-collapse text-left text-sm">{children}</table></div>,
    thead: ({ children }) => <thead className="bg-gray-100 text-gray-900">{children}</thead>,
    tbody: ({ children }) => <tbody className="divide-y divide-gray-200">{children}</tbody>,
    tr: ({ children }) => <tr className="even:bg-gray-50">{children}</tr>,
    th: ({ children, style }) => <th style={style} scope="col" className="border-b border-gray-300 px-4 py-3 font-semibold">{children}</th>,
    td: ({ children, style }) => <td style={style} className="border-b border-gray-200 px-4 py-3 align-top text-gray-700">{children}</td>,
    pre: ({ children }) => <pre className="my-6 overflow-x-auto rounded-md bg-gray-950 p-4 text-sm text-gray-100 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">{children}</pre>,
    code: ({ className: codeClassName, children }) => <code className={codeClassName ? `${codeClassName} font-mono` : 'rounded bg-gray-100 px-1.5 py-0.5 text-sm'}>{children}</code>,
    input: ({ checked, disabled }) => <input disabled={disabled} type="checkbox" checked={Boolean(checked)} readOnly className="mr-2 align-middle accent-blue-600" />,
  };

  return <div className={className}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {normalizeMarkdown(content)}
    </ReactMarkdown>
  </div>;
}
