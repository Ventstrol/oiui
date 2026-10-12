"use client";

import { useState } from "react";
import type { ThreadSummary } from "./use-thread-history";

export const SIDEBAR_OPEN_KEY = "oiui:sidebar-open";

// Relative age like "5m ago"; falls back to the locale date for older threads.
// updated_at is unix seconds (agent contract); strings pass through Date.
export function relativeTime(updatedAt: number | string): string {
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

export type ThreadSidebarProps = {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  loading?: boolean;
  disabled?: boolean;
  /** Desktop: sidebar column visible. Persisted via SIDEBAR_OPEN_KEY. */
  open: boolean;
  /** Mobile: off-canvas drawer state (backdrop, dialog semantics). */
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  onSwitch: (threadId: string) => void;
  onRemove: (threadId: string) => void;
  onRename: (threadId: string, title: string) => void;
  onNewThread: () => void;
};

export function ThreadSidebar({
  threads,
  activeThreadId,
  loading = false,
  disabled = false,
  open,
  drawerOpen,
  onCloseDrawer,
  onSwitch,
  onRemove,
  onRename,
  onNewThread,
}: ThreadSidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startRename = (thread: ThreadSummary) => {
    setRenamingId(thread.thread_id);
    setDraft(thread.title);
  };
  const submitRename = () => {
    const title = draft.trim();
    if (!renamingId || !title) return;
    onRename(renamingId, title);
    setRenamingId(null);
  };

  const switchAndClose = (threadId: string) => {
    onCloseDrawer();
    onSwitch(threadId);
  };
  const newThreadAndClose = () => {
    onCloseDrawer();
    onNewThread();
  };

  const sidebarClasses = [
    "thread-sidebar",
    open ? "" : "closed",
    drawerOpen ? "drawer-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <aside
        className={sidebarClasses}
        aria-label="Chat history"
        {...(drawerOpen ? { role: "dialog", "aria-modal": true } : {})}
      >
        <div className="thread-sidebar-head">
          <span className="thread-sidebar-title">Chat history</span>
          <button
            type="button"
            className="thread-sidebar-new"
            onClick={newThreadAndClose}
            disabled={disabled}
          >
            New chat
          </button>
        </div>
        {loading ? (
          <p className="thread-empty">Loading chats…</p>
        ) : threads.length === 0 ? (
          <p className="thread-empty">No saved chats yet</p>
        ) : (
          <ul className="thread-list">
            {threads.map((thread) => {
              const active = thread.thread_id === activeThreadId;
              const renaming = thread.thread_id === renamingId;
              return (
                <li
                  key={thread.thread_id}
                  className={`thread-row${active ? " active" : ""}`}
                >
                  {renaming ? (
                    <div className="thread-rename">
                      <input
                        type="text"
                        className="thread-rename-input"
                        value={draft}
                        autoFocus
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            submitRename();
                          } else if (event.key === "Escape") {
                            event.stopPropagation();
                            setRenamingId(null);
                          }
                        }}
                        aria-label={`New title for ${thread.title}`}
                      />
                      <button
                        type="button"
                        className="thread-rename-save"
                        aria-label={`Save chat name ${thread.title}`}
                        onClick={submitRename}
                        disabled={!draft.trim()}
                      >
                        ✓
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="thread-open"
                        aria-current={active ? "true" : undefined}
                        onClick={() => switchAndClose(thread.thread_id)}
                        disabled={disabled}
                      >
                        <span className="thread-title">{thread.title}</span>
                        <span className="thread-meta">
                          {relativeTime(thread.updated_at)} · {thread.message_count} msg
                        </span>
                      </button>
                      <button
                        type="button"
                        className="thread-action"
                        aria-label={`Rename chat ${thread.title}`}
                        onClick={() => startRename(thread)}
                        disabled={disabled}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="thread-action"
                        aria-label={`Delete chat ${thread.title}`}
                        onClick={() => onRemove(thread.thread_id)}
                        disabled={disabled}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </aside>
      {drawerOpen && (
        <div className="thread-backdrop" aria-hidden="true" onClick={onCloseDrawer} />
      )}
    </>
  );
}

// Header icons: desktop collapse toggle and mobile hamburger. Visibility is
// pure CSS (media queries); both drive the same sidebar state in page.tsx.
export function SidebarToggles({
  sidebarOpen,
  drawerOpen,
  onToggle,
  onOpenDrawer,
}: {
  sidebarOpen: boolean;
  drawerOpen: boolean;
  onToggle: () => void;
  onOpenDrawer: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="sidebar-toggle"
        aria-label="Toggle chat history"
        aria-expanded={sidebarOpen}
        onClick={onToggle}
      >
        ☰
      </button>
      <button
        type="button"
        className="sidebar-hamburger"
        aria-label="Open chat history"
        aria-expanded={drawerOpen}
        onClick={onOpenDrawer}
      >
        ☰
      </button>
    </>
  );
}
