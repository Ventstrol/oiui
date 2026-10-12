"use client";

import { useEffect, useRef, useState } from "react";
import { ProviderKeysDialog } from "@/components/chat/provider-keys-dialog";
import { useProviderKeys } from "@/components/chat/provider-keys";
import { KeyGatedChatView } from "@/components/chat/key-gated-chat-view";
import Image from "next/image";
import { ReaderScrollView } from "@/components/chat/reader-scroll-view";
import { AnswerMarkdown } from "@/components/chat/answer-markdown";
import { SIDEBAR_OPEN_KEY, SidebarToggles, ThreadSidebar } from "@/components/chat/thread-sidebar";
import {
  ThreadHydrationBridge,
  useThreadHistory,
} from "@/components/chat/use-thread-history";
import { CopilotChat, useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { useExampleSuggestions, useGenerativeUIExamples } from "@/hooks";

export default function HomePage() {
  useGenerativeUIExamples();
  useExampleSuggestions();
  const { agent } = useAgent();
  const { newChat, hasKeys, keysOpen, setKeysOpen } = useProviderKeys();
  const threadHistory = useThreadHistory();
  const { copilotkit } = useCopilotKit();
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const retryingRef = useRef(false);
  const chatRoot = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggleSidebar = () =>
    setSidebarOpen((current) => {
      try {
        localStorage.setItem(SIDEBAR_OPEN_KEY, current ? "0" : "1");
      } catch {
        // Storage may be unavailable; the toggle still works in-memory.
      }
      return !current;
    });
  // Mobile drawer: Escape closes it (as do the backdrop and row actions).
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);
  const latestQuestion = agent.messages.filter((message) => message.role === "user").at(-1)?.id;

  // Move only when a question is submitted. Streamed text and growing visuals
  // must never take scroll ownership from the reader.
  useEffect(() => {
    if (!latestQuestion || !chatRoot.current) return;
    const root = chatRoot.current;
    const revealQuestion = () => {
      const question = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="copilot-user-message"]'))
        .find((element) => element.dataset.messageId === latestQuestion);
      if (!question) return false;
      question.scrollIntoView?.({ block: "start", behavior: "instant" });
      return true;
    };
    if (revealQuestion()) return;
    const observer = new MutationObserver(() => {
      if (revealQuestion()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [latestQuestion]);

  useEffect(() => {
    const subscription = agent.subscribe({
      onRunInitialized: () => {
        setError(null);
      },
      onRunFinishedEvent: () => {
        setError(null);
      },
    });
    return () => subscription.unsubscribe();
  }, [agent]);

  const retry = async () => {
    if (retryingRef.current || agent.isRunning) return;
    retryingRef.current = true;
    setRetrying(true);
    setError(null);
    try {
      await copilotkit.runAgent({ agent });
    } catch {
      setError(
        "The agent is unavailable. Check your connection or local agent configuration, then retry.",
      );
    } finally {
      retryingRef.current = false;
      setRetrying(false);
    }
  };

  return (
    <div className="chat-app">
      <a className="chat-skip" href="#main-content">
        Skip to chat
      </a>
      <ThreadSidebar
        threads={threadHistory.threads}
        activeThreadId={threadHistory.activeThreadId}
        loading={threadHistory.loading}
        disabled={agent.isRunning || retrying}
        open={sidebarOpen}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
        onSwitch={(threadId) => void threadHistory.switchTo(threadId)}
        onRemove={(threadId) => void threadHistory.removeThread(threadId)}
        onRename={(threadId, title) => void threadHistory.rename(threadId, title)}
        onNewThread={() => {
          threadHistory.newThread();
          newChat();
        }}
      />
      <div className="chat-app-body">
        <header className="chat-header">
          <span className="chat-name">Open Intelligent UI</span>
          <nav aria-label="Main navigation">
            <SidebarToggles
              sidebarOpen={sidebarOpen}
              drawerOpen={drawerOpen}
              onToggle={toggleSidebar}
              onOpenDrawer={() => setDrawerOpen(true)}
            />
            <button type="button" onClick={() => setKeysOpen(true)} disabled={agent.isRunning || retrying} aria-haspopup="dialog">
              API keys{hasKeys ? " •" : ""}
            </button>
            <a
              href="https://github.com/CopilotKit/OpenIntelligentUI"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub ↗
            </a>
            <a
              className="chat-brand"
              href="https://copilotkit.ai"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Image
                src="/copilotkit-logo.svg"
                alt="CopilotKit"
                width={125}
                height={28}
                priority
              />
            </a>
          </nav>
        </header>
        {keysOpen && <ProviderKeysDialog onClose={() => setKeysOpen(false)} disabled={agent.isRunning || retrying} />}
        <main id="main-content" className="chat-main">
          {error && (
            <div className="chat-error" role="alert">
              <p>{error}</p>
              <button
                type="button"
                onClick={retry}
                disabled={retrying || agent.isRunning}
              >
                Retry answer
              </button>
              <button type="button" className="provider-keys-recover" disabled={retrying || agent.isRunning} onClick={() => setKeysOpen(true)}>API keys</button>
            </div>
          )}
          <div className="chat-content" ref={chatRoot}>
            <ThreadHydrationBridge
              threadId={threadHistory.activeThreadId}
              pendingHydrationRef={threadHistory.pendingHydrationRef}
              hydrateTick={threadHistory.hydrateTick}
            />
            <CopilotChat
              threadId={threadHistory.activeThreadId ?? undefined}
              chatView={KeyGatedChatView}
              autoScroll={false}
              scrollView={ReaderScrollView}
              messageView={{ assistantMessage: { markdownRenderer: AnswerMarkdown } }}
              onError={() =>
                setError(
                  "Something interrupted the answer. Try again or send another message.",
                )
              }
              labels={{
                welcomeMessageText: "What would you like to explore?",
                chatInputPlaceholder: "Ask anything…",
                chatDisclaimerText:
                  hasKeys ? "AI can make mistakes. Check important details." : "Add your OpenAI and Jev API keys to start. Keys clear when you refresh.",
              }}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
