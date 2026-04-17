import React from 'react';

/** Max size for avatar data URLs (group + profile). */
const MAX_DATA_URL = 3 * 1024 * 1024;

export function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = typeof r.result === 'string' ? r.result : '';
      if (s.length > MAX_DATA_URL) {
        reject(new Error('Image too large (max 3MB)'));
        return;
      }
      resolve(s);
    };
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(file);
  });
}

export function AvatarBubble(props: {
  label: string;
  avatarUrl?: string;
  className?: string;
  online?: boolean;
}) {
  const { label, avatarUrl, className = '', online } = props;
  const letter = label.trim().charAt(0).toUpperCase() || '?';
  return (
    <div className="sf-avatar-wrap">
      {avatarUrl ? (
        <div className={`sf-avatar ${className}`.trim()}>
          <img src={avatarUrl} alt="" className="sf-avatar-img" />
        </div>
      ) : (
        <div className={`sf-avatar ${className}`.trim()} aria-hidden>
          {letter}
        </div>
      )}
      {online ? <span className="sf-online-dot" aria-hidden /> : null}
    </div>
  );
}
