import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryBackend } from "../src/services/memoryBackend";
import { setBackend } from "../src/services";
import { SourceControlPanel } from "../src/components/SourceControlPanel";
import { useUi } from "../src/stores/uiStore";
import { useWorkspace } from "../src/stores/workspaceStore";

describe("Source Control panel", () => {
  it("says what a pull or push is doing while it runs, and keeps the buttons off", async () => {
    const files = { "/ws/a.md": "A" };
    const backend = new MemoryBackend({ files, approved: ["/ws"], gitHead: files });
    setBackend(backend);
    useWorkspace.getState().setRoot("/ws");
    useUi.setState({ toasts: [], dialogs: [] });
    vi.spyOn(backend, "gitBranches").mockResolvedValue({ current: "main", branches: ["main"], upstream: "origin/main", ahead: 1, behind: 2, hasRemote: true });
    let finishPull!: () => void;
    vi.spyOn(backend, "gitPull").mockReturnValue(new Promise<void>((resolve) => (finishPull = resolve)));
    let finishPush!: () => void;
    vi.spyOn(backend, "gitPush").mockReturnValue(new Promise<void>((resolve) => (finishPush = resolve)));

    render(<SourceControlPanel />);
    const pull = await screen.findByRole("button", { name: "Pull, 2 to pull" });
    const status = document.querySelector<HTMLElement>(".scm-working")!;
    expect(status.textContent).toBe("");

    fireEvent.click(pull);
    await waitFor(() => expect(status.textContent).toBe("Pulling from origin/main…"));
    expect((screen.getByRole("button", { name: "Push, 1 to push" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finishPull());
    await waitFor(() => expect(status.textContent).toBe(""));

    fireEvent.click(screen.getByRole("button", { name: "Push, 1 to push" }));
    await waitFor(() => expect(status.textContent).toBe("Pushing to origin/main…"));
    await act(async () => finishPush());
    await waitFor(() => expect(status.textContent).toBe(""));
  });
});
