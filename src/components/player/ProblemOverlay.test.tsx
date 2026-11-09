import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import ProblemOverlay from "./ProblemOverlay";

afterEach(cleanup);

const props = (streaming: boolean) => ({
  mode: "full" as const,
  problem: "It failed",
  streaming,
  onRetry: mock(() => {}),
  onOpenExternally: mock(() => {}),
});

describe("ProblemOverlay", () => {
  test("a file that cannot play offers the default player", () => {
    const p = props(false);
    const { getByText, queryByText } = render(<ProblemOverlay {...p} />);
    fireEvent.click(getByText("Open in default player"));
    expect(p.onOpenExternally).toHaveBeenCalledTimes(1);
    expect(queryByText("Try again")).toBeNull();
  });

  test("a stream that stopped offers a retry, never an external file", () => {
    const p = props(true);
    const { getByText, queryByText } = render(<ProblemOverlay {...p} />);
    fireEvent.click(getByText("Try again"));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
    expect(queryByText("Open in default player")).toBeNull();
  });

  test("the mini player does not call a file a stream", () => {
    const { getByText } = render(<ProblemOverlay {...props(false)} mode="mini" />);
    expect(getByText("Cannot play here")).toBeTruthy();
  });
});
