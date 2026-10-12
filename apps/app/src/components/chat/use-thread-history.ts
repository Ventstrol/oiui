"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgent } from "@copilotkit/react-core/v2";

export const LAST_THREAD_KEY = "oiui:last-thread";

export interface ThreadSummary {
  thread_id: string;
  title: string;
  updated_at: string;
  message_count: number;
}

export interface DisplayableMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface PendingHydration {
  threadId: string;
  messages: DisplayableMessage[];
}

// Only user/assistant turns are safe to replay into the agent clone; tool and
// other internal roles are owned by the runtime.
export function filterToDisplayable(messages: unknown): DisplayableMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.filter(
    (message): message is DisplayableMessage =>
      !!message &&
      typeof message === "object" &&
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string",
  );
}

function generateThreadId(): string {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function persistActiveThreadId(id: string): void {
  try {
    localStorage.setItem(LAST_THREAD_KEY, id);
  } catch {
    // Storage may be unavailable (private mode); switching still works in-memory.
  }
}

function readStoredThreadId(): string | null {
  try {
    return localStorage.getItem(LAST_THREAD_KEY);
  } catch {
    return null;
  }
}

export interface ThreadHistoryState {
  activeThreadId: string | null;
  threads: ThreadSummary[];
  loading: boolean;
  refresh: () => Promise<void>;
  switchTo: (threadId: string) => Promise<void>;
  newThread: () => void;
  removeThread: (threadId: string) => Promise<void>;
  pendingHydrationRef: React.RefObject<PendingHydration | null>;
  hydrateTick: number;
}

export function useThreadHistory(): ThreadHistoryState {
  const generatedThreadIdRef = useRef<string | undefined>(undefined);
  if (!generatedThreadIdRef.current) generatedThreadIdRef.current = generateThreadId();

  // Optimistically adopt the stored pointer so the very first render already
  // targets it; the mount effect validates it against the server.
  const [activeThreadId, setActiveThreadId] = useState<string | null>(() =>
    readStoredThreadId(),
  );
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [hydrateTick, setHydrateTick] = useState(0);
  const activeThreadIdRef = useRef<string | null>(activeThreadId);
  const pendingHydrationRef = useRef<PendingHydration | null>(null);

  const requestHydration = useCallback(
    (threadId: string, messages: DisplayableMessage[]) => {
      pendingHydrationRef.current = { threadId, messages };
      setHydrateTick((tick) => tick + 1);
    },
    [],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/threads");
      if (response.ok) setThreads(await response.json());
    } catch {
      // Keep the last known list on network failure.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const stored = readStoredThreadId();
    const fallbackToFresh = () => {
      if (cancelled) return;
      const id = generatedThreadIdRef.current!;
      activeThreadIdRef.current = id;
      setActiveThreadId(id);
      persistActiveThreadId(id);
      void refresh();
    };
    if (!stored) {
      fallbackToFresh();
      return;
    }
    void (async () => {
      try {
        const response = await fetch(`/threads/${encodeURIComponent(stored)}`);
        if (!response.ok) throw new Error(`GET /threads/${stored} failed`);
        const data = await response.json();
        const messages = filterToDisplayable(data?.messages);
        if (messages.length === 0) throw new Error("stored thread has no messages");
        if (cancelled) return;
        persistActiveThreadId(stored);
        requestHydration(stored, messages);
        void refresh();
      } catch {
        fallbackToFresh();
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once per mount; remounts (e.g. provider session resets) re-validate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchTo = useCallback(
    async (id: string) => {
      if (!id || id === activeThreadIdRef.current) return;
      activeThreadIdRef.current = id;
      setActiveThreadId(id);
      persistActiveThreadId(id);
      try {
        const response = await fetch(`/threads/${encodeURIComponent(id)}`);
        if (!response.ok) return;
        const data = await response.json();
        const messages = filterToDisplayable(data?.messages);
        if (messages.length > 0) requestHydration(id, messages);
      } catch {
        // Switch still stands; the fresh clone just starts empty.
      }
    },
    [requestHydration],
  );

  const newThread = useCallback(() => {
    const id = generateThreadId();
    activeThreadIdRef.current = id;
    pendingHydrationRef.current = null;
    setActiveThreadId(id);
    persistActiveThreadId(id);
  }, []);

  const removeThread = useCallback(
    async (id: string) => {
      if (!id) return;
      try {
        await fetch(`/threads/${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch {
        // Refresh below reflects whatever the server kept.
      }
      await refresh();
      if (activeThreadIdRef.current === id) newThread();
    },
    [newThread, refresh],
  );

  return {
    activeThreadId,
    threads,
    loading,
    refresh,
    switchTo,
    newThread,
    removeThread,
    pendingHydrationRef,
    hydrateTick,
  };
}

export interface ThreadHydrationBridgeProps {
  threadId: string | null;
  pendingHydrationRef: React.RefObject<PendingHydration | null>;
  hydrateTick: number;
}

// Lives inside the CopilotKit provider tree. When the resolved agent matches a
// pending hydration (page load adoption or an explicit switch), it replaces the
// fresh clone's messages exactly once and clears the pending request.
export function ThreadHydrationBridge({
  threadId,
  pendingHydrationRef,
  hydrateTick,
}: ThreadHydrationBridgeProps) {
  const { agent } = useAgent({ agentId: "default", threadId: threadId ?? undefined });
  useEffect(() => {
    const pending = pendingHydrationRef.current;
    if (!pending || pending.threadId !== threadId || pending.messages.length === 0) return;
    agent.setMessages(pending.messages);
    pendingHydrationRef.current = null;
  }, [agent, threadId, hydrateTick, pendingHydrationRef]);
  return null;
}
