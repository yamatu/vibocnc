'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowPathIcon, ComputerDesktopIcon, DevicePhoneMobileIcon, DeviceTabletIcon } from '@heroicons/react/24/outline';
import { PREVIEW_COMMAND_EVENT, PREVIEW_SELECT_EVENT } from './preview-protocol';

export type CanvasHandle = {
  refresh: () => void;
  select: (sectionKey: string, scroll: boolean) => void;
  reload: () => void;
};

type Device = 'desktop' | 'tablet' | 'mobile';
// Virtual viewport widths; the frame is scaled down to fit so each device shows its real layout.
const WIDTHS: Record<Device, number> = { desktop: 1280, tablet: 820, mobile: 390 };

const VisualEditorCanvas = forwardRef<CanvasHandle, {
  src: string;
  locale: string;
  selectedKey: string;
  onSelectSection: (key: string) => void;
  savingDraft: boolean;
}>(function VisualEditorCanvas({ src, locale, selectedKey, onSelectSection, savingDraft }, ref) {
  const zh = locale === 'zh';
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setStage({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const virtualWidth = WIDTHS[device];
  const scale = stage.width > 0 ? Math.min(1, (stage.width - 16) / virtualWidth) : 1;
  const frameHeight = stage.height > 0 ? stage.height / scale : 800;
  const selectedRef = useRef(selectedKey);
  selectedRef.current = selectedKey;
  // Commands sent before the preview has hydrated would be lost; hold a
  // refresh until the frame reports ready.
  const readyRef = useRef(false);
  const pendingRefreshRef = useRef(false);

  const post = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage({ type: PREVIEW_COMMAND_EVENT, ...message }, window.location.origin);
  }, []);

  const reloadFrame = useCallback(() => {
    readyRef.current = false;
    pendingRefreshRef.current = false;
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  useImperativeHandle(ref, () => ({
    refresh: () => {
      if (!readyRef.current) {
        pendingRefreshRef.current = true;
        return;
      }
      post({ action: 'refresh' });
    },
    select: (sectionKey, scroll) => post({ action: 'select', sectionKey, scroll }),
    reload: reloadFrame,
  }), [post, reloadFrame]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === PREVIEW_SELECT_EVENT && event.data.sectionKey) {
        onSelectSection(String(event.data.sectionKey));
      } else if (event.data?.type === PREVIEW_COMMAND_EVENT && event.data.action === 'ready') {
        readyRef.current = true;
        setLoading(false);
        post({ action: 'select', sectionKey: selectedRef.current, scroll: false });
        if (pendingRefreshRef.current) {
          pendingRefreshRef.current = false;
          post({ action: 'refresh' });
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSelectSection, post]);

  useEffect(() => {
    post({ action: 'select', sectionKey: selectedKey, scroll: false });
  }, [selectedKey, post]);

  const devices: Array<{ id: Device; icon: typeof ComputerDesktopIcon; label: string }> = [
    { id: 'desktop', icon: ComputerDesktopIcon, label: zh ? '电脑' : 'Desktop' },
    { id: 'tablet', icon: DeviceTabletIcon, label: zh ? '平板' : 'Tablet' },
    { id: 'mobile', icon: DevicePhoneMobileIcon, label: zh ? '手机' : 'Phone' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {devices.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDevice(d.id)}
              title={d.label}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${device === d.id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            >
              <d.icon className="h-4 w-4" />
              <span className="hidden sm:inline">{d.label}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="tabular-nums text-slate-400">{Math.round(scale * 100)}%</span>
          {savingDraft ? <span className="animate-pulse">{zh ? '同步预览中…' : 'Syncing preview…'}</span> : <span className="hidden md:inline">{zh ? '点击页面上的区块即可编辑' : 'Click any block to edit it'}</span>}
          <button
            type="button"
            onClick={reloadFrame}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50"
            title={zh ? '重新加载预览' : 'Reload preview'}
          >
            <ArrowPathIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto h-full" style={{ width: virtualWidth * scale }}>
          <iframe
            key={reloadKey}
            ref={iframeRef}
            src={src}
            title={zh ? '首页预览' : 'Homepage preview'}
            style={{ width: virtualWidth, height: frameHeight, transform: `scale(${scale})`, transformOrigin: 'top left' }}
            className={`block bg-white ${device === 'desktop' ? '' : 'border-x border-slate-300 shadow-xl'}`}
            onLoad={() => setLoading(false)}
          />
        </div>
        {loading ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/60">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : null}
      </div>
    </div>
  );
});

export default VisualEditorCanvas;
