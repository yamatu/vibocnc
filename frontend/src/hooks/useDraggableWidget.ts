'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag logic for the floating admin widgets (the AI assistant launcher and its
 * panel).
 *
 * The widget is positioned with `left`/`top` derived from state rather than with
 * `bottom`/`right` classes, because a drag has to move it relative to the
 * viewport and switching between the two anchors mid-gesture causes a jump.
 *
 * Pointer events are used instead of mouse events so a trackpad, a touch screen
 * and a pen all behave the same, and `setPointerCapture` keeps the gesture alive
 * when the cursor leaves the window — the classic bug where a fast drag leaves
 * the panel stuck to the cursor because the `mouseup` landed outside.
 */

export type WidgetPosition = { x: number; y: number };

/** Movement below this many pixels is treated as a click, not a drag. */
const DRAG_THRESHOLD_PX = 4;
/** Gap kept between the widget and every viewport edge so it stays reachable. */
const VIEWPORT_MARGIN_PX = 16;
/**
 * Distance used to park the widget from the bottom-right corner. Kept equal to
 * the clamp margin so dragging to the edge cannot park it closer than the
 * home position, which would look like the widget drifting on every nudge.
 */
const DEFAULT_INSET_PX = 16;
/** Arrow-key nudge, for keyboard users. */
const KEYBOARD_STEP_PX = 16;

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

function isFinitePosition(value: unknown): value is WidgetPosition {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WidgetPosition>;
  return (
    typeof candidate.x === 'number' &&
    typeof candidate.y === 'number' &&
    Number.isFinite(candidate.x) &&
    Number.isFinite(candidate.y)
  );
}

function readStoredPosition(storageKey: string): WidgetPosition | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isFinitePosition(parsed) ? parsed : null;
  } catch {
    // Private browsing or a corrupted value: fall back to the default spot.
    return null;
  }
}

function storePosition(storageKey: string, position: WidgetPosition) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ x: Math.round(position.x), y: Math.round(position.y) }));
  } catch {
    // Persisting is a convenience; a failure must never break the drag.
  }
}

/**
 * Keeps the widget fully inside the viewport. `max` is floored at the margin so
 * a widget taller than the viewport pins to the top instead of producing a
 * negative bound that would hide it.
 */
function clampToViewport(position: WidgetPosition, node: HTMLElement | null): WidgetPosition {
  if (typeof window === 'undefined') return position;
  const width = node?.offsetWidth ?? 0;
  const height = node?.offsetHeight ?? 0;
  const maxX = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - width - VIEWPORT_MARGIN_PX);
  const maxY = Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - height - VIEWPORT_MARGIN_PX);
  return {
    x: Math.min(Math.max(position.x, VIEWPORT_MARGIN_PX), maxX),
    y: Math.min(Math.max(position.y, VIEWPORT_MARGIN_PX), maxY),
  };
}

function bottomRightPosition(node: HTMLElement | null): WidgetPosition {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  const width = node?.offsetWidth ?? 0;
  const height = node?.offsetHeight ?? 0;
  return {
    x: Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - width - DEFAULT_INSET_PX),
    y: Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - height - DEFAULT_INSET_PX),
  };
}

export type DraggableWidget = {
  /** `null` until the position is resolved on the client, so SSR has no layout guess. */
  position: WidgetPosition | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  isDragging: boolean;
  /**
   * Builds the props for one drag handle (the panel header or the launcher
   * button). `onTap` fires when a press is released without moving, which is how
   * a touch tap is detected: Chrome suppresses the synthesised `click` for about
   * a second after a touch gesture, so relying on `click` alone makes "drag the
   * launcher, then tap it" silently do nothing on a phone.
   */
  handleProps: (options?: { onTap?: () => void }) => {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  };
  /** True when the gesture that just ended was a drag, so a click must not also fire. */
  shouldSuppressClick: () => boolean;
  /**
   * Records the current bottom-right corner. Call this immediately before a
   * change that resizes the widget (opening or closing the panel), then
   * `reclamp` will grow it from that corner instead of from its top-left, so
   * the widget appears anchored rather than jumping across the screen.
   */
  captureAnchor: () => void;
  /** Re-applies the viewport bounds; call after the widget changes size or the window resizes. */
  reclamp: () => void;
  /** Moves the widget with the arrow keys, for keyboard users. */
  onHandleKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  /** Returns the widget to the bottom-right corner and forgets the stored spot. */
  resetPosition: () => void;
};

export function useDraggableWidget(storageKey: string): DraggableWidget {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const movedRef = useRef(false);
  const anchorRef = useRef<{ right: number; bottom: number } | null>(null);
  const [position, setPosition] = useState<WidgetPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Resolve the initial spot after mount: the DOM has to exist before the widget
  // can be measured, and reading localStorage during render would desynchronise
  // server and client markup.
  useEffect(() => {
    setPosition((current) => {
      if (current) return current;
      const stored = readStoredPosition(storageKey);
      return clampToViewport(stored ?? bottomRightPosition(containerRef.current), containerRef.current);
    });
  }, [storageKey]);

  const captureAnchor = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    anchorRef.current = { right: rect.right, bottom: rect.bottom };
  }, []);

  const reclamp = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    const anchor = anchorRef.current;
    anchorRef.current = null;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    setPosition((current) => {
      if (!current) return current;
      const base = anchor ? { x: anchor.right - width, y: anchor.bottom - height } : current;
      return clampToViewport(base, node);
    });
  }, []);

  // Persist every settled position, not just dragged ones: re-anchoring when the
  // panel opens or closes also moves the widget, and forgetting that would make
  // it jump back to a stale spot on the next page load. A drag in progress is
  // skipped because it stores the final value on release instead of every frame.
  useEffect(() => {
    if (!position || dragRef.current) return;
    storePosition(storageKey, position);
  }, [position, storageKey]);

  // A narrower window (or a rotated phone) must not strand the widget off-screen.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
  }, [reclamp]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    // A press on a control inside the handle (close, new conversation, …) is a
    // click, not a drag. When the handle *is* the control, its own target wins.
    const interactive = (event.target as HTMLElement | null)?.closest?.('button, a, input, textarea, select');
    if (interactive && interactive !== event.currentTarget) return;

    const node = containerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
    movedRef.current = false;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is an optimisation; dragging still works without it.
    }
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (!drag.moved) {
        if (Math.abs(deltaX) < DRAG_THRESHOLD_PX && Math.abs(deltaY) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        movedRef.current = true;
        setIsDragging(true);
      }
      setPosition(clampToViewport({ x: drag.originX + deltaX, y: drag.originY + deltaY }, containerRef.current));
    },
    [],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>, onTap?: () => void) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setIsDragging(false);
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Already released.
      }
      // The state updater is deliberately left free of side effects (React may run
      // it twice), so the settled position is read back from the DOM instead.
      const node = containerRef.current;
      if (node) {
        const rect = node.getBoundingClientRect();
        storePosition(storageKey, { x: rect.left, y: rect.top });
      }
      if (drag.moved) return;
      onTap?.();
    },
    [storageKey],
  );

  const shouldSuppressClick = useCallback(() => {
    if (!movedRef.current) return false;
    movedRef.current = false;
    return true;
  }, []);

  const resetPosition = useCallback(() => {
    const next = clampToViewport(bottomRightPosition(containerRef.current), containerRef.current);
    setPosition(next);
    storePosition(storageKey, next);
  }, [storageKey]);

  const onHandleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      // Only act when the handle itself is focused, never when a nested control is.
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Home') {
        event.preventDefault();
        resetPosition();
        return;
      }
      const step = event.shiftKey ? KEYBOARD_STEP_PX * 4 : KEYBOARD_STEP_PX;
      let deltaX = 0;
      let deltaY = 0;
      switch (event.key) {
        case 'ArrowLeft':
          deltaX = -step;
          break;
        case 'ArrowRight':
          deltaX = step;
          break;
        case 'ArrowUp':
          deltaY = -step;
          break;
        case 'ArrowDown':
          deltaY = step;
          break;
        default:
          return;
      }
      event.preventDefault();
      const next = clampToViewport(
        { x: (position?.x ?? 0) + deltaX, y: (position?.y ?? 0) + deltaY },
        containerRef.current,
      );
      setPosition(next);
      storePosition(storageKey, next);
    },
    [position, resetPosition, storageKey],
  );

  const handleProps = useCallback(
    (options?: { onTap?: () => void }) => ({
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: React.PointerEvent<HTMLElement>) => endDrag(event, options?.onTap),
      onPointerCancel: (event: React.PointerEvent<HTMLElement>) => endDrag(event),
    }),
    [onPointerDown, onPointerMove, endDrag],
  );

  return { position, containerRef, isDragging, handleProps, shouldSuppressClick, captureAnchor, reclamp, onHandleKeyDown, resetPosition };
}
