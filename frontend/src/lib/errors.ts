import { isAxiosError } from 'axios';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Read untrusted API errors without assuming that a thrown value is an Error.
 *
 * The API splits a short headline (`message`) from the cause (`error`). This used
 * to return whichever came first, which discarded the reason a request was
 * refused: a 409 reached the admin as "Failed to start AI review" with the real
 * explanation dropped. A prose cause is now appended to the headline; a bare
 * machine code is not, because it would only restate what the headline already
 * says (codes remain the answer when there is no headline at all).
 */
export function getErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (isAxiosError<unknown>(error) && isRecord(error.response?.data)) {
    const data = error.response.data;
    const message = typeof data.message === 'string' ? data.message.trim() : '';
    const detail = typeof data.error === 'string' ? data.error.trim() : '';
    if (message && detail && !message.includes(detail) && /\s/.test(detail)) {
      return `${message}：${detail}`;
    }
    if (message) return message;
    if (detail) return detail;
  }
  if (isRecord(error) && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}
