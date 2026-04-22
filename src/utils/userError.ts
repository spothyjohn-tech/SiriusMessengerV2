import axios from 'axios';
import { t } from './i18n';

type AxiosLikeError = {
  code?: string;
  message?: string;
  response?: {
    status?: number;
    data?: any;
  };
};

export function userError(err: unknown, fallbackKey: string = 'error.unknown'): string {
  if (axios.isAxiosError(err)) {
    const e = err as AxiosLikeError;
    const status = e.response?.status;

    // No response => network / CORS / server down.
    if (!e.response) {
      if (e.code === 'ECONNABORTED') return t('error.timeout');
      return t('error.network');
    }

    if (status === 401) return t('error.unauthorized');
    if (status === 403) return t('error.forbidden');
    if (status === 404) return t('error.notFound');
    if (status && status >= 500) return t('error.server');

    // If backend returns a short error string, prefer translating known i18n keys.
    const backendMsg =
      typeof e.response?.data?.error === 'string'
        ? (e.response?.data?.error as string)
        : typeof e.response?.data?.message === 'string'
          ? (e.response?.data?.message as string)
          : null;
    if (backendMsg && backendMsg.trim().length <= 220) {
      const k = backendMsg.trim();
      if (k.startsWith('error.') || k.startsWith('auth.') || k.startsWith('chat.') || k.startsWith('msg.')) {
        return t(k);
      }
      return backendMsg;
    }

    return t(fallbackKey);
  }

  const anyErr = err as { message?: string } | null;
  const msg = anyErr?.message;
  if (typeof msg === 'string' && msg.trim() && msg.trim().length <= 160) {
    return msg;
  }
  return t(fallbackKey);
}

