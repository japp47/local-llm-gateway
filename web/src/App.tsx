import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { Banner, type Problem } from './Banner';
import { ChatView, type Streaming } from './ChatView';
import { Sidebar } from './Sidebar';
import type { Conversation, ConversationWithMessages, Me } from './types';

type Phase = 'loading' | 'signedOut' | 'ready';

const asProblem = (err: unknown): Problem =>
  err instanceof ApiError ? { message: err.message, hint: err.hint } : { message: 'Something went wrong.', hint: String(err) };

export function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationWithMessages | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  /** The model for the next message; follows the open conversation's model. */
  const [model, setModel] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const abort = useRef<AbortController | null>(null);
  const started = useRef(false); // React's StrictMode runs effects twice in development

  const loadList = useCallback(async () => {
    const page = await api.conversations();
    setConversations(page.data);
    setNextCursor(page.nextCursor);
  }, []);

  // Sign in from the one-time link (#code=...), then load everything.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const code = new URLSearchParams(location.hash.slice(1)).get('code');
      if (code) {
        history.replaceState(null, '', location.pathname); // never leave the code in the address bar
        try {
          await api.signIn(code);
        } catch (err) {
          setProblem(asProblem(err));
        }
      }
      try {
        setMe(await api.me());
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return setPhase('signedOut');
        setProblem(asProblem(err));
        return setPhase('signedOut');
      }
      setPhase('ready');
      loadList().catch((err) => setProblem(asProblem(err)));
      api.defaultModel().then((m) => setDefaultModel(m.id), (err) => setProblem(asProblem(err)));
      api.models().then((m) => setModels(m.data.map((x) => x.id)), () => {}); // the banner above already explains failures
    })();
  }, [loadList]);

  const open = useCallback(async (id: string) => {
    setActiveId(id);
    try {
      const d = await api.conversation(id);
      setDetail(d);
      setModel(d.defaultModel);
    } catch (err) {
      setProblem(asProblem(err));
    }
  }, []);

  const newChat = () => {
    setActiveId(null);
    setDetail(null);
    setModel(null); // back to the gateway's default
  };

  /** Returns false when nothing was sent, so the composer keeps the text. */
  const send = async (content: string): Promise<boolean> => {
    setProblem(null);
    let id = activeId;
    try {
      if (!id) {
        const created = await api.create(model ? { model } : {});
        id = created.id;
        setActiveId(id);
      }
    } catch (err) {
      setProblem(asProblem(err));
      return false;
    }

    const controller = new AbortController();
    abort.current = controller;
    setStreaming({ question: content, answer: '' });
    let sent = true;
    try {
      await api.send(id, content, { model: model ?? undefined, signal: controller.signal }, {
        onDelta: (text) => setStreaming((s) => (s ? { ...s, answer: s.answer + text } : s)),
        onError: (err) => setProblem(asProblem(err)),
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setProblem(asProblem(err));
        sent = false; // refused before the answer started: nothing was saved
      }
    } finally {
      abort.current = null;
      setStreaming(null);
      await Promise.all([open(id), loadList()]).catch((err) => setProblem(asProblem(err)));
    }
    return sent;
  };

  const rename = async (title: string) => {
    if (!activeId) return;
    try {
      await api.rename(activeId, title);
      await Promise.all([open(activeId), loadList()]);
    } catch (err) {
      setProblem(asProblem(err));
    }
  };

  const remove = async () => {
    if (!activeId || !confirm('Delete this conversation? This cannot be undone.')) return;
    try {
      await api.remove(activeId);
      newChat();
      await loadList();
    } catch (err) {
      setProblem(asProblem(err));
    }
  };

  const backup = async () => {
    try {
      const b = await api.backup();
      setProblem({ tone: 'info', message: `Saved a backup of ${b.conversations} conversations.`, hint: b.file });
    } catch (err) {
      setProblem(asProblem(err)); // server mode explains it uses Postgres tools instead
    }
  };

  /** A new conversation with the history up to this message; the original stays as it is. */
  const branch = async (messageId: string) => {
    if (!activeId) return;
    try {
      const fork = await api.fork(activeId, messageId);
      await loadList();
      await open(fork.id);
      setProblem({ tone: 'info', message: 'Branched into a new conversation. The original is unchanged.' });
    } catch (err) {
      setProblem(asProblem(err));
    }
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    try {
      const page = await api.conversations(nextCursor);
      setConversations((c) => [...c, ...page.data]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setProblem(asProblem(err));
    }
  };

  const signOut = async () => {
    await api.signOut().catch(() => {});
    setPhase('signedOut');
    setMe(null);
  };

  if (phase === 'loading') return <div className="center muted">Loading…</div>;

  if (phase === 'signedOut') {
    return (
      <div className="center signed-out">
        {problem && <Banner problem={problem} onClose={() => setProblem(null)} />}
        <h1>Your private assistant</h1>
        <p>To sign in, run this in a terminal:</p>
        <pre className="code"><code>llm open</code></pre>
        <p className="muted">It opens this page already signed in. Nothing you type here leaves this computer.</p>
      </div>
    );
  }

  return (
    <div className="layout">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        hasMore={nextCursor !== null}
        email={me?.email ?? ''}
        onOpen={open}
        onNew={newChat}
        onMore={loadMore}
        onSignOut={signOut}
        onBackup={backup}
      />
      <main className="main">
        {problem && <Banner problem={problem} onClose={() => setProblem(null)} />}
        <ChatView
          key={activeId ?? 'new'}
          detail={detail}
          defaultModel={defaultModel}
          models={models}
          model={model}
          onModelChange={setModel}
          onBranch={branch}
          streaming={streaming}
          onSend={send}
          onStop={() => abort.current?.abort()}
          onRename={rename}
          onDelete={remove}
        />
      </main>
    </div>
  );
}
