const CLEARED_KEY = 'sirius_conv_cleared_at';

function readMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CLEARED_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, number>;
    return typeof o === 'object' && o ? o : {};
  } catch {
    return {};
  }
}

function writeMap(o: Record<string, number>): void {
  try {
    localStorage.setItem(CLEARED_KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

export function getConversationClearedAt(conversationId: string): number | null {
  const o = readMap();
  const t = o[conversationId];
  return typeof t === 'number' && !Number.isNaN(t) ? t : null;
}

/** Persist cleared-at using the later of local and server (strictest hide). */
export function mergeServerClearedAt(conversationId: string, iso: string | undefined): void {
  if (!iso) return;
  const serverMs = new Date(iso).getTime();
  if (Number.isNaN(serverMs)) return;
  const local = getConversationClearedAt(conversationId);
  const best = local == null ? serverMs : Math.max(local, serverMs);
  const o = readMap();
  o[conversationId] = best;
  writeMap(o);
}

export function setConversationClearedNowLocal(conversationId: string): void {
  const o = readMap();
  o[conversationId] = Date.now();
  writeMap(o);
}

export function filterMessagesAfterClear<T extends { createdAt: string }>(
  conversationId: string,
  messages: T[]
): T[] {
  const cleared = getConversationClearedAt(conversationId);
  if (cleared == null) return messages;
  return messages.filter((m) => {
    const ts = new Date(m.createdAt).getTime();
    return !Number.isNaN(ts) && ts > cleared;
  });
}
