import React, { useMemo, useState } from 'react';
import { User, FriendRequest } from '../types';
import { IconSearch, IconX } from './icons';
import { messageService } from '../services/message';
import { AvatarBubble } from '../utils/avatar';
import { t } from '../utils/i18n';

interface AddFriendWindowProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  friends: User[];
  currentUserId: string;
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  onRefresh: () => Promise<void>;
  onStartChat: (user: User) => void;
}

const AddFriendWindow: React.FC<AddFriendWindowProps> = ({
  isOpen,
  onClose,
  users,
  friends,
  currentUserId,
  incoming,
  outgoing,
  onRefresh,
  onStartChat,
}) => {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'friends' | 'requests'>('friends');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return users
      .filter((u) => u.id !== currentUserId)
      .filter((u) => !t || `${u.username}#${u.discriminator}`.toLowerCase().includes(t) || u.username.toLowerCase().includes(t) || u.email.toLowerCase().includes(t));
  }, [users, currentUserId, q]);

  const friendsList = useMemo(() => {
    const t = q.trim().toLowerCase();
    return friends
      .filter((u) => u.id !== currentUserId)
      .filter((u) => !t || `${u.username}#${u.discriminator}`.toLowerCase().includes(t) || u.username.toLowerCase().includes(t) || u.email.toLowerCase().includes(t));
  }, [friends, currentUserId, q]);

  if (!isOpen) return null;

  const sendRequest = async () => {
    const query = q.trim();
    if (!query) return;
    setErr(null);
    setBusyId('send');
    try {
      await messageService.sendFriendRequest(query);
      await onRefresh();
      setTab('requests');
      setQ('');
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } };
      setErr(ax.response?.data?.error || t('friends.errSend'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="sf-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="sf-modal sf-modal--lg"
        role="dialog"
        aria-labelledby="sf-add-friend-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sf-modal-head">
          <h2 id="sf-add-friend-title" className="sf-modal-title">
            {t('friends.title')}
          </h2>
          <button type="button" className="sf-modal-close" onClick={onClose} aria-label="Close">
            <IconX width={20} height={20} />
          </button>
        </div>
        <div className="sf-modal-body">
          <div className="sf-settings-tabs" style={{ marginBottom: '0.75rem' }}>
            <button
              type="button"
              className={`sf-settings-tab${tab === 'friends' ? ' sf-settings-tab--active' : ''}`}
              onClick={() => setTab('friends')}
            >
              {t('friends.tabFriends')}
            </button>
            <button
              type="button"
              className={`sf-settings-tab${tab === 'requests' ? ' sf-settings-tab--active' : ''}`}
              onClick={() => setTab('requests')}
            >
              {t('friends.tabRequests')}
            </button>
          </div>
          {tab === 'friends' ? (
            <>
          <div className="sf-sidebar-search sf-modal-search">
            <IconSearch width={16} height={16} />
            <input
              type="search"
              placeholder={t('friends.search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>
          <button type="button" className="sf-btn sf-btn--primary-sm" onClick={() => void sendRequest()} disabled={!q.trim() || busyId === 'send'}>
            {t('friends.add')}
          </button>
          {err ? <p className="sf-settings-error" style={{ marginTop: '0.5rem' }}>{err}</p> : null}
          <p className="sf-settings-hint" style={{ marginTop: '0.75rem' }}>{t('friends.sectionFriends')}</p>
          <ul className="sf-modal-list">
            {friendsList.map((u) => (
              <li key={u.id} className="sf-modal-list-item">
                <AvatarBubble label={u.username} avatarUrl={u.avatar} online={u.online} className="sf-avatar--sm" />
                <div className="sf-modal-list-meta">
                  <span className="sf-modal-list-name">{u.username}#{u.discriminator}</span>
                  <span className="sf-modal-list-sub">{u.email}</span>
                </div>
                <button
                  type="button"
                  className="sf-btn sf-btn--ghost sf-btn--small"
                  disabled={busyId === u.id}
                  onClick={() => {
                    setBusyId(u.id);
                    void messageService.removeFriend(u.id).then(onRefresh).finally(() => setBusyId(null));
                  }}
                >
                  {t('friends.remove')}
                </button>
                <button
                  type="button"
                  className="sf-btn sf-btn--primary-sm"
                  onClick={() => {
                    onStartChat(u);
                    onClose();
                  }}
                >
                  {t('friends.message')}
                </button>
              </li>
            ))}
          </ul>
          {friendsList.length === 0 ? <p className="sf-modal-empty">{t('friends.none')}</p> : null}

          <p className="sf-settings-hint" style={{ marginTop: '0.75rem' }}>{t('friends.sectionUsers')}</p>
          <ul className="sf-modal-list" style={{ marginTop: '0.75rem' }}>
            {list.map((u) => {
              const pendingOut = outgoing.some((r) => r.receiverId === u.id);
              const pendingIn = incoming.some((r) => r.senderId === u.id);
              const alreadyFriend = friends.some((f) => f.id === u.id);
              return (
                <li key={u.id} className="sf-modal-list-item">
                  <AvatarBubble label={u.username} avatarUrl={u.avatar} online={u.online} className="sf-avatar--sm" />
                  <div className="sf-modal-list-meta">
                    <span className="sf-modal-list-name">{u.username}#{u.discriminator}</span>
                    <span className="sf-modal-list-sub">{u.email}</span>
                  </div>
                  {alreadyFriend ? (
                    <>
                      <button
                        type="button"
                        className="sf-btn sf-btn--ghost sf-btn--small"
                        disabled={busyId === u.id}
                        onClick={() => {
                          setBusyId(u.id);
                          void messageService.removeFriend(u.id).then(onRefresh).finally(() => setBusyId(null));
                        }}
                      >
                        {t('friends.remove')}
                      </button>
                      <button
                        type="button"
                        className="sf-btn sf-btn--primary-sm"
                        onClick={() => {
                          onStartChat(u);
                          onClose();
                        }}
                      >
                        {t('friends.message')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="sf-btn sf-btn--primary-sm"
                      onClick={() => {
                        if (pendingIn || pendingOut) return;
                        setQ(`${u.username}#${u.discriminator}`);
                        void sendRequest();
                      }}
                      disabled={pendingOut || pendingIn}
                    >
                      {pendingIn ? t('friends.incomingRequest') : pendingOut ? t('friends.requestSent') : t('friends.sendRequest')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {list.length === 0 && <p className="sf-modal-empty">{t('friends.noUsersMatch')}</p>}
            </>
          ) : (
            <>
              <p className="sf-settings-hint">{t('friends.incoming')}</p>
              <ul className="sf-modal-list">
                {incoming.map((r) => {
                  const u = r.sender;
                  if (!u) return null;
                  return (
                    <li key={r.id} className="sf-modal-list-item">
                      <div className="sf-modal-list-meta">
                        <span className="sf-modal-list-name">{u.username}</span>
                        <span className="sf-modal-list-sub">{u.email}</span>
                      </div>
                      <button className="sf-btn sf-btn--primary-sm" disabled={busyId === r.id} onClick={() => {
                        setBusyId(r.id);
                        void messageService.acceptFriendRequest(r.id).then(async () => {
                          await onRefresh();
                          onStartChat(u);
                        }).finally(() => setBusyId(null));
                      }}>{t('friends.accept')}</button>
                      <button className="sf-btn sf-btn--ghost sf-btn--small" disabled={busyId === r.id} onClick={() => {
                        setBusyId(r.id);
                        void messageService.declineFriendRequest(r.id).then(onRefresh).finally(() => setBusyId(null));
                      }}>{t('friends.decline')}</button>
                    </li>
                  );
                })}
              </ul>
              <p className="sf-settings-hint">{t('friends.outgoing')}</p>
              <ul className="sf-modal-list">
                {outgoing.map((r) => {
                  const u = r.receiver;
                  if (!u) return null;
                  return (
                    <li key={r.id} className="sf-modal-list-item">
                      <div className="sf-modal-list-meta">
                        <span className="sf-modal-list-name">{u.username}</span>
                        <span className="sf-modal-list-sub">{u.email}</span>
                      </div>
                      <button className="sf-btn sf-btn--ghost sf-btn--small" disabled={busyId === r.id} onClick={() => {
                        setBusyId(r.id);
                        void messageService.cancelFriendRequest(r.id).then(onRefresh).finally(() => setBusyId(null));
                      }}>{t('friends.cancel')}</button>
                    </li>
                  );
                })}
              </ul>
              {incoming.length === 0 && outgoing.length === 0 ? <p className="sf-modal-empty">{t('friends.noRequests')}</p> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddFriendWindow;
