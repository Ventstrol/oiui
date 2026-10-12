"use client";

import type { ThreadSummary } from "./use-thread-history";

export interface ThreadSwitcherProps {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  loading?: boolean;
  disabled?: boolean;
  onSwitch: (threadId: string) => void;
  onNew: () => void;
  onRemove: (threadId: string) => void;
}

// Relative age like "5m ago"; falls back to the locale date for older threads.
// updated_at is unix seconds (agent contract); strings pass through Date.
function relativeTime(updatedAt: number | string): string {
  const then =
    typeof updatedAt === "number" ? updatedAt * 1000 : new Date(updatedAt).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

export function ThreadSwitcher({
  threads,
  activeThreadId,
  loading = false,
  disabled = false,
  onSwitch,
  onNew,
  onRemove,
}: ThreadSwitcherProps) {
  const activeKnown = threads.some((thread) => thread.thread_id === activeThreadId);
  return (
    <div className="thread-switcher">
      <select
        aria-label="Switch chat thread"
        value={activeThreadId ?? ""}
        disabled={disabled || loading}
        onChange={(event) => onSwitch(event.target.value)}
      >
        {!activeKnown && activeThreadId && <option value={activeThreadId}>New chat</option>}
        {threads.map((thread) => (
          <option key={thread.thread_id} value={thread.thread_id}>
            {thread.title || thread.thread_id} · {relativeTime(thread.updated_at)}
          </option>
        ))}
      </select>
      <button type="button" onClick={onNew} disabled={disabled}>
        New chat
      </button>
      <button
        type="button"
        onClick={() => activeThreadId && onRemove(activeThreadId)}
        disabled={disabled || !activeThreadId}
      >
        Delete
      </button>
    </div>
  );
}
