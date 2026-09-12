import { isAxiosError } from 'axios';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Read untrusted API errors without assuming that a thrown value is an Error. */
export function getErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (isAxiosError<unknown>(error) && isRecord(error.response?.data)) {
    const data = error.response.data;
    if (typeof data.message === 'string' && data.message.trim()) return data.message;
    if (typeof data.error === 'string' && data.error.trim()) return data.error;
  }
  if (isRecord(error) && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}
