import React, { useEffect, useState, useMemo } from 'react';
import { Conversation, User } from '../types';
import { messageService } from '../services/message';
import { readImageAsDataUrl, AvatarBubble } from '../utils/avatar';
import { IconX } from './icons';

interface GroupChatSettingsWindowProps {
  isOpen: boolean;
  onClose: () => void;
  conversation: Conversation;
  currentUser: User;
  allUsers: User[];
  onUpdated: (conv: Conversation) => void;
  onRemovedSelf: () => void;
}

const GroupChatSettingsWindow: React.FC<GroupChatSettingsWindowProps> = ({
  isOpen,
  onClose,
  conversation,
  currentUser,
  allUsers,
  onUpdated,
  onRemovedSelf,
}) => {
  const [name, setName] = useState(conversation.name || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(conversation.name || '');
      setErr(null);
      setAddOpen(false);
    }
  }, [isOpen, conversation.id, conversation.name]);

  const memberIds = useMemo(() => new Set(conversation.participants.map((p) => p.id)), [conversation.participants]);

  const addableUsers = useMemo(
    () => allUsers.filter((u) => u.id !== currentUser.id && !memberIds.has(u.id)),
    [allUsers, currentUser.id, memberIds]
  );

  if (!isOpen) return null;

  const title = conversation.name || 'Group';

  const saveName = async () => {
    setBusy(true);
    setErr(null);
    try {
      const conv = await messageService.updateGroupConversation(conversation.id, {
        name: name.trim() || 'Group',
      });
      onUpdated(conv);
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } };
      setErr(ax.response?.data?.error || 'Could not update');
    } finally {
      setBusy(false);
    }
  };

  const onPickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !f.type.startsWith('image/')) return;
    setBusy(true);
    setErr(null);
    try {
      const dataUrl = await readImageAsDataUrl(f);
      const conv = await messageService.updateGroupConversation(conversation.id, { avatar: dataUrl });
      onUpdated(conv);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not set avatar';
      const ax = e as { response?: { data?: { error?: string } } };
      setErr(ax.response?.data?.error || msg);
    } finally {
      setBusy(false);
    }
  };

  const clearAvatar = async () => {
    setBusy(true);
    setErr(null);
    try {
      const conv = await messageService.updateGroupConversation(conversation.id, { avatar: '' });
      onUpdated(conv);
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } };
      setErr(ax.response?.data?.error || 'Could not remove avatar');
    } finally {
      setBusy(false);
    }
  };

  const kickOrLeave = async (userId: string) => {
    const self = userId === currentUser.id;
    const msg = self
      ? 'Leave this group? You can be re-added by a member.'
      : 'Remove this member from the group?';
    if (!window.confirm(msg)) return;
    setBusy(true);
    setErr(null);
    try {
      await messageService.removeGroupParticipant(conversation.id, userId);
      if (self) {
        onClose();
        onRemovedSelf();
        return;
      }
      const list = await messageService.getConversations();
      const next = list.find((c) => c.id === conversation.id);
      if (next) onUpdated(next);
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } };
      setErr(ax.response?.data?.error || 'Could not update members');
    } finally {
      setBusy(false);
    }
  };

  const addMembers = async (userIds: string[]) => {
    if (userIds.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const conv = await messageService.addGroupParticipants(conversation.id, userIds);
      onUpdated(conv);
      setAddOpen(false);
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } };
      setErr(ax.response?.data?.error || 'Could not add members');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sf-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="sf-modal sf-modal--settings"
        role="dialog"
        aria-labelledby="sf-group-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sf-modal-head">
          <h2 id="sf-group-settings-title" className="sf-modal-title">
            Group chat
          </h2>
          <button type="button" className="sf-modal-close" onClick={onClose} aria-label="Close">
            <IconX width={20} height={20} />
          </button>
        </div>
        <div className="sf-modal-body sf-settings-body">
          {err ? <p className="sf-settings-error">{err}</p> : null}

          <section className="sf-settings-section">
            <h3 className="sf-settings-section-title">Photo</h3>
            <div className="sf-settings-account">
              <AvatarBubble label={title} avatarUrl={conversation.avatar} className="sf-avatar--lg" />
              <div className="sf-group-avatar-actions">
                <label className="sf-btn sf-btn--primary-sm sf-file-label">
                  Change photo
                  <input type="file" accept="image/*" className="sf-file-input" onChange={(e) => void onPickAvatar(e)} disabled={busy} />
                </label>
                {conversation.avatar ? (
                  <button type="button" className="sf-btn sf-btn--ghost" onClick={() => void clearAvatar()} disabled={busy}>
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          <section className="sf-settings-section">
            <h3 className="sf-settings-section-title">Name</h3>
            <div className="sf-settings-field-row">
              <input
                type="text"
                className="sf-settings-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Group name"
                maxLength={120}
              />
              <button type="button" className="sf-btn sf-btn--primary-sm" onClick={() => void saveName()} disabled={busy}>
                Save
              </button>
            </div>
          </section>

          <section className="sf-settings-section">
            <div className="sf-group-members-head">
              <h3 className="sf-settings-section-title">Members ({conversation.participants.length})</h3>
              <button type="button" className="sf-btn sf-btn--primary-sm sf-btn--small" onClick={() => setAddOpen(true)} disabled={busy || addableUsers.length === 0}>
                Add people
              </button>
            </div>
            <ul className="sf-group-member-list">
              {conversation.participants.map((p) => (
                <li key={p.id} className="sf-group-member-row">
                  <AvatarBubble label={p.username} avatarUrl={p.avatar} className="sf-avatar--sm" online={p.online} />
                  <span className="sf-group-member-name">
                    {p.username}
                    {p.id === currentUser.id ? ' (you)' : ''}
                  </span>
                  <button
                    type="button"
                    className="sf-btn sf-btn--ghost sf-btn--small"
                    onClick={() => void kickOrLeave(p.id)}
                    disabled={busy}
                  >
                    {p.id === currentUser.id ? 'Leave' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {addOpen && (
        <div
          className="sf-modal-overlay sf-modal-overlay--nested"
          role="presentation"
          onClick={(e) => {
            e.stopPropagation();
            setAddOpen(false);
          }}
        >
          <div className="sf-modal sf-modal--lg" role="dialog" aria-label="Add people" onClick={(e) => e.stopPropagation()}>
            <div className="sf-modal-head">
              <h2 className="sf-modal-title">Add to group</h2>
              <button type="button" className="sf-modal-close" onClick={() => setAddOpen(false)} aria-label="Close">
                <IconX width={20} height={20} />
              </button>
            </div>
            <div className="sf-modal-body">
              {addableUsers.length === 0 ? (
                <p className="sf-settings-hint">No one else to add.</p>
              ) : (
                <ul className="sf-modal-list">
                  {addableUsers.map((u) => (
                    <li key={u.id} className="sf-modal-list-item">
                      <button
                        type="button"
                        className="sf-add-member-row"
                        onClick={() => void addMembers([u.id])}
                        disabled={busy}
                      >
                        <AvatarBubble label={u.username} avatarUrl={u.avatar} className="sf-avatar--sm" online={u.online} />
                        <span>{u.username}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GroupChatSettingsWindow;
