import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ThreadSwitcher, type ThreadSwitcherProps } from "./thread-switcher";
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

function setup(overrides: Partial<ThreadSwitcherProps> = {}) {
  const props: ThreadSwitcherProps = {
    threads,
    activeThreadId: "t-1",
    disabled: false,
    onSwitch: vi.fn(),
    onNew: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
  render(<ThreadSwitcher {...props} />);
  return props;
}

afterEach(() => cleanup());

describe("ThreadSwitcher", () => {
  it("renders thread options with titles and relative ages", () => {
    setup();
    const select = screen.getByRole("combobox", { name: "Switch chat thread" });
    expect(select).toHaveValue("t-1");
    expect(select).toHaveTextContent("Bicycle gears · 1h ago");
    expect(select).toHaveTextContent("Weather in Bonn · 1d ago");
  });

  it("shows a placeholder option when the active thread is not in the list yet", () => {
    setup({ activeThreadId: "t-fresh", threads: [] });
    const select = screen.getByRole("combobox", { name: "Switch chat thread" });
    expect(select).toHaveValue("t-fresh");
    expect(select).toHaveTextContent("New chat");
  });

  it("calls onSwitch when another thread is selected", () => {
    const props = setup();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Switch chat thread" }),
      { target: { value: "t-2" } },
    );
    expect(props.onSwitch).toHaveBeenCalledWith("t-2");
  });

  it("calls onNew and onRemove for the selected thread", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(props.onNew).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onRemove).toHaveBeenCalledWith("t-1");
  });

  it("disables switching and actions while a run is active", () => {
    setup({ disabled: true });
    expect(
      screen.getByRole("combobox", { name: "Switch chat thread" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "New chat" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });
});
