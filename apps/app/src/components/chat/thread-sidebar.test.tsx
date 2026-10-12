import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import {
  SidebarToggles,
  ThreadSidebar,
  type ThreadSidebarProps,
} from "./thread-sidebar";
import type { ThreadSummary } from "./use-thread-history";

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 3_600_000).toISOString();

const threads: ThreadSummary[] = [
  {
    thread_id: "t-1",
    title: "Bicycle gears",
    updated_at: hoursAgo(1),
    message_count: 4,
  },
  {
    thread_id: "t-2",
    title: "Weather in Bonn",
    updated_at: hoursAgo(26),
    message_count: 2,
  },
];

function setup(overrides: Partial<ThreadSidebarProps> = {}) {
  const props: ThreadSidebarProps = {
    threads,
    activeThreadId: "t-1",
    open: true,
    drawerOpen: false,
    disabled: false,
    onCloseDrawer: vi.fn(),
    onSwitch: vi.fn(),
    onRemove: vi.fn(),
    onRename: vi.fn(),
    onNewThread: vi.fn(),
    ...overrides,
  };
  const { rerender, container } = render(<ThreadSidebar {...props} />);
  return {
    props,
    container,
    rerender: (next: Partial<ThreadSidebarProps>) =>
      rerender(<ThreadSidebar {...props} {...next} />),
  };
}

// Stateful pairing of the header toggles with the sidebar so collapse/drawer
// state changes can be observed on the aside element (CSS is not under test).
function ToggleHarness() {
  const [open, setOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <>
      <SidebarToggles
        sidebarOpen={open}
        drawerOpen={drawerOpen}
        onToggle={() => setOpen((current) => !current)}
        onOpenDrawer={() => setDrawerOpen(true)}
      />
      <ThreadSidebar
        threads={threads}
        activeThreadId="t-1"
        open={open}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
        onSwitch={vi.fn()}
        onRemove={vi.fn()}
        onRename={vi.fn()}
        onNewThread={vi.fn()}
      />
    </>
  );
}

afterEach(cleanup);

describe("ThreadSidebar", () => {
  it("lists sessions with relative ages and highlights the active row", () => {
    setup();
    expect(screen.getByText("Bicycle gears")).toBeVisible();
    expect(screen.getByText("1h ago · 4 msg")).toBeVisible();
    expect(screen.getByText("Weather in Bonn")).toBeVisible();
    expect(screen.getByText("1d ago · 2 msg")).toBeVisible();
    const active = screen.getByRole("button", { name: /^Bicycle gears/ });
    expect(active).toHaveAttribute("aria-current", "true");
    expect(active.closest("li")).toHaveClass("active");
    expect(
      screen.getByRole("button", { name: /^Weather in Bonn/ }),
    ).not.toHaveAttribute("aria-current");
  });

  it("renders relative ages from unix-seconds updated_at (agent contract)", () => {
    // agent stores unix seconds; Date.prototype.getTime is milliseconds
    setup({
      threads: [
        {
          thread_id: "t-sec",
          title: "Seconds thread",
          // agent stores unix seconds; Date.prototype.getTime is milliseconds
          updated_at: (Math.floor(Date.now() / 1000) - 120) as unknown as string,
          message_count: 1,
        },
      ],
      activeThreadId: "t-sec",
    });
    expect(screen.getByText("2m ago · 1 msg")).toBeVisible();
  });

  it("shows an empty state when there are no saved chats", () => {
    setup({ threads: [] });
    expect(screen.getByText("No saved chats yet")).toBeVisible();
  });

  it("switches on row click and closes the drawer", () => {
    const { props } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: /^Weather in Bonn/ }),
    );
    expect(props.onSwitch).toHaveBeenCalledWith("t-2");
    expect(props.onCloseDrawer).toHaveBeenCalled();
  });

  it("renames via pencil; Enter saves the trimmed title and it is shown", () => {
    const { props, rerender } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Rename chat Weather in Bonn" }),
    );
    const input = screen.getByRole("textbox", {
      name: "New title for Weather in Bonn",
    }) as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Weather in Bonn");
    // select-on-focus: the whole title is preselected for quick replacement
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Weather in Bonn".length);
    fireEvent.change(input, { target: { value: "  Bonn weather  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onRename).toHaveBeenCalledTimes(1);
    expect(props.onRename).toHaveBeenCalledWith("t-2", "Bonn weather");
    rerender({
      threads: [threads[0], { ...threads[1], title: "Bonn weather" }],
    });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Bonn weather/ }),
    ).toBeVisible();
  });

  it("saves the rename from the ✓ button", () => {
    const { props } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Rename chat Weather in Bonn" }),
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Bonn weather" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save chat name Weather in Bonn" }),
    );
    expect(props.onRename).toHaveBeenCalledWith("t-2", "Bonn weather");
  });

  it("Escape cancels the rename without saving", () => {
    const { props } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Rename chat Weather in Bonn" }),
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Rename chat Weather in Bonn" }),
    ).toBeVisible();
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it("cannot save an empty or whitespace-only title", () => {
    const { props } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Rename chat Weather in Bonn" }),
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "   " } });
    expect(
      screen.getByRole("button", { name: "Save chat name Weather in Bonn" }),
    ).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it("deletes from the row ✕ without switching or closing the drawer", () => {
    const { props } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete chat Weather in Bonn" }),
    );
    expect(props.onRemove).toHaveBeenCalledWith("t-2");
    expect(props.onSwitch).not.toHaveBeenCalled();
    expect(props.onCloseDrawer).not.toHaveBeenCalled();
  });

  it("New chat starts a thread and closes the drawer", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(props.onNewThread).toHaveBeenCalled();
    expect(props.onCloseDrawer).toHaveBeenCalled();
  });
  it("exposes dialog semantics with a backdrop while the drawer is open", () => {
    const { container, props } = setup({ drawerOpen: true });
    const dialog = screen.getByRole("dialog", { name: "Chat history" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const backdrop = container.querySelector(
      ".thread-backdrop",
    ) as HTMLElement | null;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(props.onCloseDrawer).toHaveBeenCalled();
  });

  it("toggle collapses and expands the sidebar; hamburger opens the drawer", () => {
    const { container } = render(<ToggleHarness />);
    const aside = container.querySelector("aside.thread-sidebar")!;
    expect(aside).not.toHaveClass("closed");
    fireEvent.click(
      screen.getByRole("button", { name: "Toggle chat history" }),
    );
    expect(aside).toHaveClass("closed");
    fireEvent.click(
      screen.getByRole("button", { name: "Toggle chat history" }),
    );
    expect(aside).not.toHaveClass("closed");
    fireEvent.click(
      screen.getByRole("button", { name: "Open chat history" }),
    );
    expect(aside).toHaveClass("drawer-open");
  });
});
