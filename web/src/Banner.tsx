export interface Problem {
  message: string;
  hint?: string;
  /** 'info' for confirmations (e.g. a backup was saved); problems by default. */
  tone?: 'problem' | 'info';
}

/** The gateway's plain message and what to do about it, e.g. "Ollama isn't running." */
export function Banner({ problem, onClose }: { problem: Problem; onClose(): void }) {
  return (
    <div className={problem.tone === 'info' ? 'banner info' : 'banner'} role={problem.tone === 'info' ? 'status' : 'alert'}>
      <div>
        <strong>{problem.message}</strong>
        {problem.hint && <div className="hint">{problem.hint}</div>}
      </div>
      <button type="button" className="ghost" onClick={onClose} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
