import { Message } from '../types';
import { copySummaryFromPayload, parseDecryptedPayload } from '../components/MessageBubble';
import { loadPlainCache } from './messagePlainCache';

const PREVIEW_KEY = 'sirius_conv_sidebar_preview';
const MAX_LEN = 40;

export function truncatePreview(text: string, max = MAX_LEN): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function previewFromMessageType(mt: Message['messageType']): string {
  switch (mt) {
    case 'voice':
      return '🎤 Voice message';
    case 'sticker':
      return '😊 Sticker';
    case 'image':
    case 'file':
      return '📷 Photo';
    case 'call':
      return '📞 Call';
    default:
      return 'Message';
  }
}

export function previewFromDecryptedPlain(plain: string): string {
  const p = parseDecryptedPayload(plain);
  const raw = copySummaryFromPayload(p);
  if (p.kind === 'file' && raw.startsWith('File:')) {
    const isPhoto = p.mime.toLowerCase().startsWith('image/') || p.mime === 'image/gif';
    return isPhoto ? '📷 Photo' : truncatePreview(raw);
  }
  if (p.kind === 'voice') return '🎤 Voice message';
  if (p.kind === 'sticker') return '😊 Sticker';
  return truncatePreview(raw);
}

function readStore(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PREVIEW_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, string>;
    return typeof o === 'object' && o ? o : {};
  } catch {
    return {};
  }
}

export function loadStoredPreview(conversationId: string): string | null {
  const t = readStore()[conversationId];
  return typeof t === 'string' && t ? t : null;
}

export function saveStoredPreview(conversationId: string, text: string): void {
  try {
    const o = readStore();
    o[conversationId] = text;
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

/** Best-effort preview when a message arrives over the network (often undecryptable here). */
export function previewForWsMessage(msg: Message, currentUserId: string): string {
  if (msg.senderId === currentUserId) {
    const hit = loadPlainCache()[msg.id];
    if (hit) return previewFromDecryptedPlain(hit);
  }
  return previewFromMessageType(msg.messageType);
}
