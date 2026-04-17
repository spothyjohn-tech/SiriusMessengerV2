const MUTED = 'sirius_conv_notify_muted';
const BLOCKED = 'sirius_blocked_users';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function isConversationNotifyMuted(conversationId: string): boolean {
  const set = readJson<Record<string, boolean>>(MUTED, {});
  return !!set[conversationId];
}

export function setConversationNotifyMuted(conversationId: string, muted: boolean) {
  const set = readJson<Record<string, boolean>>(MUTED, {});
  if (muted) set[conversationId] = true;
  else delete set[conversationId];
  writeJson(MUTED, set);
}

export function isUserBlocked(userId: string): boolean {
  const arr = readJson<string[]>(BLOCKED, []);
  return arr.includes(userId);
}

export function setUserBlocked(userId: string, blocked: boolean) {
  let arr = readJson<string[]>(BLOCKED, []);
  if (blocked) {
    if (!arr.includes(userId)) arr = [...arr, userId];
  } else {
    arr = arr.filter((id) => id !== userId);
  }
  writeJson(BLOCKED, arr);
}
