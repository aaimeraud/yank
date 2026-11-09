import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import QualityPicker, { sizeText } from "./QualityPicker";
import type { QualityChoice } from "../types";

afterEach(() => {
  cleanup();
  clearMocks();
});

const CHOICE: QualityChoice = {
  title: "A video",
  is_playlist: false,
  options: [
    { format: "2160p", label: "2160p", detail: "AV1 · MP4", size: 712_445_280, approximate: false, plays_in_app: false },
    { format: "720p", label: "720p", detail: "H.264 · MP4", size: 87_293_859, approximate: true, plays_in_app: true },
  ],
};

describe("QualityPicker", () => {
  test("lists each quality with its size and sends the one picked", async () => {
    mockIPC((cmd) => (cmd === "list_qualities" ? CHOICE : null));
    const onPick = mock(() => {});
    const { findByText, getByText } = render(<QualityPicker url="u" onPick={onPick} onCancel={() => {}} />);
    await findByText("720p");
    expect(getByText("~87.3 MB")).toBeTruthy();
    expect(getByText(/may need another player/)).toBeTruthy();
    fireEvent.click(getByText("720p"));
    expect(onPick).toHaveBeenCalledWith("720p");
  });

  test("Enter lands on the best file the built-in player can open", async () => {
    mockIPC((cmd) => (cmd === "list_qualities" ? CHOICE : null));
    const { findByText } = render(<QualityPicker url="u" onPick={() => {}} onCancel={() => {}} />);
    await findByText("720p");
    await waitFor(() => expect(document.activeElement?.textContent).toContain("720p"));
  });

  test("shows why the lookup failed", async () => {
    mockIPC((cmd) => {
      if (cmd === "list_qualities") throw "Unsupported URL";
      return null;
    });
    const { findByRole } = render(<QualityPicker url="u" onPick={() => {}} onCancel={() => {}} />);
    await waitFor(async () => expect((await findByRole("alert")).textContent).toContain("Unsupported URL"));
  });

  test("what is behind the dialog is out of reach while it is open", () => {
    mockIPC(() => CHOICE);
    const behind = document.body.appendChild(Object.assign(document.createElement("div"), { className: "workspace" }));
    const { unmount } = render(<QualityPicker url="u" onPick={() => {}} onCancel={() => {}} />);
    expect(behind.hasAttribute("inert")).toBe(true);
    unmount();
    expect(behind.hasAttribute("inert")).toBe(false);
    behind.remove();
  });

  test("Escape cancels", async () => {
    mockIPC(() => CHOICE);
    const onCancel = mock(() => {});
    render(<QualityPicker url="u" onPick={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("sizeText", () => {
  test("exact, approximate, unknown and playlist", () => {
    expect(sizeText(1_500_000_000, false, false)).toBe("1.50 GB");
    expect(sizeText(5_000_000, true, false)).toBe("~5.0 MB");
    expect(sizeText(null, false, false)).toBe("Size unknown");
    expect(sizeText(null, false, true)).toBe("");
  });
});
