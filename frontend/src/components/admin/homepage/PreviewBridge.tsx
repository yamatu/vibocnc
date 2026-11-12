'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { PREVIEW_COMMAND_EVENT, type PreviewCommand } from './preview-protocol';

/** Receives editor commands inside the preview iframe. */
export default function PreviewBridge() {
  const router = useRouter();
  // A refresh requested while another is in flight could be dropped; coalesce
  // them and always run one trailing refresh.
  const refreshState = useRef<{ timer: ReturnType<typeof setTimeout> | null; again: boolean }>({ timer: null, again: false });

  useEffect(() => {
    const onMessage = (event: MessageEvent<PreviewCommand>) => {
      if (event.origin !== window.location.origin || event.data?.type !== PREVIEW_COMMAND_EVENT) return;
      const command = event.data;
      if (command.action === 'refresh') {
        const state = refreshState.current;
        if (state.timer) {
          state.again = true;
          return;
        }
        router.refresh();
        const settle = () => {
          if (state.again) {
            state.again = false;
            router.refresh();
            state.timer = setTimeout(settle, 900);
          } else {
            state.timer = null;
          }
        };
        state.timer = setTimeout(settle, 900);
        return;
      }
      if (command.action === 'select') {
        document.querySelectorAll('[data-admin-homepage-marker]').forEach((el) => {
          el.toggleAttribute('data-selected', el.getAttribute('data-admin-homepage-marker') === command.sectionKey);
        });
        if (command.scroll) {
          document
            .querySelector(`[data-admin-homepage-marker="${CSS.escape(command.sectionKey)}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: PREVIEW_COMMAND_EVENT, action: 'ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, [router]);

  return null;
}
