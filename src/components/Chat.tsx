import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Message, Conversation, User } from '../types';
import { messageService } from '../services/message';
import { cryptoService, CryptoService } from '../services/crypto';
import { websocketService } from '../services/websocket';
import MessageBubble, {
  parseDecryptedPayload,
  copySummaryFromPayload,
  editableTextFromPayload,
  isImageOrGifFilePayload,
  searchTextFromPayload,
} from './MessageBubble';
import ChatInput from './ChatInput';
import ChatOptionsMenu from './ChatOptionsMenu';
import ChatSearchPanel, { ChatSearchHit } from './ChatSearchPanel';
import { IconPhone, IconMoreVertical } from './icons';
import { t, membersLabel } from '../utils/i18n';
import { AvatarBubble } from '../utils/avatar';
import { savePlainToCache, plainCacheForOwnMessages } from '../utils/messagePlainCache';
import ConfirmDialog from './ConfirmDialog';
import { userError } from '../utils/userError';
import {
  filterMessagesAfterClear,
  mergeServerClearedAt,
  setConversationClearedNowLocal,
} from '../utils/convClear';
import {
  previewFromDecryptedPlain,
  previewFromMessageType,
  saveStoredPreview,
  truncatePreview,
} from '../utils/convPreview';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function buildTextPayloadFromEdit(originalPlain: string, newBody: string): string {
  const t = originalPlain.trimStart();
  if (t.startsWith('{')) {
    try {
      const o = JSON.parse(originalPlain) as Record<string, unknown>;
      if (o._sirius === 'textReply') {
        return JSON.stringify({
          _sirius: 'textReply',
          body: newBody,
          replyToId: o.replyToId,
          replySnippet: o.replySnippet,
        });
      }
    } catch {
      /* plain text */
    }
  }
  return newBody;
}

interface ChatProps {
  conversation: Conversation;
  currentUser: User;
  conversations: Conversation[];
  onStartCall: (opts?: { peerId?: string; conversation?: Conversation }) => void;
  onStartGroupCall?: (conversation: Conversation) => void;
  onOpenGroupSettings?: () => void;
  peerLocked?: boolean;
  notifyMuted?: boolean;
  onTogglePeerLock?: () => void;
  onToggleNotifyMute?: () => void;
  onSidebarPreview?: (conversationId: string, preview: string) => void;
}

function displayTitle(c: Conversation, self: User): string {
  const others = c.participants.filter((p) => p.id !== self.id);
  return c.name || others.map((p) => p.username).join(', ') || t('app.chatFallbackTitle');
}

function convTitleForForward(c: Conversation, self: User): string {
  return displayTitle(c, self);
}

function isActuallyOnline(user?: User): boolean {
  if (!user?.online) return false;
  const last = new Date(user.lastSeen || 0).getTime();
  if (!Number.isFinite(last) || last <= 0) return false;
  return Date.now() - last < 90 * 1000;
}

const Chat: React.FC<ChatProps> = ({
  conversation,
  currentUser,
  conversations,
  onStartCall,
  onStartGroupCall,
  onOpenGroupSettings,
  peerLocked,
  notifyMuted,
  onTogglePeerLock,
  onToggleNotifyMute,
  onSidebarPreview,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const loadingOlderRef = useRef(false);
  const nextOlderOffsetRef = useRef(0);
  const [sentPlaintext, setSentPlaintext] = useState<Record<string, string>>({});
  const [fullPlainById, setFullPlainById] = useState<Record<string, string>>({});
  const [textById, setTextById] = useState<Record<string, string>>({});

  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{
    id: string;
    snippet: string;
    kind?: 'text' | 'image' | 'video' | 'gif' | 'voice' | 'file' | 'sticker';
    mime?: string;
    name?: string;
    thumbB64?: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'clear' | 'delete'; messageId?: string }>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    messageId: string;
    plain: string;
    isOwn: boolean;
  } | null>(null);
  const [forwardMessageId, setForwardMessageId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);

  const others = conversation.participants.filter((p) => p.id !== currentUser.id);
  const canE2EEDM = !conversation.isGroup && others.length === 1;
  const canSendMessage = (canE2EEDM || conversation.isGroup) && !peerLocked;
  const title = displayTitle(conversation, currentUser);
  const peerOnline = others.length === 1 ? isActuallyOnline(others[0]) : false;
  const canCall = others.length >= 1;
  const headerAvatarUrl = conversation.isGroup
    ? conversation.avatar
    : others.length === 1
      ? others[0].avatar
      : undefined;
  const subtitle = conversation.isGroup
    ? typingUsers.size > 0
      ? t('chat.typing')
      : membersLabel(conversation.participants.length)
    : typingUsers.size > 0
      ? t('chat.typing')
      : peerOnline
        ? t('app.profile.online')
        : t('app.profile.offline');

  const onPlaintext = useCallback((id: string, text: string) => {
    setTextById((prev) => (prev[id] === text ? prev : { ...prev, [id]: text }));
  }, []);

  const onFullPlaintext = useCallback((id: string, plain: string) => {
    setFullPlainById((prev) => (prev[id] === plain ? prev : { ...prev, [id]: plain }));
  }, []);

  const getStoredPlain = useCallback(
    (messageId: string) => sentPlaintext[messageId] ?? fullPlainById[messageId],
    [sentPlaintext, fullPlainById]
  );

  const decryptPlainForMessage = useCallback(
    async (msg: Message): Promise<string | null> => {
      const gid = conversation.isGroup ? conversation.id : undefined;
      try {
        if (gid && msg.senderKey === CryptoService.GROUP_SENDER_KEY) {
          return await cryptoService.decryptGroupMessage(msg.encryptedContent, msg.iv, gid);
        }
        if (gid) {
          try {
            return await cryptoService.decryptMessage(msg.encryptedContent, msg.iv, msg.senderKey);
          } catch {
            return await cryptoService.decryptGroupMessage(msg.encryptedContent, msg.iv, gid);
          }
        }
        return await cryptoService.decryptMessage(msg.encryptedContent, msg.iv, msg.senderKey);
      } catch {
        return null;
      }
    },
    [conversation.isGroup, conversation.id]
  );

  const resolvePlainForOps = useCallback(
    async (messageId: string): Promise<string | null> => {
      const cached = getStoredPlain(messageId);
      if (cached && !cached.startsWith('Sent message (')) return cached;
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return null;
      const dec = await decryptPlainForMessage(msg);
      if (dec) {
        setFullPlainById((prev) => ({ ...prev, [messageId]: dec }));
        const p = parseDecryptedPayload(dec);
        setTextById((prev) => ({ ...prev, [messageId]: searchTextFromPayload(p) }));
      }
      return dec;
    },
    [getStoredPlain, messages, decryptPlainForMessage]
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMore) return;
    loadingOlderRef.current = true;
    setLoading(true);
    setLoadErr(null);
    try {
      const off = nextOlderOffsetRef.current;
      const batch = await messageService.getMessages(conversation.id, 50, off);
      const chronological = [...batch].reverse();
      const filtered = filterMessagesAfterClear(conversation.id, chronological);
      if (batch.length < 50) setHasMore(false);
      nextOlderOffsetRef.current = off + batch.length;
      const olderCache = plainCacheForOwnMessages(filtered, currentUser.id);
      setSentPlaintext((prev) => ({ ...olderCache, ...prev }));
      setMessages((prev) => [...filtered, ...prev]);
    } catch (error) {
      setLoadErr(userError(error, 'error.network'));
    } finally {
      setLoading(false);
      loadingOlderRef.current = false;
    }
  }, [conversation.id, hasMore, currentUser.id]);

  useEffect(() => {
    if (conversation.myClearedAt) {
      mergeServerClearedAt(conversation.id, conversation.myClearedAt);
    }
  }, [conversation.id, conversation.myClearedAt]);

  useEffect(() => {
    setMessages([]);
    setHasMore(true);
    setSentPlaintext({});
    setFullPlainById({});
    setTextById({});
    setLoadErr(null);
    nextOlderOffsetRef.current = 0;
    setSearchOpen(false);
    setSearchQuery('');
    setHighlightedId(null);
    setMenuOpen(false);
    setReplyTo(null);
    setCtxMenu(null);
    setForwardMessageId(null);
    setEditing(null);
    setLoading(true);
    messageService
      .getMessages(conversation.id, 50, 0)
      .then((batch) => {
        const chronological = [...batch].reverse();
        const filtered = filterMessagesAfterClear(conversation.id, chronological);
        const fromCache = plainCacheForOwnMessages(filtered, currentUser.id);
        setSentPlaintext(fromCache);
        setMessages(filtered);
        nextOlderOffsetRef.current = batch.length;
        if (batch.length < 50) setHasMore(false);
      })
      .catch((e) => setLoadErr(userError(e, 'error.network')))
      .finally(() => setLoading(false));
  }, [conversation.id, currentUser.id]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!onSidebarPreview) return;
    if (loading) return;
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    let line: string;
    if (last.senderId === currentUser.id) {
      const sp = sentPlaintext[last.id];
      line = sp ? previewFromDecryptedPlain(sp) : previewFromMessageType(last.messageType);
    } else {
      const tb = textById[last.id];
      line = tb ? truncatePreview(tb) : previewFromMessageType(last.messageType);
    }
    saveStoredPreview(conversation.id, line);
    onSidebarPreview(conversation.id, line);
  }, [
    messages,
    sentPlaintext,
    textById,
    conversation.id,
    loading,
    currentUser.id,
    onSidebarPreview,
  ]);

  useEffect(() => {
    const onMessage = (message: Message) => {
      if (message.conversationId !== conversation.id) return;
      const cleared = filterMessagesAfterClear(conversation.id, [message]);
      if (cleared.length === 0) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
      if (message.senderId === currentUser.id) {
        const cache = plainCacheForOwnMessages([message], currentUser.id);
        const hit = cache[message.id];
        if (hit) {
          setSentPlaintext((p) => ({ ...p, [message.id]: hit }));
        }
      }
    };

    const onTyping = (data: { conversationId: string; userId: string; isTyping: boolean }) => {
      if (data.conversationId !== conversation.id) return;
      setTypingUsers((prev) => {
        const next = new Set(prev);
        if (data.isTyping) next.add(data.userId);
        else next.delete(data.userId);
        return next;
      });
    };

    const unsubMsg = websocketService.onMessage(onMessage);
    websocketService.onTyping(onTyping);

    return () => {
      unsubMsg();
      websocketService.offTyping();
    };
  }, [conversation.id, currentUser.id]);

  useEffect(() => {
    const unsubU = websocketService.onMessageUpdated((msg) => {
      if (msg.conversationId !== conversation.id) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msg.id
            ? {
                ...msg,
                sender: msg.sender && msg.sender.id ? msg.sender : m.sender,
              }
            : m
        )
      );
    });
    const unsubD = websocketService.onMessageDeleted((p) => {
      if (p.conversationId !== conversation.id) return;
      setMessages((prev) => prev.filter((m) => m.id !== p.id));
      setSentPlaintext((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      setFullPlainById((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
    });
    return () => {
      unsubU();
      unsubD();
    };
  }, [conversation.id]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [ctxMenu]);

  const encryptPlainString = useCallback(
    async (
      payload: string
    ): Promise<
      | { encryptedContent: string; iv: string; encryptedKey: string }
      | { encryptedContent: string; iv: string; senderKey: string }
    > => {
      if (canE2EEDM) {
        return cryptoService.encryptMessage(payload, others[0].publicKey);
      }
      return cryptoService.encryptGroupMessage(payload, conversation.id);
    },
    [canE2EEDM, others, conversation.id]
  );

  const encryptForConversation = useCallback(
    async (
      target: Conversation,
      payload: string
    ): Promise<
      | { encryptedContent: string; iv: string; encryptedKey: string }
      | { encryptedContent: string; iv: string; senderKey: string }
    > => {
      const o = target.participants.filter((p) => p.id !== currentUser.id);
      const targetDm = !target.isGroup && o.length === 1;
      if (targetDm) {
        return cryptoService.encryptMessage(payload, o[0].publicKey);
      }
      return cryptoService.encryptGroupMessage(payload, target.id);
    },
    [currentUser.id]
  );

  const handleSendMessage = async (text: string) => {
    if (!canSendMessage) return;
    let payload = text;
    if (replyTo) {
      payload = JSON.stringify({
        _sirius: 'textReply',
        body: text,
        replyToId: replyTo.id,
        replySnippet: replyTo.snippet.slice(0, 200),
        replyKind: replyTo.kind,
        replyMime: replyTo.mime,
        replyName: replyTo.name,
        replyThumbB64: replyTo.thumbB64,
      });
    }
    const enc = await encryptPlainString(payload);
    const senderKey = 'encryptedKey' in enc ? enc.encryptedKey : enc.senderKey;
    const message = await messageService.sendMessage(
      conversation.id,
      enc.encryptedContent,
      enc.iv,
      senderKey,
      'text'
    );
    // Persist own plaintext immediately so UI never tries to decrypt own DM payloads.
    setSentPlaintext((prev) => ({ ...prev, [message.id]: payload }));
    savePlainToCache(message.id, payload);
    setFullPlainById((prev) => ({ ...prev, [message.id]: payload }));
    const parsed = parseDecryptedPayload(payload);
    setTextById((prev) => ({ ...prev, [message.id]: searchTextFromPayload(parsed) }));
    setReplyTo(null);
    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    const preview = previewFromDecryptedPlain(payload);
    saveStoredPreview(conversation.id, preview);
    onSidebarPreview?.(conversation.id, preview);
  };

  const handleSendVoice = async (blob: Blob, mimeType: string) => {
    if (!canSendMessage) return;
    const b64 = arrayBufferToBase64(await blob.arrayBuffer());
    const json = JSON.stringify({ _sirius: 'voice', mime: mimeType || blob.type || 'audio/webm', b64 });
    const enc = await encryptPlainString(json);
    const senderKey = 'encryptedKey' in enc ? enc.encryptedKey : enc.senderKey;
    const message = await messageService.sendMessage(
      conversation.id,
      enc.encryptedContent,
      enc.iv,
      senderKey,
      'voice'
    );
    setSentPlaintext((prev) => ({ ...prev, [message.id]: json }));
    savePlainToCache(message.id, json);
    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
  };

  const handleSendFile = async (file: File) => {
    if (!canSendMessage) return;
    const tempId = `local-file-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const mime = file.type || 'application/octet-stream';
    const optimistic = JSON.stringify({
      _sirius: 'file',
      name: file.name,
      mime,
      size: file.size,
      uploading: true,
      progress: 0,
    });
    const placeholder: Message = {
      id: tempId,
      conversationId: conversation.id,
      senderId: currentUser.id,
      encryptedContent: '',
      iv: '',
      senderKey: '',
      messageType: 'file',
      createdAt: new Date().toISOString(),
      sender: currentUser as any,
    };
    setSentPlaintext((prev) => ({ ...prev, [tempId]: optimistic }));
    setMessages((prev) => [...prev, placeholder]);

    try {
      const uploaded = await messageService.uploadFile(file, conversation.id, (p) => {
        const next = JSON.stringify({
          _sirius: 'file',
          name: file.name,
          mime,
          size: file.size,
          uploading: true,
          progress: p,
        });
        setSentPlaintext((prev) => (prev[tempId] === next ? prev : { ...prev, [tempId]: next }));
      });

      const json = JSON.stringify({
        _sirius: 'file',
        name: uploaded.name || file.name,
        mime: uploaded.mime || mime,
        size: uploaded.size || file.size,
        fileId: uploaded.id,
        url: uploaded.fileLink,
      });
      const enc = await encryptPlainString(json);
      const senderKey = 'encryptedKey' in enc ? enc.encryptedKey : enc.senderKey;
      const message = await messageService.sendMessage(
        conversation.id,
        enc.encryptedContent,
        enc.iv,
        senderKey,
        'file'
      );
      setSentPlaintext((prev) => {
        const next = { ...prev };
        delete next[tempId];
        next[message.id] = json;
        return next;
      });
      savePlainToCache(message.id, json);
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== tempId);
        return filtered.some((m) => m.id === message.id) ? filtered : [...filtered, message];
      });
    } catch {
      const failed = JSON.stringify({
        _sirius: 'file',
        name: file.name,
        mime,
        size: file.size,
        uploading: false,
        failed: true,
      });
      setSentPlaintext((prev) => ({ ...prev, [tempId]: failed }));
    }
  };

  const handleSendSticker = async (char: string) => {
    if (!canSendMessage || !char) return;
    const json = JSON.stringify({ _sirius: 'sticker', char });
    const enc = await encryptPlainString(json);
    const senderKey = 'encryptedKey' in enc ? enc.encryptedKey : enc.senderKey;
    const message = await messageService.sendMessage(
      conversation.id,
      enc.encryptedContent,
      enc.iv,
      senderKey,
      'sticker'
    );
    setSentPlaintext((prev) => ({ ...prev, [message.id]: json }));
    savePlainToCache(message.id, json);
    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
  };

  const handleTyping = (isTyping: boolean) => {
    websocketService.sendTyping(conversation.id, isTyping);
  };

  const doClearChat = () => {
    setConversationClearedNowLocal(conversation.id);
    setMessages([]);
    setSentPlaintext({});
    setFullPlainById({});
    setTextById({});
    void messageService.clearConversationHistory(conversation.id).catch(console.error);
  };

  const handleClearChat = () => setConfirm({ kind: 'clear' });

  const searchHits: ChatSearchHit[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages
      .map((m) => {
        const t =
          m.senderId === currentUser.id ? sentPlaintext[m.id] ?? textById[m.id] : textById[m.id];
        if (!t || !t.toLowerCase().includes(q)) return null;
        const idx = t.toLowerCase().indexOf(q);
        const start = Math.max(0, idx - 24);
        const chunk = t.slice(start, start + 96);
        const snippet = (start > 0 ? '…' : '') + chunk + (start + 96 < t.length ? '…' : '');
        return { id: m.id, snippet };
      })
      .filter(Boolean) as ChatSearchHit[];
  }, [messages, searchQuery, sentPlaintext, textById, currentUser.id]);

  const pickSearchHit = (id: string) => {
    setHighlightedId(id);
    setSearchQuery('');
    setSearchOpen(false);
    requestAnimationFrame(() => {
      const safe =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(id)
          : id.replace(/"/g, '\\"');
      document.querySelector(`[data-msg-id="${safe}"]`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
    window.setTimeout(() => setHighlightedId(null), 2000);
  };

  const jumpToMessage = useCallback((id: string) => {
    setHighlightedId(id);
    requestAnimationFrame(() => {
      const safe =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(id)
          : id.replace(/"/g, '\\"');
      document.querySelector(`[data-msg-id="${safe}"]`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
    window.setTimeout(() => setHighlightedId(null), 1200);
  }, []);

  const startCallClick = () => {
    if (!canCall) return;
    if (conversation.isGroup) {
      onStartGroupCall?.(conversation);
      return;
    }
    onStartCall({ conversation });
  };

  const onMessageContextMenu = useCallback(
    (e: React.MouseEvent, ctx: { message: Message; plain: string; isOwn: boolean }) => {
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        messageId: ctx.message.id,
        plain: ctx.plain,
        isOwn: ctx.isOwn,
      });
    },
    []
  );

  const closeCtxMenu = () => setCtxMenu(null);

  const ctxPlain = ctxMenu ? ctxMenu.plain : '';
  const ctxParsed = ctxPlain ? parseDecryptedPayload(ctxPlain) : null;
  const canEditCtx = ctxParsed?.kind === 'text';
  const showDownloadCtx = ctxParsed ? isImageOrGifFilePayload(ctxParsed) : false;

  const handleCtxDownload = () => {
    if (!ctxMenu) return;
    const p = parseDecryptedPayload(ctxMenu.plain);
    if (p.kind !== 'file') return;
    const a = document.createElement('a');
    a.href = `data:${p.mime};base64,${p.b64}`;
    a.download = p.name || 'image';
    a.click();
    closeCtxMenu();
  };

  const handleCtxCopy = async () => {
    if (!ctxMenu) return;
    try {
      await navigator.clipboard.writeText(copySummaryFromPayload(parseDecryptedPayload(ctxMenu.plain)));
    } catch {
      alert(t('msg.copyFail'));
    }
    closeCtxMenu();
  };

  const handleCtxReply = () => {
    if (!ctxMenu || !ctxMenu.isOwn) return;
    const p = parseDecryptedPayload(ctxMenu.plain);
    let kind: any = undefined;
    let mime: string | undefined;
    let name: string | undefined;
    let thumbB64: string | undefined;
    if (p.kind === 'file') {
      mime = p.mime;
      name = p.name;
      const m = p.mime.toLowerCase();
      if (m === 'image/gif') {
        kind = 'gif';
        thumbB64 = p.b64;
      } else if (m.startsWith('image/')) {
        kind = 'image';
        thumbB64 = p.b64;
      } else if (m.startsWith('video/')) {
        kind = 'video';
      } else {
        kind = 'file';
      }
    } else if (p.kind === 'voice') {
      kind = 'voice';
      mime = p.mime;
    } else if (p.kind === 'sticker') {
      kind = 'sticker';
    } else {
      kind = 'text';
    }
    setReplyTo({
      id: ctxMenu.messageId,
      snippet: copySummaryFromPayload(p).slice(0, 120),
      kind,
      mime,
      name,
      thumbB64,
    });
    closeCtxMenu();
  };

  const handleCtxForward = () => {
    if (!ctxMenu || !ctxMenu.isOwn) return;
    setForwardMessageId(ctxMenu.messageId);
    closeCtxMenu();
  };

  const handleCtxEdit = () => {
    if (!ctxMenu || !ctxMenu.isOwn || !canEditCtx) return;
    const ed = editableTextFromPayload(ctxMenu.plain, parseDecryptedPayload(ctxMenu.plain));
    if (ed == null) return;
    setEditing({ id: ctxMenu.messageId, draft: ed });
    closeCtxMenu();
  };

  const handleCtxDelete = async () => {
    if (!ctxMenu || !ctxMenu.isOwn) return;
    setConfirm({ kind: 'delete', messageId: ctxMenu.messageId });
    closeCtxMenu();
  };

  const confirmDelete = async (messageId: string) => {
    try {
      await messageService.deleteMessage(conversation.id, messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      setSentPlaintext((prev) => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
      setFullPlainById((prev) => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
    } catch (err) {
      console.error(err);
      alert(t('msg.deleteFail'));
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const msg = messages.find((m) => m.id === editing.id);
    if (!msg) {
      setEditing(null);
      return;
    }
    let originalPlain = getStoredPlain(editing.id);
    if (!originalPlain || originalPlain.startsWith('Sent message (')) {
      const d = await resolvePlainForOps(editing.id);
      if (!d) {
        alert(t('msg.loadOriginalFail'));
        setEditing(null);
        return;
      }
      originalPlain = d;
    }
    const newPayload = buildTextPayloadFromEdit(originalPlain, editing.draft.trim());
    if (!newPayload.trim()) {
      alert(t('msg.emptyNotAllowed'));
      return;
    }
    try {
      const enc = await encryptPlainString(newPayload);
      const senderKey = 'encryptedKey' in enc ? enc.encryptedKey : enc.senderKey;
      const updated = await messageService.updateMessage(
        conversation.id,
        editing.id,
        enc.encryptedContent,
        enc.iv,
        senderKey,
        msg.messageType
      );
      setSentPlaintext((prev) => ({ ...prev, [editing.id]: newPayload }));
      savePlainToCache(editing.id, newPayload);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === updated.id
            ? {
                ...updated,
                sender: updated.sender && updated.sender.id ? updated.sender : m.sender,
              }
            : m
        )
      );
      setEditing(null);
    } catch (err) {
      console.error(err);
      alert(t('msg.saveEditFail'));
    }
  };

  const doForward = async (target: Conversation) => {
    if (!forwardMessageId) return;
    const plain = await resolvePlainForOps(forwardMessageId);
    if (!plain) {
      alert(t('msg.forwardNotReady'));
      return;
    }
    const src = messages.find((m) => m.id === forwardMessageId);
    try {
      const enc = await encryptForConversation(target, plain);
      const senderKey = 'encryptedKey' in enc ? enc.encryptedKey : enc.senderKey;
      const message = await messageService.sendMessage(
        target.id,
        enc.encryptedContent,
        enc.iv,
        senderKey,
        src?.messageType ?? 'text'
      );
      savePlainToCache(message.id, plain);
      if (target.id === conversation.id) {
        setSentPlaintext((prev) => ({ ...prev, [message.id]: plain }));
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      }
      const pv = previewFromDecryptedPlain(plain);
      saveStoredPreview(target.id, pv);
      onSidebarPreview?.(target.id, pv);
      setForwardMessageId(null);
    } catch (err) {
      console.error(err);
      alert(t('msg.forwardFail'));
    }
  };

  const forwardTargets = useMemo(
    () => conversations.filter((c) => c.id !== conversation.id),
    [conversations, conversation.id]
  );

  const ctxMenuPortal =
    ctxMenu &&
    createPortal(
      <div
        className="sf-msg-ctx-menu"
        role="menu"
        style={{ left: ctxMenu.x, top: ctxMenu.y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {showDownloadCtx ? (
          <button type="button" className="sf-msg-ctx-item" role="menuitem" onClick={handleCtxDownload}>
            {t('msg.download')}
          </button>
        ) : null}
        {ctxMenu?.isOwn && canEditCtx ? (
          <button type="button" className="sf-msg-ctx-item" role="menuitem" onClick={handleCtxEdit}>
            {t('msg.edit')}
          </button>
        ) : null}
        {ctxMenu?.isOwn ? (
          <button type="button" className="sf-msg-ctx-item" role="menuitem" onClick={() => void handleCtxCopy()}>
            {t('msg.copy')}
          </button>
        ) : null}
        {ctxMenu?.isOwn ? (
          <button type="button" className="sf-msg-ctx-item" role="menuitem" onClick={handleCtxForward}>
            {t('msg.forward')}
          </button>
        ) : null}
        {ctxMenu?.isOwn ? (
          <button type="button" className="sf-msg-ctx-item" role="menuitem" onClick={handleCtxReply}>
            {t('msg.reply')}
          </button>
        ) : null}
        {ctxMenu?.isOwn ? (
          <button type="button" className="sf-msg-ctx-item sf-msg-ctx-item--danger" role="menuitem" onClick={() => void handleCtxDelete()}>
            {t('common.remove')}
          </button>
        ) : null}
      </div>,
      document.body
    );

  const forwardPortal =
    forwardMessageId &&
    createPortal(
      <div
        className="sf-forward-modal-overlay"
        role="presentation"
        onClick={() => setForwardMessageId(null)}
      >
        <div
          className="sf-forward-modal"
          role="dialog"
          aria-label={t('msg.forwardDialogAria')}
          onClick={(e) => e.stopPropagation()}
        >
          <h3>{t('msg.forwardTo')}</h3>
          <ul className="sf-forward-list">
            {forwardTargets.map((c) => (
              <li key={c.id}>
                <button type="button" className="sf-forward-item" onClick={() => void doForward(c)}>
                  <AvatarBubble
                    label={convTitleForForward(c, currentUser)}
                    avatarUrl={c.isGroup ? c.avatar : c.participants.find((p) => p.id !== currentUser.id)?.avatar}
                    className="sf-avatar--sm"
                  />
                  <span>{convTitleForForward(c, currentUser)}</span>
                </button>
              </li>
            ))}
          </ul>
          {forwardTargets.length === 0 ? (
            <p style={{ color: 'var(--sf-zinc-500)', fontSize: '0.875rem' }}>{t('msg.noOtherChats')}</p>
          ) : null}
          <button
            type="button"
            className="sf-btn sf-btn--ghost sf-btn--small"
            style={{ marginTop: '0.75rem' }}
            onClick={() => setForwardMessageId(null)}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>,
      document.body
    );

  const editPortal =
    editing &&
    createPortal(
      <div className="sf-edit-msg-overlay" role="presentation" onClick={() => setEditing(null)}>
        <div
          className="sf-edit-msg-modal"
          role="dialog"
          aria-label={t('msg.editDialogAria')}
          onClick={(e) => e.stopPropagation()}
        >
          <h3>{t('msg.editTitle')}</h3>
          <textarea
            value={editing.draft}
            onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
            autoFocus
          />
          <div className="sf-edit-msg-actions">
            <button type="button" className="sf-btn sf-btn--ghost sf-btn--small" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="sf-btn sf-btn--small" onClick={() => void saveEdit()}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>,
      document.body
    );

  return (
    <div className="sf-chat">
      <ConfirmDialog
        isOpen={!!confirm}
        title={confirm?.kind === 'delete' ? t('chat.deleteMsgTitle') : t('chat.clearChatTitle')}
        message={
          confirm?.kind === 'delete'
            ? t('chat.deleteMsgConfirm')
            : t('chat.clearChatConfirm')
        }
        confirmText={confirm?.kind === 'delete' ? t('common.remove') : t('chat.clearChat')}
        cancelText={t('common.cancel')}
        danger
        busy={confirmBusy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === 'clear') {
            setConfirmBusy(true);
            try {
              doClearChat();
            } finally {
              setConfirmBusy(false);
              setConfirm(null);
            }
            return;
          }
          if (confirm.kind === 'delete' && confirm.messageId) {
            setConfirmBusy(true);
            void confirmDelete(confirm.messageId)
              .finally(() => {
                setConfirmBusy(false);
                setConfirm(null);
              });
          }
        }}
      />
      <header className="sf-chat-header">
        <div
          className={`sf-chat-header-user${conversation.isGroup && onOpenGroupSettings ? ' sf-chat-header-user--clickable' : ''}`}
          role={conversation.isGroup && onOpenGroupSettings ? 'button' : undefined}
          tabIndex={conversation.isGroup && onOpenGroupSettings ? 0 : undefined}
          onClick={() => conversation.isGroup && onOpenGroupSettings?.()}
          onKeyDown={(e) => {
            if (!conversation.isGroup || !onOpenGroupSettings) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpenGroupSettings();
            }
          }}
        >
          <AvatarBubble
            label={title}
            avatarUrl={headerAvatarUrl}
            className="sf-avatar--sm"
            online={!conversation.isGroup && peerOnline}
          />
          <div className="sf-chat-header-text">
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
        </div>
        <div className="sf-chat-header-actions">
          <button
            type="button"
            className="sf-icon-btn"
            title={conversation.isGroup ? t('chat.groupCall') : t('chat.voiceCall')}
            aria-label={conversation.isGroup ? t('chat.groupCall') : t('chat.voiceCall')}
            disabled={!canCall}
            onClick={startCallClick}
          >
            <IconPhone width={20} height={20} />
          </button>
          <button
            ref={menuBtnRef}
            type="button"
            className="sf-icon-btn"
            title={t('chat.more')}
            aria-label={t('chat.more')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <IconMoreVertical width={20} height={20} />
          </button>
        </div>
        <ChatOptionsMenu
          isOpen={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchorRef={menuBtnRef}
          onOpenSearch={() => setSearchOpen(true)}
          onClearChat={handleClearChat}
          showNotifyMute={!!onToggleNotifyMute}
          notifyMuted={notifyMuted}
          onToggleNotifyMute={onToggleNotifyMute}
          showPeerLock={!!(onTogglePeerLock && canE2EEDM && others[0])}
          peerLocked={peerLocked}
          onTogglePeerLock={onTogglePeerLock}
        />
      </header>

      <ChatSearchPanel
        isOpen={searchOpen}
        onClose={() => {
          setSearchOpen(false);
          setSearchQuery('');
        }}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        hits={searchHits}
        onPickHit={pickSearchHit}
      />

      <div
        className="sf-messages"
        onScroll={(e) => {
          if (e.currentTarget.scrollTop === 0 && hasMore && !loading) {
            loadOlder();
          }
        }}
      >
        {loadErr ? <div className="sf-chat-notice">{loadErr}</div> : null}
        {loading && messages.length === 0 && (
          <div className="sf-loading-msg">{t('chat.loading')}</div>
        )}
        {loading && messages.length > 0 && (
          <div className="sf-loading-msg">{t('chat.loadingOlder')}</div>
        )}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            isOwn={message.senderId === currentUser.id}
            localPlaintext={sentPlaintext[message.id]}
            searchQuery={searchQuery}
            highlighted={highlightedId === message.id}
            onPlaintext={onPlaintext}
            onFullPlaintext={onFullPlaintext}
            onMessageContextMenu={onMessageContextMenu}
            groupConversationId={conversation.isGroup ? conversation.id : undefined}
            onJumpToMessage={jumpToMessage}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        onSendMessage={handleSendMessage}
        onSendVoice={handleSendVoice}
        onSendFile={handleSendFile}
        onSendSticker={handleSendSticker}
        onTyping={handleTyping}
        disabled={!canSendMessage}
        disabledHint={
          peerLocked
            ? t('chat.disabledLockedHint')
            : !canSendMessage
              ? t('chat.disabledCannotSend')
              : undefined
        }
        replyPreview={
          replyTo
            ? {
                snippet: replyTo.snippet,
                kind: replyTo.kind,
                mime: replyTo.mime,
                thumbB64: replyTo.thumbB64,
              }
            : null
        }
        onReplyPreviewClick={() => {
          if (!replyTo) return;
          jumpToMessage(replyTo.id);
        }}
        onReplyCancel={() => setReplyTo(null)}
      />

      {ctxMenuPortal}
      {forwardPortal}
      {editPortal}
    </div>
  );
};

export default Chat;
