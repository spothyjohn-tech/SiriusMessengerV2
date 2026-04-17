import React, { useEffect, useRef } from 'react';
import { IconSearch, IconTrash, IconBellOff, IconLock } from './icons';
import { t } from '../utils/i18n';

interface ChatOptionsMenuProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  onOpenSearch: () => void;
  onClearChat: () => void;
  showNotifyMute?: boolean;
  notifyMuted?: boolean;
  onToggleNotifyMute?: () => void;
  showPeerLock?: boolean;
  peerLocked?: boolean;
  onTogglePeerLock?: () => void;
}

const ChatOptionsMenu: React.FC<ChatOptionsMenuProps> = ({
  isOpen,
  onClose,
  anchorRef,
  onOpenSearch,
  onClearChat,
  showNotifyMute,
  notifyMuted,
  onToggleNotifyMute,
  showPeerLock,
  peerLocked,
  onTogglePeerLock,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onDoc = (e: MouseEvent) => {
      const node = e.target as Node;
      if (menuRef.current?.contains(node)) return;
      if (anchorRef.current?.contains(node)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen) return null;

  const rect = anchorRef.current?.getBoundingClientRect();
  const top = rect ? rect.bottom + 8 : 0;
  const right = rect ? window.innerWidth - rect.right : 16;

  return (
    <div
      ref={menuRef}
      className="sf-chat-menu"
      style={{ top, right }}
      role="menu"
    >
      <button
        type="button"
        className="sf-chat-menu-item"
        role="menuitem"
        onClick={() => {
          onOpenSearch();
          onClose();
        }}
      >
        <IconSearch width={18} height={18} />
        {t('chat.searchInChat')}
      </button>
      {showNotifyMute && onToggleNotifyMute ? (
        <button
          type="button"
          className="sf-chat-menu-item"
          role="menuitem"
          onClick={() => {
            onToggleNotifyMute();
            onClose();
          }}
        >
          <IconBellOff width={18} height={18} />
          {notifyMuted ? t('chat.unmuteNotif') : t('chat.muteNotif')}
        </button>
      ) : null}
      {showPeerLock && onTogglePeerLock ? (
        <button
          type="button"
          className="sf-chat-menu-item"
          role="menuitem"
          onClick={() => {
            onTogglePeerLock();
            onClose();
          }}
        >
          <IconLock width={18} height={18} />
          {peerLocked ? t('chat.unlockUser') : t('chat.lockUser')}
        </button>
      ) : null}
      <button
        type="button"
        className="sf-chat-menu-item sf-chat-menu-item--danger"
        role="menuitem"
        onClick={() => {
          onClearChat();
          onClose();
        }}
      >
        <IconTrash width={18} height={18} />
        {t('chat.clearChat')}
      </button>
    </div>
  );
};

export default ChatOptionsMenu;
