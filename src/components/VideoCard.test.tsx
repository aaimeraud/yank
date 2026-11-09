// The card menu must lift its card above the grid. It is absolutely
// positioned inside the card, so a card that keeps a transform from its
// entrance animation is its own stacking context and the menu paints under
// the next row. The class is the contract; `.card.menu-open` in App.css does
// the lifting.
import "../test/dom";
import { afterEach, describe, expect, test } from "bun:test";
import { makeVideo } from "../test/fixtures";

const { render, fireEvent, cleanup } = await import("@testing-library/react");
const { default: VideoCard } = await import("./VideoCard");

afterEach(cleanup);

const noop = () => {};

const actions = {
  play: noop,
  download: noop,
  redownload: noop,
  playNext: noop,
  queue: noop,
  reveal: noop,
  copyLink: noop,
  move: noop,
  remove: noop,
};

function Card({ selecting = false }: { selecting?: boolean }) {
  return (
    <VideoCard
      video={makeVideo("v1")}
      index={0}
      download={null}
      playing={false}
      folders={[]}
      selecting={selecting}
      selected={false}
      onToggleSelect={noop}
      actions={actions}
    />
  );
}

describe("the video card menu", () => {
  test("a right-click opens it and lifts the card", () => {
    const { container } = render(<Card />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).not.toContain("menu-open");

    fireEvent.contextMenu(card);

    expect(card.className).toContain("menu-open");
    expect(card.querySelector('[role="menu"]')).not.toBeNull();
  });

  test("the button opens it and lifts the card, and closing drops it", () => {
    const { container } = render(<Card />);
    const card = container.firstElementChild as HTMLElement;
    const button = card.querySelector(".card-menu-btn") as HTMLElement;

    fireEvent.click(button);
    expect(card.className).toContain("menu-open");

    fireEvent.click(button);
    expect(card.className).not.toContain("menu-open");
    expect(card.querySelector('[role="menu"]')).toBeNull();
  });

  test("switching to selection mode closes the menu and drops the lift", () => {
    const { container, rerender } = render(<Card />);
    const card = container.firstElementChild as HTMLElement;
    fireEvent.contextMenu(card);
    expect(card.className).toContain("menu-open");

    rerender(<Card selecting />);

    const selecting = container.firstElementChild as HTMLElement;
    expect(selecting.className).not.toContain("menu-open");
    expect(selecting.querySelector('[role="menu"]')).toBeNull();
  });
});

function menuLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent ?? "");
}

describe("download again", () => {
  // Regression: the action only makes sense for a video that has a file to
  // replace; a missing one is offered Download instead.
  test("is offered for a downloaded video, and not for a missing one", () => {
    const downloaded = render(
      <VideoCard video={makeVideo("v1", { file_path: "/library/v1.mp4" })} index={0} download={null} playing={false} folders={[]} selecting={false} selected={false} onToggleSelect={noop} actions={actions} />,
    );
    fireEvent.contextMenu(downloaded.container.firstElementChild as HTMLElement);
    expect(menuLabels(downloaded.container)).toContain("Download again…");
    downloaded.unmount();

    const missing = render(
      <VideoCard video={makeVideo("v1", { file_path: null })} index={0} download={null} playing={false} folders={[]} selecting={false} selected={false} onToggleSelect={noop} actions={actions} />,
    );
    fireEvent.contextMenu(missing.container.firstElementChild as HTMLElement);
    expect(menuLabels(missing.container)).not.toContain("Download again…");
  });
});
