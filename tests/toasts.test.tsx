import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Toasts } from "../src/components/Dialogs";
import { notify, toastDuration, useUi } from "../src/stores/uiStore";

const messages = () => useUi.getState().toasts.map((t) => t.message);

describe("notifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUi.setState({ toasts: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stay long enough to read: longer messages longer, errors at least 9 seconds, never over 20", () => {
    expect(toastDuration("success", "Saved.")).toBe(4000);
    expect(toastDuration("error", "Couldn't save.")).toBe(9000);
    const long = "Exported 12 of 14 pages to C:\\Users\\me\\Documents\\site. Couldn't export: setup.md, install.md, faq.md…";
    expect(toastDuration("warning", long)).toBe(2000 + long.length * 70);
    expect(toastDuration("warning", long)).toBeGreaterThan(8000);
    expect(toastDuration("info", "x".repeat(2000))).toBe(20_000);

    notify("warning", long);
    act(() => void vi.advanceTimersByTime(8000));
    expect(messages()).toEqual([long]);
    act(() => void vi.advanceTimersByTime(2000));
    expect(messages()).toEqual([]);
  });

  it("show the same message once, for its full time again", () => {
    notify("info", "No problems with a quick fix in this document.");
    act(() => void vi.advanceTimersByTime(3000));
    notify("info", "No problems with a quick fix in this document.");
    notify("info", "Another message.");
    expect(messages()).toEqual(["No problems with a quick fix in this document.", "Another message."]);
    // The repeated one counts from its second showing.
    act(() => void vi.advanceTimersByTime(3000));
    expect(messages()).toEqual(["No problems with a quick fix in this document.", "Another message."]);
    act(() => void vi.advanceTimersByTime(3000));
    expect(messages()).toEqual([]);
    // The same text as another kind is another notification.
    notify("info", "Done");
    notify("success", "Done");
    expect(messages()).toEqual(["Done", "Done"]);
  });

  it("stay while the pointer is over them or a button in them has the focus", () => {
    render(<Toasts />);
    act(() => notify("error", "Couldn't publish the folder."));
    const toast = screen.getByRole("alert");
    fireEvent.mouseEnter(toast);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("alert")).toBeTruthy();
    // After the pointer leaves there's still time to come back.
    fireEvent.mouseLeave(toast);
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.focus(screen.getByRole("button", { name: "Report…" }));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.blur(screen.getByRole("button", { name: "Report…" }));
    act(() => void vi.advanceTimersByTime(2500));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("go away at once when dismissed, with nothing left to fire later", () => {
    render(<Toasts />);
    act(() => notify("info", "Copied."));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(messages()).toEqual([]);
    // The same message shown again isn't cut short by the first one's timer.
    act(() => notify("info", "Copied."));
    act(() => void vi.advanceTimersByTime(3900));
    expect(messages()).toEqual(["Copied."]);
  });
});
