import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import './App.css';
import { authService } from './services/auth';
import { cryptoService } from './services/crypto';
import { messageService } from './services/message';
import { websocketService } from './services/websocket';
import { User, Conversation, Message, FriendRequest } from './types';
import Chat from './components/Chat';
import AuthScreen from './components/AuthScreen';
import AddFriendWindow from './components/AddFriendWindow';
import ConfirmDialog from './components/ConfirmDialog';
import CreateGroupWindow from './components/CreateGroupWindow';
import SettingsWindow from './components/SettingsWindow';
import GroupChatSettingsWindow from './components/GroupChatSettingsWindow';
import CallWindow, { CallSessionProps } from './components/CallWindow';
import GroupCallWindow from './components/GroupCallWindow';
import { IconSearch, IconSettings, IconFriends, IconUsers, IconPhone, IconPhoneHangup } from './components/icons';
import { AvatarBubble } from './utils/avatar';
import { applySiriusTheme, readStoredTheme, writeStoredTheme, SiriusTheme } from './utils/theme';
import {
  isConversationNotifyMuted,
  setConversationNotifyMuted,
  isUserBlocked,
  setUserBlocked,
} from './utils/chatPrefs';
import { mergeServerClearedAt } from './utils/convClear';
import { getStoredLang, t } from './utils/i18n';
import { userError } from './utils/userError';
import {
  loadStoredPreview,
  previewForWsMessage,
  previewFromMessageType,
  saveStoredPreview,
} from './utils/convPreview';

function readStoredUser(): User | null {
  try {
    const raw = localStorage.getItem('sirius_user');
    if (!raw) return null;
    const u = JSON.parse(raw) as Partial<User>;
    if (!u.id || !u.username || !u.email || !u.publicKey) return null;
    return {
      id: u.id,
      username: u.username,
      discriminator: u.discriminator || '0000',
      email: u.email,
      avatar: u.avatar,
      online: !!u.online,
      lastSeen: u.lastSeen || new Date(0).toISOString(),
      publicKey: u.publicKey,
    };
  } catch {
    return null;
  }
}

function convDisplayTitle(c: Conversation, selfId: string): string {
  return (
    c.name ||
    c.participants
      .filter((p) => p.id !== selfId)
      .map((p) => p.username)
      .join(', ') ||
    t('app.chatFallbackTitle')
  );
}

function formatSidebarTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (sameDay) {
    return d.toLocaleTimeString(getStoredLang() === 'ru' ? 'ru-RU' : 'en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString(getStoredLang() === 'ru' ? 'ru-RU' : 'en-US', { month: 'short', day: 'numeric' });
}

function isActuallyOnline(user?: User): boolean {
  if (!user?.online) return false;
  const last = new Date(user.lastSeen || 0).getTime();
  if (!Number.isFinite(last) || last <= 0) return false;
  return Date.now() - last < 90 * 1000;
}

type IncomingRing = {
  callerId: string;
  conversationId: string;
  offer: RTCSessionDescriptionInit;
};

type OutgoingCall = {
  conversationId: string;
  peerId: string;
};

type ActiveGroupCall = {
  callId: string;
  conversationId: string;
  memberIds: string[];
  initiatorId: string;
};

type IncomingGroupInvite = {
  callId: string;
  conversationId: string;
  memberIds: string[];
  initiatorId: string;
};

function readHiddenConvIds(): string[] {
  try {
    const raw = localStorage.getItem('sirius_hidden_convs');
    if (!raw) return [];
    const a = JSON.parse(raw) as string[];
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function writeHiddenConvIds(ids: string[]) {
  localStorage.setItem('sirius_hidden_convs', JSON.stringify(ids));
}

function App() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [currentUser, setCurrentUser] = useState<User | null>(() =>
    authService.isLoggedIn() ? readStoredUser() : null
  );
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [friends, setFriends] = useState<User[]>([]);
  const [friendIncoming, setFriendIncoming] = useState<FriendRequest[]>([]);
  const [friendOutgoing, setFriendOutgoing] = useState<FriendRequest[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [sidebarQuery, setSidebarQuery] = useState('');

  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [appearanceTheme, setAppearanceTheme] = useState<SiriusTheme>(() => readStoredTheme());

  const [incomingRing, setIncomingRing] = useState<IncomingRing | null>(null);
  const [outgoingCall, setOutgoingCall] = useState<OutgoingCall | null>(null);
  const [activeCall, setActiveCall] = useState<Omit<CallSessionProps, 'onClose'> | null>(null);
  const [activeGroupCall, setActiveGroupCall] = useState<ActiveGroupCall | null>(null);
  const [incomingGroupInvite, setIncomingGroupInvite] = useState<IncomingGroupInvite | null>(null);
  const [hiddenConvIds, setHiddenConvIds] = useState<string[]>(() => readHiddenConvIds());
  const [convCtx, setConvCtx] = useState<{ x: number; y: number; conv: Conversation } | null>(null);
  const [deleteChatConfirm, setDeleteChatConfirm] = useState<Conversation | null>(null);
  const [prefsTick, setPrefsTick] = useState(0);
  const [uiLocale, setUiLocale] = useState(0);
  const [sidebarPreviewByConv, setSidebarPreviewByConv] = useState<Record<string, string>>({});

  const callBlockRef = useRef(false);
  callBlockRef.current = !!(
    outgoingCall ||
    activeCall ||
    incomingRing ||
    activeGroupCall ||
    incomingGroupInvite
  );

  const endAllCallUi = useCallback(() => {
    setOutgoingCall(null);
    setActiveCall(null);
    setIncomingRing(null);
    setActiveGroupCall(null);
    setIncomingGroupInvite(null);
  }, []);

  const refreshLists = useCallback(async () => {
    const [conv, u, f, fr] = await Promise.all([
      messageService.getConversations(),
      messageService.getUsers(),
      messageService.getFriends(),
      messageService.getFriendRequests(),
    ]);
    conv.forEach((c) => {
      if (c.myClearedAt) mergeServerClearedAt(c.id, c.myClearedAt);
    });
    setConversations(conv);
    setUsers(u);
    setFriends(f);
    setFriendIncoming(fr.incoming);
    setFriendOutgoing(fr.outgoing);
  }, []);

  const onSidebarPreview = useCallback((conversationId: string, preview: string) => {
    setSidebarPreviewByConv((prev) =>
      prev[conversationId] === preview ? prev : { ...prev, [conversationId]: preview }
    );
  }, []);

  useEffect(() => {
    document.title = 'Sirius';
  }, []);

  useEffect(() => {
    applySiriusTheme(appearanceTheme);
    writeStoredTheme(appearanceTheme);
  }, [appearanceTheme]);

  useEffect(() => {
    if (appearanceTheme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => applySiriusTheme('system');
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [appearanceTheme]);

useEffect(() => {
  authService.restoreSession();
  if (!authService.isLoggedIn()) return;

  const u = readStoredUser();
  if (!u) {
    authService.logout();
    cryptoService.clearActivePrivateKeyFromMemory();
    return;
  }
  setCurrentUser(u);
  cryptoService.loadPrivateKeyFromStorage(u.id);  // ← ВОТ ЭТУ СТРОКУ ДОБАВЬТЕ

  const token = authService.getToken();
  if (token) websocketService.connect(token);

  refreshLists().catch(() => {
    authService.logout();
    cryptoService.clearActivePrivateKeyFromMemory();
    setCurrentUser(null);
  });
}, [refreshLists]);

  useEffect(() => {
    const uid = currentUser?.id;
    if (!uid) return;

    const onOffer = (data: {
      calleeId?: string;
      callerId?: string;
      conversationId?: string;
      encryptedOffer?: RTCSessionDescriptionInit;
      groupCallId?: string;
    }) => {
      if (data.groupCallId) return;
      if (data.calleeId !== uid || !data.encryptedOffer || !data.conversationId) return;
      if (callBlockRef.current) return;
      setIncomingRing({
        callerId: data.callerId!,
        conversationId: data.conversationId,
        offer: data.encryptedOffer,
      });
    };

    websocketService.onCallOffer(onOffer);
    return () => websocketService.offCallOffer();
  }, [currentUser?.id]);

  useEffect(() => {
    const uid = currentUser?.id;
    if (!uid) return;
    const unsub = websocketService.onCallEnd((data: { targetId?: string; conversationId?: string }) => {
      if (data.targetId !== uid) return;
      if (data.conversationId && outgoingCall && outgoingCall.conversationId !== data.conversationId) return;
      endAllCallUi();
    });
    return () => unsub();
  }, [currentUser?.id, outgoingCall, endAllCallUi]);

  useEffect(() => {
    const uid = currentUser?.id;
    if (!uid) return;
    const unsub = websocketService.onGroupCallInvite(
      (data: {
        conversationId?: string;
        callId?: string;
        memberIds?: string[];
        initiatorId?: string;
        fromUserId?: string;
      }) => {
        const from = data.fromUserId || data.initiatorId;
        if (!from || from === uid) return;
        if (callBlockRef.current) return;
        if (!data.conversationId || !data.callId || !data.memberIds?.length) return;
        setIncomingGroupInvite({
          callId: data.callId,
          conversationId: data.conversationId,
          memberIds: data.memberIds,
          initiatorId: from,
        });
      }
    );
    return () => unsub();
  }, [currentUser?.id]);

  useEffect(() => {
    if (!selected?.isGroup) setGroupSettingsOpen(false);
  }, [selected?.id, selected?.isGroup]);

const handleLogin = async (e: React.FormEvent) => {
  e.preventDefault();
  setError(null);
  setBusy(true);
  try {
    const { user, accessToken, privateKeyEncrypted } = await authService.login(email, password);
    cryptoService.bindPendingPrivateKeyToUser(user.id);

    // If this browser doesn't have the private key yet, restore it from the encrypted backup (if available).
    cryptoService.loadPrivateKeyFromStorage(user.id);
    try {
      if (privateKeyEncrypted) {
        // Only attempt restore if we still have no active key after loading storage.
        cryptoService.loadPrivateKeyFromStorage(user.id);
        const restored = await cryptoService.decryptPrivateKeyBackup(privateKeyEncrypted, password);
        cryptoService.savePrivateKeyToStorage(user.id, restored);
      }
    } catch {
      // Wrong password / corrupted backup / unsupported format: keep session alive but DM E2EE decrypt may fail.
      // We intentionally avoid surfacing sensitive error details here.
    }

    // If we have a private key locally but server backup is missing, upload an encrypted backup once (best-effort).
    try {
      if (!privateKeyEncrypted) {
        const pk = cryptoService.getActivePrivateKeyPEM();
        if (pk) {
          await authService.upsertPrivateKeyBackup(pk, password);
        }
      }
    } catch {
      // Best-effort only; avoid interrupting login flow.
    }

    setCurrentUser(user);
    websocketService.connect(accessToken);
    await refreshLists();
  } catch (err) {
    setError(userError(err, 'auth.errInvalidCreds'));
  } finally {
    setBusy(false);
  }
};

 const handleRegister = async (e: React.FormEvent) => {
  e.preventDefault();
  setError(null);
  setBusy(true);
  try {
    const { publicKey, privateKey } = await cryptoService.generateKeyPair();
    const registeredUser = await authService.register(username, email, password, publicKey, privateKey);
    cryptoService.savePrivateKeyToStorage(registeredUser.id, privateKey);  // ← ЭТА СТРОКА ДОЛЖНА БЫТЬ
    setMode('login');
    setError(null);
    setPassword('');
    alert(t('auth.registerOk'));
  } catch (err: unknown) {
    setError(userError(err, 'auth.errRegister'));
  } finally {
    setBusy(false);
  }
};

  const performLogout = useCallback(() => {
    websocketService.disconnect();
    authService.logout();
    cryptoService.clearActivePrivateKeyFromMemory();
    setCurrentUser(null);
    setConversations([]);
    setSelected(null);
    endAllCallUi();
  }, [endAllCallUi]);

  const openOrCreateDM = async (other: User) => {
    if (!currentUser) return;
    const existing = conversations.find(
      (c) =>
        !c.isGroup &&
        c.participants.length === 2 &&
        c.participants.some((p) => p.id === other.id) &&
        c.participants.some((p) => p.id === currentUser.id)
    );
    if (existing) {
      setHiddenConvIds((prev) => {
        if (!prev.includes(existing.id)) return prev;
        const next = prev.filter((id) => id !== existing.id);
        writeHiddenConvIds(next);
        return next;
      });
      setSelected(existing);
      return;
    }
    try {
      const conv = await messageService.createConversation([other.id], false, '');
      setConversations((prev) => [conv, ...prev]);
      setSelected(conv);
    } catch (err) {
      setError(userError(err, 'error.unknown'));
    }
  };

  const handleCreateGroup = async (name: string, _description: string, memberIds: string[]) => {
    if (!currentUser) return;
    const conv = await messageService.createConversation(memberIds, true, name);
    setConversations((prev) => [conv, ...prev]);
    setSelected(conv);
    await refreshLists();
  };

  const handleGroupConversationUpdated = useCallback((conv: Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === conv.id ? conv : c)));
    setSelected((prev) => (prev?.id === conv.id ? conv : prev));
  }, []);

  const handleLeftGroup = useCallback(async () => {
    setGroupSettingsOpen(false);
    setSelected(null);
    await refreshLists();
  }, [refreshLists]);

  const peerDisplayName = useCallback(
    (userId: string) => users.find((u) => u.id === userId)?.username ?? t('app.someone'),
    [users]
  );

  const handleStartCall = useCallback(
    (opts?: { peerId?: string; conversation?: Conversation }) => {
      if (!currentUser) return;
      const conv = opts?.conversation ?? selected;
      if (!conv) return;
      if (conv.isGroup) return;
      const others = conv.participants.filter((p) => p.id !== currentUser.id);
      let peerId = opts?.peerId;
      if (!peerId) {
        if (others.length !== 1) return;
        peerId = others[0].id;
      } else if (!others.some((p) => p.id === peerId)) {
        return;
      }
      if (callBlockRef.current) return;
      setOutgoingCall({
        conversationId: conv.id,
        peerId,
      });
    },
    [currentUser, selected]
  );

  const handleStartGroupCall = useCallback(
    (conv: Conversation) => {
      if (!currentUser || callBlockRef.current) return;
      const memberIds = conv.participants.map((p) => p.id).sort();
      // Discord-like voice channel: stable "channel id" per group conversation.
      const callId = conv.id;
      setSelected(conv);
      setActiveGroupCall({
        callId,
        conversationId: conv.id,
        memberIds,
        initiatorId: currentUser.id,
      });
    },
    [currentUser]
  );

  const filteredConversations = useMemo(() => {
    const visible = conversations.filter((c) => !hiddenConvIds.includes(c.id));
    const q = sidebarQuery.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((c) => convDisplayTitle(c, currentUser?.id || '').toLowerCase().includes(q));
  }, [conversations, hiddenConvIds, sidebarQuery, currentUser?.id]);

  useEffect(() => {
    if (!convCtx) return;
    const close = () => setConvCtx(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [convCtx]);

  useEffect(() => {
    const uid = currentUser?.id;
    if (!uid) return;
    let refreshInFlight = false;
    const safeRefresh = () => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      void refreshLists().finally(() => {
        refreshInFlight = false;
      });
    };
    const unsub = websocketService.onMessage((msg: Message) => {
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === msg.conversationId);
        if (idx < 0) {
          safeRefresh();
          return prev;
        }
        const c = prev[idx];
        const updated: Conversation = {
          ...c,
          lastMessage: msg,
          updatedAt: msg.createdAt,
        };
        return [updated, ...prev.filter((_, i) => i !== idx)];
      });
      const pv = previewForWsMessage(msg, uid);
      saveStoredPreview(msg.conversationId, pv);
      setSidebarPreviewByConv((p) => (p[msg.conversationId] === pv ? p : { ...p, [msg.conversationId]: pv }));
    });
    return () => unsub();
  }, [currentUser?.id, refreshLists]);

  useEffect(() => {
    const uid = currentUser?.id;
    if (!uid) return;
    const unsub = websocketService.onFriendsUpdated(() => {
      void refreshLists();
    });
    return () => unsub();
  }, [currentUser?.id, refreshLists]);

  const filteredUsers = useMemo(() => {
    const q = sidebarQuery.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((u) => (`${u.username}#${u.discriminator}`).toLowerCase().includes(q) || u.username.toLowerCase().includes(q));
  }, [friends, sidebarQuery]);

  if (!currentUser) {
    return (
      <AuthScreen
        mode={mode}
        onSetMode={(m) => {
          setMode(m);
          setError(null);
        }}
        email={email}
        password={password}
        username={username}
        onEmail={setEmail}
        onPassword={setPassword}
        onUsername={setUsername}
        error={error}
        busy={busy}
        onLogin={handleLogin}
        onRegister={handleRegister}
        onUiLocaleChange={() => setUiLocale((n) => n + 1)}
      />
    );
  }

  const outgoingSession: CallSessionProps | null = outgoingCall
    ? {
        role: 'caller',
        conversationId: outgoingCall.conversationId,
        currentUserId: currentUser.id,
        peerId: outgoingCall.peerId,
        remoteName: peerDisplayName(outgoingCall.peerId),
        isVideo: false,
        onClose: endAllCallUi,
      }
    : null;

  const activeSession: CallSessionProps | null = activeCall
    ? {
        ...activeCall,
        onClose: endAllCallUi,
      }
    : null;

  return (
    <div className="sf-app">
      <aside className="sf-sidebar">
        <div className="sf-sidebar-top">
          <div className="sf-sidebar-title-row">
            <h1>Sirius</h1>
            <div className="sf-sidebar-actions">
              <button
                type="button"
                className="sf-icon-tool"
                title={t('app.friends')}
                onClick={() => setAddFriendOpen(true)}
              >
                <IconFriends width={20} height={20} />
              </button>
              <button
                type="button"
                className="sf-icon-tool"
                title={t('group.newTitle')}
                onClick={() => setCreateGroupOpen(true)}
              >
                <IconUsers width={20} height={20} />
              </button>
            </div>
          </div>
          <div className="sf-sidebar-search">
            <IconSearch width={16} height={16} />
            <input
              type="search"
              placeholder={t('app.searchConversations')}
              value={sidebarQuery}
              onChange={(e) => setSidebarQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="sf-sidebar-scroll">
          <p className="sf-section-label">{t('app.chats')}</p>
          <div>
            {filteredConversations.map((c) => {
              const title = convDisplayTitle(c, currentUser.id);
              const other = c.participants.find((p) => p.id !== currentUser.id);
              const avatarUrl = c.isGroup ? c.avatar : other?.avatar;
              const showOnline = !c.isGroup && isActuallyOnline(other);
              const preview =
                sidebarPreviewByConv[c.id] ??
                loadStoredPreview(c.id) ??
                (c.lastMessage ? previewFromMessageType(c.lastMessage.messageType) : null) ??
                t('app.noMessagesYet');
              const mutedSidebar = isConversationNotifyMuted(c.id);
              const dmBlocked = !c.isGroup && other && isUserBlocked(other.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={
                    selected?.id === c.id ? 'sf-conv-item sf-conv-item--active' : 'sf-conv-item'
                  }
                  onClick={() => setSelected(c)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setConvCtx({ x: e.clientX, y: e.clientY, conv: c });
                  }}
                >
                  <div className="sf-conv-inner">
                    <AvatarBubble label={title} avatarUrl={avatarUrl} online={showOnline} />
                    <div className="sf-conv-meta">
                      <div className="sf-conv-name-row">
                        <span className="sf-conv-name">
                          {title}
                          {mutedSidebar ? <span className="sf-conv-muted-badge">{t('badge.muted')}</span> : null}
                          {dmBlocked ? <span className="sf-conv-muted-badge">{t('badge.locked')}</span> : null}
                        </span>
                        <span className="sf-conv-time">{formatSidebarTime(c.updatedAt)}</span>
                      </div>
                      <p className="sf-conv-preview">{preview}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {sidebarQuery.trim() ? (
            <div>
              <p className="sf-section-label">{t('friends.title')}</p>
              {filteredUsers
                .filter((u) => u.id !== currentUser.id)
                .map((u) => (
                  <button key={u.id} type="button" className="sf-user-row" onClick={() => openOrCreateDM(u)}>
                    <span className="sf-user-name">
                      <span className={isActuallyOnline(u) ? 'sf-dot sf-dot--on' : 'sf-dot'} aria-hidden />
                      {u.username}#{u.discriminator}
                    </span>
                  </button>
                ))}
              {filteredConversations.length === 0 && filteredUsers.length === 0 ? (
                <div className="sf-empty" style={{ padding: '0.75rem 0' }}>
                  {t('app.nothingFound')}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="sf-sidebar-footer">
          <button type="button" className="sf-profile-btn" onClick={() => setSettingsOpen(true)}>
            <AvatarBubble
              label={currentUser.username}
              avatarUrl={currentUser.avatar}
              className="sf-avatar--sm"
              online={isActuallyOnline(currentUser)}
            />
            <div className="sf-profile-text">
              <p className="sf-profile-name">
                {currentUser.username}
                <span className="sf-profile-id"> #{currentUser.discriminator}</span>
              </p>
              <p className="sf-profile-status">
                {isActuallyOnline(currentUser) ? t('app.profile.online') : t('app.profile.offline')}
              </p>
            </div>
            <span className="sf-profile-settings" aria-hidden>
              <IconSettings width={20} height={20} />
            </span>
          </button>
        </div>
      </aside>

      <main className="sf-main">
        {selected ? (
          <Chat
            key={`${selected.id}-${prefsTick}-${uiLocale}`}
            conversation={selected}
            currentUser={currentUser}
            conversations={conversations}
            onStartCall={handleStartCall}
            onStartGroupCall={handleStartGroupCall}
            onOpenGroupSettings={selected.isGroup ? () => setGroupSettingsOpen(true) : undefined}
            peerLocked={
              !selected.isGroup
                ? isUserBlocked(selected.participants.find((p) => p.id !== currentUser.id)?.id || '')
                : false
            }
            notifyMuted={isConversationNotifyMuted(selected.id)}
            onTogglePeerLock={
              !selected.isGroup
                ? () => {
                    const o = selected.participants.find((p) => p.id !== currentUser.id);
                    if (!o) return;
                    const next = !isUserBlocked(o.id);
                    setUserBlocked(o.id, next);
                    // Persist to backend so blocked users are enforced server-side.
                    void (next ? messageService.blockUser(o.id) : messageService.unblockUser(o.id)).catch(() => {
                      /* keep local preference even if server call fails */
                    });
                    setPrefsTick((t) => t + 1);
                  }
                : undefined
            }
            onToggleNotifyMute={() => {
              setConversationNotifyMuted(selected.id, !isConversationNotifyMuted(selected.id));
              setPrefsTick((t) => t + 1);
            }}
            onSidebarPreview={onSidebarPreview}
          />
        ) : (
          <div className="sf-empty">{t('app.selectConversation')}</div>
        )}
      </main>

      <AddFriendWindow
        isOpen={addFriendOpen}
        onClose={() => setAddFriendOpen(false)}
        users={users}
        friends={friends}
        currentUserId={currentUser.id}
        incoming={friendIncoming}
        outgoing={friendOutgoing}
        onRefresh={refreshLists}
        onStartChat={(u) => {
          void openOrCreateDM(u);
        }}
      />

      <CreateGroupWindow
        isOpen={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        users={users}
        currentUserId={currentUser.id}
        onCreate={handleCreateGroup}
      />

      <SettingsWindow
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={currentUser}
        onLogout={performLogout}
        appearanceTheme={appearanceTheme}
        onAppearanceThemeChange={setAppearanceTheme}
        onUiLocaleChange={() => setUiLocale((n) => n + 1)}
        onUserUpdated={(u) => {
          setCurrentUser(u);
          void refreshLists();
        }}
      />

      {selected?.isGroup ? (
        <GroupChatSettingsWindow
          isOpen={groupSettingsOpen}
          onClose={() => setGroupSettingsOpen(false)}
          conversation={selected}
          currentUser={currentUser}
          allUsers={users}
          onUpdated={handleGroupConversationUpdated}
          onRemovedSelf={handleLeftGroup}
        />
      ) : null}

      {convCtx &&
        createPortal(
          <div
            className="sf-msg-ctx-menu"
            role="menu"
            style={{ left: convCtx.x, top: convCtx.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="sf-msg-ctx-item"
              role="menuitem"
              onClick={() => {
                const next = !isConversationNotifyMuted(convCtx.conv.id);
                setConversationNotifyMuted(convCtx.conv.id, next);
                setPrefsTick((t) => t + 1);
                setConvCtx(null);
              }}
            >
              {isConversationNotifyMuted(convCtx.conv.id) ? t('conv.turnOnNotifications') : t('conv.muteNotifications')}
            </button>
            {!convCtx.conv.isGroup ? (
              <button
                type="button"
                className="sf-msg-ctx-item"
                role="menuitem"
                onClick={() => {
                  const o = convCtx.conv.participants.find((p) => p.id !== currentUser.id);
                  if (o) {
                    const next = !isUserBlocked(o.id);
                    setUserBlocked(o.id, next);
                    void (next ? messageService.blockUser(o.id) : messageService.unblockUser(o.id)).catch(() => {
                      /* ignore */
                    });
                    setPrefsTick((t) => t + 1);
                  }
                  setConvCtx(null);
                }}
              >
                {(() => {
                  const o = convCtx.conv.participants.find((p) => p.id !== currentUser.id);
                  return o && isUserBlocked(o.id) ? t('conv.unlockUser') : t('conv.lockUser');
                })()}
              </button>
            ) : null}
            <button
              type="button"
              className="sf-msg-ctx-item sf-msg-ctx-item--danger"
              role="menuitem"
              onClick={() => {
                setDeleteChatConfirm(convCtx.conv);
                setConvCtx(null);
              }}
            >
              {t('conv.deleteChat')}
            </button>
          </div>,
          document.body
        )}

      <ConfirmDialog
        isOpen={!!deleteChatConfirm}
        title={t('conv.deleteChatTitle')}
        message={deleteChatConfirm?.isGroup ? t('conv.deleteChatGroupMsg') : t('conv.deleteChatDmMsg')}
        cancelText={t('common.cancel')}
        confirmText={t('conv.delete')}
        danger
        onCancel={() => setDeleteChatConfirm(null)}
        onConfirm={() => {
          const conv = deleteChatConfirm;
          if (!conv) return;
          const id = conv.id;
          setDeleteChatConfirm(null);
          if (conv.isGroup) {
            void messageService
              .removeGroupParticipant(id, currentUser.id)
              .catch(() => {})
              .finally(() => {
                setHiddenConvIds((prev) => {
                  if (prev.includes(id)) return prev;
                  const next = [...prev, id];
                  writeHiddenConvIds(next);
                  return next;
                });
                if (selected?.id === id) {
                  const nextConv = conversations.find((c) => !hiddenConvIds.includes(c.id) && c.id !== id) || null;
                  setSelected(nextConv);
                }
              });
            return;
          }
          setHiddenConvIds((prev) => {
            if (prev.includes(id)) return prev;
            const next = [...prev, id];
            writeHiddenConvIds(next);
            return next;
          });
          if (selected?.id === id) {
            const nextConv = conversations.find((c) => !hiddenConvIds.includes(c.id) && c.id !== id) || null;
            setSelected(nextConv);
          }
        }}
      />

      {incomingRing && !outgoingCall && !activeCall && !activeGroupCall && !incomingGroupInvite && (
        <div className="sf-incoming-call">
          <p>
            {t('incomingCall.isCalling').replace('{name}', peerDisplayName(incomingRing.callerId))}
          </p>
          <div className="sf-incoming-actions">
            <button
              type="button"
              className="sf-incoming-decline"
              onClick={() => {
                websocketService.sendCallEnd(incomingRing.conversationId, incomingRing.callerId, 'declined');
                setIncomingRing(null);
              }}
            >
              <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconPhoneHangup width={18} height={18} />
              </span>
              {t('incomingCall.decline')}
            </button>
            <button
              type="button"
              className="sf-incoming-accept"
              onClick={() => {
                const ring = incomingRing;
                setIncomingRing(null);
                setActiveCall({
                  role: 'callee',
                  conversationId: ring.conversationId,
                  currentUserId: currentUser.id,
                  peerId: ring.callerId,
                  remoteName: peerDisplayName(ring.callerId),
                  isVideo: false,
                  remoteOffer: ring.offer,
                });
                const conv = conversations.find((c) => c.id === ring.conversationId);
                if (conv) setSelected(conv);
              }}
            >
              <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconPhone width={18} height={18} />
              </span>
              {t('incomingCall.accept')}
            </button>
          </div>
        </div>
      )}

      {incomingGroupInvite && !activeGroupCall && (
        <div className="sf-incoming-call">
          <p>
            {t('incomingCall.groupStarted').replace('{name}', peerDisplayName(incomingGroupInvite.initiatorId))}
          </p>
          <div className="sf-incoming-actions">
            <button
              type="button"
              className="sf-incoming-decline"
              onClick={() => setIncomingGroupInvite(null)}
            >
              <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconPhoneHangup width={18} height={18} />
              </span>
              {t('incomingCall.decline')}
            </button>
            <button
              type="button"
              className="sf-incoming-accept"
              onClick={() => {
                const inv = incomingGroupInvite;
                setIncomingGroupInvite(null);
                setActiveGroupCall({
                  callId: inv.callId,
                  conversationId: inv.conversationId,
                  memberIds: inv.memberIds,
                  initiatorId: inv.initiatorId,
                });
                const conv = conversations.find((c) => c.id === inv.conversationId);
                if (conv) setSelected(conv);
              }}
            >
              <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconPhone width={18} height={18} />
              </span>
              {t('incomingCall.accept')}
            </button>
          </div>
        </div>
      )}

      {activeGroupCall && currentUser ? (
        <GroupCallWindow
          callId={activeGroupCall.callId}
          conversationId={activeGroupCall.conversationId}
          currentUserId={currentUser.id}
          memberIds={activeGroupCall.memberIds}
          initiatorId={activeGroupCall.initiatorId}
          displayName={(userId) => {
            if (userId === currentUser.id) return currentUser.username;
            const conv = conversations.find((c) => c.id === activeGroupCall.conversationId);
            const fromConv = conv?.participants.find((p) => p.id === userId)?.username;
            if (fromConv) return fromConv;
            return users.find((u) => u.id === userId)?.username ?? t('app.userFallback');
          }}
          avatarUrlFor={(userId) => {
            const u = users.find((x) => x.id === userId);
            if (u?.avatar) return u.avatar;
            const conv = conversations.find((c) => c.id === activeGroupCall.conversationId);
            return conv?.participants.find((p) => p.id === userId)?.avatar;
          }}
          onClose={() => setActiveGroupCall(null)}
        />
      ) : null}

      {outgoingSession && <CallWindow {...outgoingSession} />}
      {activeSession && <CallWindow {...activeSession} />}
    </div>
  );
}

export default App;
