const PLAIN_KEY = 'sirius_msg_plain_cache';

export function loadPlainCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PLAIN_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, string>;
    return typeof o === 'object' && o ? o : {};
  } catch {
    return {};
  }
}

export function savePlainToCache(messageId: string, plain: string): void {
  try {
    const c = loadPlainCache();
    c[messageId] = plain;
    localStorage.setItem(PLAIN_KEY, JSON.stringify(c));
  } catch {
    /* quota */
  }
}

/** Merge cached plaintext for own messages (DM encrypt uses recipient key — sender cannot decrypt from server). */
export function plainCacheForOwnMessages(
  messages: { id: string; senderId: string }[],
  currentUserId: string
): Record<string, string> {
  const cache = loadPlainCache();
  const out: Record<string, string> = {};
  for (const m of messages) {
    if (m.senderId === currentUserId && cache[m.id]) {
      out[m.id] = cache[m.id];
    }
  }
  return out;
}
