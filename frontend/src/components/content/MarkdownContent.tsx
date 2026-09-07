import React from 'react';

interface MarkdownContentProps {
  content: string;
  className?: string;
  minHeadingLevel?: 1 | 2;
}

function safeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    const url = new URL(trimmed);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function videoEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    let id = '';
    if (url.protocol !== 'https:') return null;
    if (url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be') id = url.pathname.slice(1).split('/')[0];
    if (url.hostname === 'youtube.com' || url.hostname === 'www.youtube.com' || url.hostname === 'm.youtube.com') {
      id = url.searchParams.get('v') || '';
      const match = url.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/);
      if (!id && match) id = match[1];
    }
    if (/^[A-Za-z0-9_-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
    if (url.hostname === 'vimeo.com' || url.hostname === 'www.vimeo.com' || url.hostname === 'player.vimeo.com') {
      const vimeoId = url.pathname.split('/').filter(Boolean).pop() || '';
      if (/^\d{6,12}$/.test(vimeoId)) return `https://player.vimeo.com/video/${vimeoId}`;
    }
    return null;
  } catch {
    return null;
  }
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const tokenPattern = /(!?\[[^\]]*\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g;
  const parts = text.split(tokenPattern).filter(Boolean);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    const image = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      const src = safeUrl(image[2]);
      return src ? <img key={key} src={src} alt={image[1]} className="my-6 w-full rounded-md" loading="lazy" /> : part;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = safeUrl(link[2]);
      if (!href) return part;
      const external = href.startsWith('http://') || href.startsWith('https://');
      return <a key={key} href={href} className="text-blue-700 underline hover:text-blue-900" {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{link[1]}</a>;
    }
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={key} className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">{part.slice(1, -1)}</code>;
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

export default function MarkdownContent({ content, className = '', minHeadingLevel = 1 }: MarkdownContentProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index++; continue; }

    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith('```')) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<pre key={`code-${index}`} className="my-6 overflow-x-auto rounded-md bg-gray-950 p-4 text-sm text-gray-100"><code data-language={language || undefined}>{code.join('\n')}</code></pre>);
      continue;
    }

    if (/^---+$/.test(line)) {
      blocks.push(<hr key={`hr-${index}`} className="my-8 border-gray-200" />);
      index++;
      continue;
    }

    const videoMatch = line.match(/^@\[(?:youtube|video)\]\(([^)]+)\)$/i);
    const bareVideo = videoEmbedUrl(line);
    const embedUrl = videoMatch ? videoEmbedUrl(videoMatch[1]) : bareVideo;
    if (embedUrl) {
      blocks.push(
        <div key={`video-${index}`} className="my-8 aspect-video overflow-hidden rounded-md bg-black">
          <iframe src={embedUrl} title="Embedded video" className="h-full w-full" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
        </div>
      );
      index++;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.max(minHeadingLevel, heading[1].length);
      const classes = level === 1 ? 'mt-10 mb-4 text-3xl font-bold' : level === 2 ? 'mt-9 mb-3 text-2xl font-bold' : 'mt-7 mb-3 text-xl font-semibold';
      blocks.push(React.createElement(`h${level}`, { key: `h-${index}`, className: classes }, renderInline(heading[2], `h-${index}`)));
      index++;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*[-*]\s+/, ''));
      blocks.push(<ul key={`ul-${index}`} className="my-5 list-disc space-y-2 pl-6">{items.map((item, i) => <li key={i}>{renderInline(item, `ul-${index}-${i}`)}</li>)}</ul>);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*\d+\.\s+/, ''));
      blocks.push(<ol key={`ol-${index}`} className="my-5 list-decimal space-y-2 pl-6">{items.map((item, i) => <li key={i}>{renderInline(item, `ol-${index}-${i}`)}</li>)}</ol>);
      continue;
    }

    if (line.startsWith('> ')) {
      blocks.push(<blockquote key={`quote-${index}`} className="my-5 border-l-4 border-blue-600 pl-4 italic text-gray-700">{renderInline(line.slice(2), `quote-${index}`)}</blockquote>);
      index++;
      continue;
    }

    const paragraph: string[] = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !/^(#{1,4}\s|[-*]\s|\d+\.\s|>\s|@\[(?:youtube|video)\])/.test(lines[index].trim()) && !videoEmbedUrl(lines[index].trim())) {
      paragraph.push(lines[index].trim());
      index++;
    }
    blocks.push(<p key={`p-${index}`} className="mb-5 leading-8 text-gray-700">{renderInline(paragraph.join(' '), `p-${index}`)}</p>);
  }

  return <div className={className}>{blocks}</div>;
}
