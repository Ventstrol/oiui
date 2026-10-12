import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useEffect } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import {
  LAST_THREAD_KEY,
  useThreadHistory,
  ThreadHydrationBridge,
  type ThreadHistoryState,
  type ThreadSummary,
} from "./use-thread-history";

// The hook's only CopilotKit dependency is useAgent; replace it so hydration
// can be observed without the real provider tree.
vi.mock("@copilotkit/react-core/v2", () => ({ useAgent: vi.fn() }));

type ThreadHistory = ThreadHistoryState;
const setMessages = vi.fn();
function jsonRoute(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(
  routes: Array<{
    method: string;
    url: string;
    body?: unknown;
    status?: number;
  }>,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const match = routes.find(
        (route) => route.method === method && String(url) === route.url,
      );
      if (!match) throw new Error(`unexpected fetch: ${method} ${url}`);
      return jsonRoute(match.body ?? {}, match.status);
    }),
  );
}

function Harness({ onState }: { onState: (state: ThreadHistory) => void }) {
  const state = useThreadHistory();
  useEffect(() => {
    onState(state);
  });
  return (
    <>
      <ThreadHydrationBridge
        threadId={state.activeThreadId}
        pendingHydrationRef={state.pendingHydrationRef}
        hydrateTick={state.hydrateTick}
      />
      <output data-testid="active">{state.activeThreadId ?? "none"}</output>
    </>
  );
}

const threadList: ThreadSummary[] = [
  {
    thread_id: "t-1",
    title: "Bicycle gears",
    updated_at: new Date("2026-10-12T00:00:00Z").toISOString(),
    message_count: 2,
  },
];

beforeEach(() => {
  localStorage.clear();
  setMessages.mockReset();
  vi.mocked(useAgent).mockClear();
  vi.mocked(useAgent).mockReturnValue({ agent: { setMessages } as never });
  let generated = 0;
  vi.stubGlobal("crypto", { randomUUID: () => `gen-${++generated}` });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useThreadHistory", () => {
  it("adopts the stored last thread on load and hydrates only displayable messages", async () => {
    localStorage.setItem(LAST_THREAD_KEY, "t-1");
    stubFetch([
      { method: "GET", url: "/threads", body: threadList },
      {
        method: "GET",
        url: "/threads/t-1",
        body: {
          thread_id: "t-1",
          title: "Bicycle gears",
          messages: [
            { id: "m1", role: "user", content: "hi" },
            { id: "m2", role: "tool", content: "internal" },
            { id: "m3", role: "assistant", content: "hello" },
          ],
        },
      },
    ]);
    render(<Harness onState={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("t-1"),
    );
    await waitFor(() =>
      expect(setMessages).toHaveBeenCalledWith([
        { id: "m1", role: "user", content: "hi" },
        { id: "m3", role: "assistant", content: "hello" },
      ]),
    );
    expect(localStorage.getItem(LAST_THREAD_KEY)).toBe("t-1");
    expect(fetch).toHaveBeenCalledWith("/threads");
  });

  it("falls back to a fresh generated thread when the stored one 404s", async () => {
    localStorage.setItem(LAST_THREAD_KEY, "t-gone");
    stubFetch([
      { method: "GET", url: "/threads", body: [] },
      { method: "GET", url: "/threads/t-gone", status: 404, body: { detail: "nope" } },
    ]);
    render(<Harness onState={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("gen-1"),
    );
    expect(localStorage.getItem(LAST_THREAD_KEY)).toBe("gen-1");
    expect(setMessages).not.toHaveBeenCalled();
  });

  it("generates and persists a fresh thread when no pointer is stored", async () => {
    stubFetch([{ method: "GET", url: "/threads", body: threadList }]);
    render(<Harness onState={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("gen-1"),
    );
    expect(localStorage.getItem(LAST_THREAD_KEY)).toBe("gen-1");
  });

  it("switchTo hydrates the target thread through the agent", async () => {
    stubFetch([
      { method: "GET", url: "/threads", body: threadList },
      {
        method: "GET",
        url: "/threads/t-1",
        body: {
          thread_id: "t-1",
          title: "Bicycle gears",
          messages: [{ id: "m1", role: "user", content: "hello" }],
        },
      },
    ]);
    let latest: ThreadHistory | undefined;
    render(<Harness onState={(state) => (latest = state)} />);
    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("gen-1"),
    );
    await act(async () => {
      await latest!.switchTo("t-1");
    });
    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("t-1"),
    );
    expect(setMessages).toHaveBeenCalledWith([
      { id: "m1", role: "user", content: "hello" },
    ]);
    expect(localStorage.getItem(LAST_THREAD_KEY)).toBe("t-1");
  });

  it("newThread resets to a fresh client-generated thread and clears the old pointer", async () => {
    stubFetch([{ method: "GET", url: "/threads", body: threadList }]);
    let latest: ThreadHistory | undefined;
    render(<Harness onState={(state) => (latest = state)} />);
    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("gen-1"),
    );
    act(() => {
      latest!.newThread();
    });
    expect(screen.getByTestId("active")).toHaveTextContent("gen-2");
    expect(localStorage.getItem(LAST_THREAD_KEY)).toBe("gen-2");
    expect(setMessages).not.toHaveBeenCalled();
  });

  it("removeThread deletes the thread and starts a new one when it was active", async () => {
    stubFetch([
      { method: "GET", url: "/threads", body: threadList },
      { method: "DELETE", url: "/threads/gen-1", body: { ok: true } },
      { method: "GET", url: "/threads", body: [] },
    ]);
    let latest: ThreadHistory | undefined;
    render(<Harness onState={(state) => (latest = state)} />);
    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("gen-1"),
    );
    await act(async () => {
      await latest!.removeThread("gen-1");
    });
    expect(fetch).toHaveBeenCalledWith("/threads/gen-1", { method: "DELETE" });
    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("gen-2"),
    );
    expect(localStorage.getItem(LAST_THREAD_KEY)).toBe("gen-2");
  });
});
