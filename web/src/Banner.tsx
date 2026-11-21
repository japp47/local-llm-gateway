export interface Problem {
  message: string;
  hint?: string;
}

/** The gateway's plain message and what to do about it, e.g. "Ollama isn't running." */
export function Banner({ problem, onClose }: { problem: Problem; onClose(): void }) {
  return (
    <div className="banner" role="alert">
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
