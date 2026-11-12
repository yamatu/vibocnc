/** Messages exchanged between the admin editor and the homepage preview iframe. */
export const PREVIEW_SELECT_EVENT = 'homepage-editor:select-section';
export const PREVIEW_COMMAND_EVENT = 'homepage-editor:command';

export type PreviewCommand =
  | { type: typeof PREVIEW_COMMAND_EVENT; action: 'refresh' }
  | { type: typeof PREVIEW_COMMAND_EVENT; action: 'select'; sectionKey: string; scroll?: boolean };
