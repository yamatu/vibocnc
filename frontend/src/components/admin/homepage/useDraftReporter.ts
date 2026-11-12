'use client';

import { useEffect, useRef } from 'react';
import type { FieldValues, UseFormWatch } from 'react-hook-form';
import type { SectionPayload } from './section-payload';

/** Reports every form change as a section draft so the preview can follow unsaved edits. */
export function useDraftReporter<T extends FieldValues>(
  watch: UseFormWatch<T>,
  build: (values: T) => Partial<SectionPayload> | null,
  onDraftChange?: (payload: Partial<SectionPayload>) => void,
) {
  const buildRef = useRef(build);
  buildRef.current = build;
  useEffect(() => {
    if (!onDraftChange) return;
    const sub = watch((values) => {
      const payload = buildRef.current(values as T);
      if (payload) onDraftChange(payload);
    });
    return () => sub.unsubscribe();
  }, [watch, onDraftChange]);
}
