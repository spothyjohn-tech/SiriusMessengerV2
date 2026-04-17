const KEY = 'sirius_friend_ids';

export function readFriendIds(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function addFriendId(userId: string): void {
  const s = readFriendIds();
  s.add(userId);
  localStorage.setItem(KEY, JSON.stringify([...s]));
}

export function isFriend(userId: string): boolean {
  return readFriendIds().has(userId);
}
