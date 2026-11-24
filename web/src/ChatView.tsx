import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Markdown } from './markdown';
import type { ConversationWithMessages, Message } from './types';

/** The question just sent and the answer arriving for it. */
export interface Streaming {
  question: string;
  answer: string;
}

interface Props {
  detail: ConversationWithMessages | null;
  defaultModel: string | null;
  /** Models this gateway allows, and the one the next message uses. */
  models: string[];
  model: string | null;
  onModelChange(model: string): void;
  onBranch(messageId: string): void;
  streaming: Streaming | null;
  /** Resolves false if nothing was sent (the text stays in the box). */
  onSend(content: string): Promise<boolean>;
  onStop(): void;
  onRename(title: string): void;
  onDelete(): void;
}

function Bubble({ role, text, note, onBranch }: { role: Message['role']; text: string; note?: string; onBranch?(): void }) {
  return (
    <div className={`msg ${role}`}>
      <div className="who">{role === 'user' ? 'You' : 'Assistant'}</div>
      <div className="body">{role === 'assistant' ? <Markdown text={text} /> : <p className="plain">{text}</p>}</div>
      {note && <div className="note">{note}</div>}
      {onBranch && (
        <button type="button" className="ghost branch" onClick={onBranch} title="Start a new conversation from this point; this one stays unchanged">
          Branch from here
        </button>
      )}
    </div>
  );
}

export function ChatView({ detail, defaultModel, models, model, onModelChange, onBranch, streaming, onSend, onStop, onRename, onDelete }: Props) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(detail?.title ?? '');
  const end = useRef<HTMLDivElement>(null);
  const busy = streaming !== null;

  useEffect(() => setTitle(detail?.title ?? ''), [detail?.title]);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [detail?.messages.length, streaming?.answer]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;
    setDraft('');
    if (!(await onSend(content))) setDraft(content); // refused: give the text back
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const current = model ?? detail?.defaultModel ?? defaultModel;

  return (
    <section className="chat">
      <header className="chat-header">
        {detail && editing ? (
          <form
            className="rename"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) onRename(title.trim());
              setEditing(false);
            }}
          >
            <input aria-label="Conversation title" value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} />
            <button type="submit" className="primary">Save</button>
            <button type="button" className="ghost" onClick={() => setEditing(false)}>Cancel</button>
          </form>
        ) : (
          <h2 className="title">{detail ? detail.title || 'Untitled' : 'New chat'}</h2>
        )}
        <div className="header-actions">
          {models.length > 1 && current ? (
            <select className="model" aria-label="Model" value={current} disabled={busy} onChange={(e) => onModelChange(e.target.value)}>
              {/* keep the current one listed even if it was removed from Ollama since */}
              {[...new Set([current, ...models])].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            current && <span className="model" title="Model">{current}</span>
          )}
          {detail && !editing && (
            <>
              <button type="button" className="ghost" onClick={() => setEditing(true)}>Rename</button>
              <button type="button" className="ghost danger" onClick={onDelete} disabled={busy}>Delete</button>
            </>
          )}
        </div>
      </header>

      <div className="messages" aria-live="polite">
        {!detail && !streaming && (
          <div className="welcome muted">
            <p>Ask anything. It runs on this computer; nothing leaves it.</p>
          </div>
        )}
        {detail?.messages.map((m) => (
          <Bubble
            key={m.id}
            role={m.role}
            text={m.content}
            note={m.status === 'partial' ? 'This answer was cut off.' : m.status === 'error' ? 'This answer failed.' : undefined}
            onBranch={busy ? undefined : () => onBranch(m.id)}
          />
        ))}
        {streaming && (
          <>
            <Bubble role="user" text={streaming.question} />
            <Bubble role="assistant" text={streaming.answer || '…'} />
          </>
        )}
        <div ref={end} />
      </div>

      <form className="composer" onSubmit={submit}>
        <textarea
          aria-label="Message"
          placeholder="Message the assistant (Enter to send, Shift+Enter for a new line)"
          value={draft}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        {busy ? (
          <button type="button" className="stop" onClick={onStop}>Stop</button>
        ) : (
          <button type="submit" className="primary" disabled={!draft.trim()}>Send</button>
        )}
      </form>
    </section>
  );
}
