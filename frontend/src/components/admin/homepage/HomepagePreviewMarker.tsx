'use client';

import { PencilSquareIcon } from '@heroicons/react/24/outline';
import type { MouseEvent, ReactNode } from 'react';
import { PREVIEW_SELECT_EVENT } from './preview-protocol';

type Props = {
  sectionKey: string;
  label: string;
  hidden?: boolean;
  children: ReactNode;
};

/**
 * Editor-only wrapper rendered inside the admin preview iframe. Hovering
 * outlines the section; clicking anywhere selects it in the editor. Link
 * navigation is suppressed so the preview never leaves the homepage.
 */
export default function HomepagePreviewMarker({ sectionKey, label, hidden = false, children }: Props) {
  const select = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('a, form')) event.preventDefault();
    window.parent.postMessage({ type: PREVIEW_SELECT_EVENT, sectionKey }, window.location.origin);
  };

  return (
    <div data-admin-homepage-marker={sectionKey} data-hidden-section={hidden || undefined} className="homepage-preview-marker relative" onClickCapture={select}>
      {hidden ? (
        <div className="pointer-events-none absolute right-3 top-3 z-[80] rounded-full bg-slate-800/90 px-3 py-1 text-xs font-semibold text-white shadow">
          Hidden · 未发布
        </div>
      ) : null}
      <div className="homepage-preview-marker-label pointer-events-none absolute left-3 top-3 z-[80]">
        <span className="inline-flex max-w-[70vw] items-center gap-1.5 truncate rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white shadow-lg">
          <PencilSquareIcon className="h-3.5 w-3.5 shrink-0" />
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}
