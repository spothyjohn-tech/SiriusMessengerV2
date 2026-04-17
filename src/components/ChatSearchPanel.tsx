import React from 'react';
import { IconX } from './icons';

export interface ChatSearchHit {
  id: string;
  snippet: string;
}

interface ChatSearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  hits: ChatSearchHit[];
  onPickHit: (id: string) => void;
}

const ChatSearchPanel: React.FC<ChatSearchPanelProps> = ({
  isOpen,
  onClose,
  query,
  onQueryChange,
  hits,
  onPickHit,
}) => {
  if (!isOpen) return null;

  return (
    <div className="sf-chat-search-panel">
      <div className="sf-chat-search-row">
        <input
          type="search"
          className="sf-chat-search-input"
          placeholder="Search messages…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          autoFocus
        />
        <button type="button" className="sf-chat-search-close" onClick={onClose} aria-label="Close search">
          <IconX width={18} height={18} />
        </button>
      </div>
      {query.trim() && (
        <ul className="sf-chat-search-hits">
          {hits.length === 0 ? (
            <li className="sf-chat-search-empty">No matches</li>
          ) : (
            hits.map((h) => (
              <li key={h.id}>
                <button type="button" className="sf-chat-search-hit" onClick={() => onPickHit(h.id)}>
                  {h.snippet}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};

export default ChatSearchPanel;
