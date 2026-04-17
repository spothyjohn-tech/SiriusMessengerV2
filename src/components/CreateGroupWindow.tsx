import React, { useMemo, useState } from 'react';
import { User } from '../types';
import { IconX } from './icons';
import { t } from '../utils/i18n';

interface CreateGroupWindowProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  currentUserId: string;
  onCreate: (name: string, description: string, memberIds: string[]) => Promise<void>;
}

const CreateGroupWindow: React.FC<CreateGroupWindowProps> = ({
  isOpen,
  onClose,
  users,
  currentUserId,
  onCreate,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const others = useMemo(
    () => users.filter((u) => u.id !== currentUserId),
    [users, currentUserId]
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) {
      setErr(t('group.errName'));
      return;
    }
    if (selected.size < 1) {
      setErr(t('group.errMembers'));
      return;
    }
    setBusy(true);
    try {
      await onCreate(name.trim(), description.trim(), [...selected]);
      setName('');
      setDescription('');
      setSelected(new Set());
      onClose();
    } catch {
      setErr(t('group.errCreate'));
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="sf-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="sf-modal sf-modal--lg"
        role="dialog"
        aria-labelledby="sf-group-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sf-modal-head">
          <h2 id="sf-group-title" className="sf-modal-title">
            {t('group.newTitle')}
          </h2>
          <button type="button" className="sf-modal-close" onClick={onClose} aria-label="Close">
            <IconX width={20} height={20} />
          </button>
        </div>
        <form className="sf-modal-body" onSubmit={submit}>
          <div className="sf-auth-field">
            <label className="sf-auth-label">{t('group.name')}</label>
            <input
              className="sf-auth-input sf-auth-input--no-icon"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('group.namePlaceholder')}
            />
          </div>
          <div className="sf-auth-field">
            <label className="sf-auth-label">{t('group.description')}</label>
            <input
              className="sf-auth-input sf-auth-input--no-icon"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('group.descriptionPlaceholder')}
            />
          </div>
          <p className="sf-auth-label">{t('group.members')}</p>
          <ul className="sf-group-member-list">
            {others.map((u) => (
              <li key={u.id}>
                <label className="sf-group-check-row">
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={() => toggle(u.id)}
                  />
                  <span className="sf-avatar sf-avatar--sm" aria-hidden>
                    {u.username.charAt(0).toUpperCase()}
                  </span>
                  <span>{u.username}</span>
                </label>
              </li>
            ))}
          </ul>
          {err && <p className="sf-auth-error">{err}</p>}
          <button type="submit" className="sf-auth-submit" disabled={busy}>
            {busy ? '…' : t('group.create')}
          </button>
        </form>
      </div>
    </div>
  );
};

export default CreateGroupWindow;
