import type { Conversation } from './types';

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  hasMore: boolean;
  email: string;
  onOpen(id: string): void;
  onNew(): void;
  onMore(): void;
  onSignOut(): void;
  onBackup(): void;
}

export function Sidebar(p: Props) {
  return (
    <nav className="sidebar" aria-label="Conversations">
      <button type="button" className="primary new-chat" onClick={p.onNew}>
        + New chat
      </button>
      <ul className="conversations">
        {p.conversations.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={c.id === p.activeId ? 'conv active' : 'conv'}
              aria-current={c.id === p.activeId ? 'page' : undefined}
              onClick={() => p.onOpen(c.id)}
            >
              {c.title || 'Untitled'}
              {c.parentConversationId && <span className="tag">branch</span>}
            </button>
          </li>
        ))}
        {p.conversations.length === 0 && <li className="muted empty">No conversations yet.</li>}
      </ul>
      {p.hasMore && (
        <button type="button" className="ghost more" onClick={p.onMore}>
          Load more
        </button>
      )}
      <button type="button" className="ghost backup" onClick={p.onBackup} title="Save a copy of all conversations">
        Back up
      </button>
      <div className="account">
        <span className="muted" title={p.email}>{p.email}</span>
        <button type="button" className="ghost" onClick={p.onSignOut}>
          Sign out
        </button>
      </div>
    </nav>
  );
}
