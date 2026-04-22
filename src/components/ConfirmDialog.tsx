import React from 'react';
import { createPortal } from 'react-dom';
import { IconX } from './icons';
import { t } from '../utils/i18n';

export default function ConfirmDialog(props: {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const {
    isOpen,
    title,
    message,
    confirmText = t('common.yes'),
    cancelText = t('common.no'),
    danger,
    busy,
    onConfirm,
    onCancel,
  } = props;
  if (!isOpen) return null;
  return createPortal(
    <div className="sf-modal-overlay" role="presentation" onClick={onCancel}>
      <div
        className="sf-modal sf-modal--sm"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sf-modal-head">
          <h2 className="sf-modal-title">{title}</h2>
          <button type="button" className="sf-modal-close" onClick={onCancel} aria-label={t('common.close')}>
            <IconX width={20} height={20} />
          </button>
        </div>
        <div className="sf-modal-body">
          <p style={{ margin: 0, color: 'var(--sf-zinc-300)' }}>{message}</p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button
              type="button"
              className="sf-btn sf-btn--ghost sf-btn--small"
              style={{ flex: 1, minWidth: 120 }}
              onClick={onCancel}
              disabled={busy}
            >
              {cancelText}
            </button>
            <button
              type="button"
              className={danger ? 'sf-btn sf-btn--danger-outline' : 'sf-btn sf-btn--primary-sm'}
              style={{ flex: 1, minWidth: 120 }}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? '…' : confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

