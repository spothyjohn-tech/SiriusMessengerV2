import React, { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Message } from '../types';
import { cryptoService, CryptoService } from '../services/crypto';
import { AvatarBubble } from '../utils/avatar';
import { loadPlainCache } from '../utils/messagePlainCache';
import { IconFile } from './icons';
import VoiceMessagePlayer from './VoiceMessagePlayer';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightText(text: string, query?: string): React.ReactNode {
  const q = query?.trim();
  if (!q) return text;
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={i} className="sf-msg-highlight">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export type ParsedPayload =
  | {
      kind: 'text';
      text: string;
      replyToId?: string;
      replySnippet?: string;
      replyKind?: 'text' | 'image' | 'video' | 'gif' | 'voice' | 'file' | 'sticker';
      replyMime?: string;
      replyName?: string;
      replyThumbB64?: string;
    }
  | { kind: 'voice'; mime: string; b64: string }
  | { kind: 'file'; name: string; mime: string; b64: string }
  | { kind: 'sticker'; char: string };

export function isRichMediaMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return m.startsWith('image/') || m.startsWith('video/') || m === 'image/gif';
}

export function isImageOrGifFilePayload(p: ParsedPayload): boolean {
  if (p.kind !== 'file' || !isRichMediaMime(p.mime)) return false;
  return !p.mime.toLowerCase().startsWith('video/');
}

export function parseDecryptedPayload(plain: string): ParsedPayload {
  const t = plain.trimStart();
  if (t.startsWith('{')) {
    try {
      const o = JSON.parse(plain) as Record<string, unknown>;
      if (o._sirius === 'voice' && typeof o.mime === 'string' && typeof o.b64 === 'string') {
        return { kind: 'voice', mime: o.mime, b64: o.b64 };
      }
      if (
        o._sirius === 'file' &&
        typeof o.name === 'string' &&
        typeof o.mime === 'string' &&
        typeof o.b64 === 'string'
      ) {
        return { kind: 'file', name: o.name, mime: o.mime, b64: o.b64 };
      }
      if (o._sirius === 'textReply' && typeof o.body === 'string') {
        return {
          kind: 'text',
          text: o.body,
          replyToId: typeof o.replyToId === 'string' ? o.replyToId : undefined,
          replySnippet: typeof o.replySnippet === 'string' ? o.replySnippet : undefined,
          replyKind:
            typeof o.replyKind === 'string'
              ? (o.replyKind as any)
              : undefined,
          replyMime: typeof o.replyMime === 'string' ? o.replyMime : undefined,
          replyName: typeof o.replyName === 'string' ? o.replyName : undefined,
          replyThumbB64: typeof o.replyThumbB64 === 'string' ? o.replyThumbB64 : undefined,
        };
      }
      if (o._sirius === 'sticker' && typeof o.char === 'string') {
        return { kind: 'sticker', char: o.char };
      }
    } catch {
      /* treat as text */
    }
  }
  return { kind: 'text', text: plain };
}

export function searchTextFromPayload(p: ParsedPayload): string {
  if (p.kind === 'text') {
    const q = p.replySnippet ? `${p.replySnippet} ${p.text}` : p.text;
    return q;
  }
  if (p.kind === 'voice') return 'Voice message';
  if (p.kind === 'sticker') return p.char;
  return `File: ${p.name}`;
}

export function copySummaryFromPayload(p: ParsedPayload): string {
  if (p.kind === 'text') return p.text;
  if (p.kind === 'voice') return 'Voice message';
  if (p.kind === 'sticker') return p.char;
  return `File: ${p.name}`;
}

export function editableTextFromPayload(plain: string, p: ParsedPayload): string | null {
  if (p.kind !== 'text') return null;
  return p.text;
}

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  localPlaintext?: string;
  searchQuery?: string;
  highlighted?: boolean;
  onPlaintext?: (id: string, text: string) => void;
  onFullPlaintext?: (id: string, plain: string) => void;
  onMessageContextMenu?: (e: React.MouseEvent, ctx: { message: Message; plain: string; isOwn: boolean }) => void;
  groupConversationId?: string;
  onJumpToMessage?: (id: string) => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isOwn,
  localPlaintext,
  searchQuery,
  highlighted,
  onPlaintext,
  onFullPlaintext,
  onMessageContextMenu,
  groupConversationId,
  onJumpToMessage,
}) => {
  const [plain, setPlain] = useState<string>(isOwn && localPlaintext ? localPlaintext : '');
  const [err, setErr] = useState(false);
  const [loading, setLoading] = useState(!(isOwn && localPlaintext));
  const [lightbox, setLightbox] = useState<'image' | 'video' | null>(null);
  const onPlainRef = useRef(onPlaintext);
  const onFullRef = useRef(onFullPlaintext);
  onPlainRef.current = onPlaintext;
  onFullRef.current = onFullPlaintext;

  const parsed = useMemo(() => {
    if (!plain && !loading && !err) return null;
    if (!plain) return null;
    return parseDecryptedPayload(plain);
  }, [plain, loading, err]);

  const voiceUrl = useMemo(() => {
    if (parsed?.kind !== 'voice') return null;
    try {
      const bin = atob(parsed.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: parsed.mime || 'audio/webm' });
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }, [parsed]);

  const mediaUrl = useMemo(() => {
    if (parsed?.kind !== 'file' || !isRichMediaMime(parsed.mime)) return null;
    try {
      const bin = atob(parsed.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: parsed.mime || 'application/octet-stream' });
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }, [parsed]);

  useEffect(() => {
    return () => {
      if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    };
  }, [voiceUrl]);

  useEffect(() => {
    return () => {
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    };
  }, [mediaUrl]);

  useEffect(() => {
    if (isOwn && localPlaintext) {
      setPlain(localPlaintext);
      setLoading(false);
      setErr(false);
      const p = parseDecryptedPayload(localPlaintext);
      onPlainRef.current?.(message.id, searchTextFromPayload(p));
      onFullRef.current?.(message.id, localPlaintext);
      return;
    }
    if (isOwn) {
      const hit = loadPlainCache()[message.id];
      if (hit) {
        setPlain(hit);
        setLoading(false);
        setErr(false);
        const p = parseDecryptedPayload(hit);
        onPlainRef.current?.(message.id, searchTextFromPayload(p));
        onFullRef.current?.(message.id, hit);
      } else {
        setLoading(false);
        setErr(false);
        setPlain('Sent message (encrypted for recipient)');
      }
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        let dec: string;
        if (groupConversationId && message.senderKey === CryptoService.GROUP_SENDER_KEY) {
          dec = await cryptoService.decryptGroupMessage(
            message.encryptedContent,
            message.iv,
            groupConversationId
          );
        } else if (groupConversationId) {
          try {
            dec = await cryptoService.decryptMessage(
              message.encryptedContent,
              message.iv,
              message.senderKey
            );
          } catch {
            dec = await cryptoService.decryptGroupMessage(
              message.encryptedContent,
              message.iv,
              groupConversationId
            );
          }
        } else {
          dec = await cryptoService.decryptMessage(
            message.encryptedContent,
            message.iv,
            message.senderKey
          );
        }
        if (!cancelled) {
          setPlain(dec);
          setErr(false);
          const p = parseDecryptedPayload(dec);
          onPlainRef.current?.(message.id, searchTextFromPayload(p));
          onFullRef.current?.(message.id, dec);
        }
      } catch {
        if (!cancelled) {
          setErr(true);
          setPlain('Could not decrypt message');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message, isOwn, localPlaintext, message.id, message.senderKey, groupConversationId]);

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  const openLightbox = (kind: 'image' | 'video') => {
    if (!mediaUrl) return;
    setLightbox(kind);
  };

  const body = () => {
    if (loading) return <span className="sf-msg-loading">…</span>;
    if (err) return highlightText(plain, searchQuery);
    const p = parseDecryptedPayload(plain);
    if (p.kind === 'text') {
      return (
        <>
          {p.replySnippet ? (
            <button
              type="button"
              className="sf-msg-reply-quote"
              title={p.replySnippet}
              onClick={() => p.replyToId && onJumpToMessage?.(p.replyToId)}
            >
              <span className="sf-msg-reply-arrow" aria-hidden>
                ↩
              </span>
              <span className="sf-msg-reply-body">
                <span className="sf-msg-reply-who">Reply</span>
                <span className="sf-msg-reply-snippet">{p.replySnippet}</span>
              </span>
              {p.replyKind && (p.replyKind === 'image' || p.replyKind === 'gif') && p.replyMime && p.replyThumbB64 ? (
                <span className="sf-msg-reply-thumb" aria-hidden>
                  <img alt="" src={`data:${p.replyMime};base64,${p.replyThumbB64}`} />
                </span>
              ) : p.replyKind === 'video' ? (
                <span className="sf-msg-reply-thumb sf-msg-reply-thumb--icon" aria-hidden>
                  🎞
                </span>
              ) : null}
            </button>
          ) : null}
          {highlightText(p.text, searchQuery)}
        </>
      );
    }
    if (p.kind === 'sticker') {
      return (
        <span className="sf-msg-sticker" role="img" aria-label="Sticker">
          {p.char}
        </span>
      );
    }
    if (p.kind === 'voice') {
      return voiceUrl ? <VoiceMessagePlayer src={voiceUrl} /> : <span className="sf-msg-voice-fallback">Voice message</span>;
    }
    const href = `data:${p.mime};base64,${p.b64}`;
    if (mediaUrl && isRichMediaMime(p.mime)) {
      const isVideo = p.mime.toLowerCase().startsWith('video/');
      return (
        <span className="sf-msg-media-wrap">
          {isVideo ? (
            <>
              <video
                className="sf-msg-media-thumb sf-msg-media-video"
                src={mediaUrl}
                controls
                playsInline
                preload="metadata"
              />
              <button
                type="button"
                className="sf-msg-fullscreen-btn"
                onClick={() => openLightbox('video')}
              >
                Full screen
              </button>
            </>
          ) : (
            <button
              type="button"
              className="sf-msg-media-btn"
              onClick={() => openLightbox('image')}
              aria-label="Open full size"
            >
              <img className="sf-msg-media-thumb" src={mediaUrl} alt="" />
            </button>
          )}
        </span>
      );
    }
    return (
      <a className="sf-msg-file-link" href={href} download={p.name}>
        <span className="sf-msg-file-icon" aria-hidden>
          <IconFile width={18} height={18} />
        </span>
        <span className="sf-msg-file-name">{p.name}</span>
      </a>
    );
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onMessageContextMenu || loading || err) return;
    const dec = plain;
    if (!dec || dec.startsWith('Sent message (')) return;
    const p = parseDecryptedPayload(dec);
    const imgCtx = isImageOrGifFilePayload(p);
    if (!imgCtx && !isOwn) return;
    e.preventDefault();
    onMessageContextMenu(e, { message, plain: dec, isOwn });
  };

  const sender = message.sender;
  const senderLabel = sender?.username || '?';
  const senderAvatar = sender?.avatar;

  const bareVisualBubble =
    parsed &&
    ((parsed.kind === 'file' && isRichMediaMime(parsed.mime)) || parsed.kind === 'sticker');

  const lightboxNode =
    lightbox && mediaUrl
      ? createPortal(
          <div
            className="sf-media-lightbox"
            role="presentation"
            onClick={() => setLightbox(null)}
            onKeyDown={(e) => e.key === 'Escape' && setLightbox(null)}
          >
            {lightbox === 'image' ? (
              <img
                className="sf-media-lightbox-inner"
                src={mediaUrl}
                alt=""
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <video
                className="sf-media-lightbox-inner"
                src={mediaUrl}
                controls
                autoPlay
                playsInline
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <div
        className={`sf-msg-row ${isOwn ? 'sf-msg-row--own' : 'sf-msg-row--other'}`}
        data-msg-id={message.id}
      >
        {!isOwn ? (
          <AvatarBubble label={senderLabel} avatarUrl={senderAvatar} className="sf-avatar--msg" />
        ) : null}
        <div className="sf-msg-stack">
          <div
            className={`sf-msg-bubble ${isOwn ? 'sf-msg-bubble--own' : 'sf-msg-bubble--other'} ${
              err ? 'sf-msg-bubble--error' : ''
            } ${highlighted ? 'sf-msg-bubble--flash' : ''}${bareVisualBubble ? ' sf-msg-bubble--media' : ''}`}
            onContextMenu={handleContextMenu}
          >
            {body()}
          </div>
          <span className="sf-msg-time">{time}</span>
        </div>
        {isOwn ? (
          <AvatarBubble label={senderLabel} avatarUrl={senderAvatar} className="sf-avatar--msg" />
        ) : null}
      </div>
      {lightboxNode}
    </>
  );
};

export default MessageBubble;
