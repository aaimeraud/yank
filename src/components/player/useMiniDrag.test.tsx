import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { useMiniDrag } from "./useMiniDrag";

afterEach(cleanup);

function Harness({ onCorner, onClick }: { onCorner: () => void; onClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useMiniDrag(ref, true, onCorner);
  return (
    <div ref={ref} data-testid="shell">
      <video data-testid="picture" onClick={onClick} />
      <button data-testid="control" />
    </div>
  );
}

function setup() {
  const onCorner = mock(() => {});
  const onClick = mock(() => {});
  const view = render(<Harness onCorner={onCorner} onClick={onClick} />);
  return { onCorner, onClick, picture: view.getByTestId("picture"), control: view.getByTestId("control") };
}

const at = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, bubbles: true });
const press = (el: Element, x = 500, y = 500) => fireEvent.pointerDown(el, at(x, y));
const moveTo = (x: number, y: number) => fireEvent.pointerMove(window, at(x, y));
const release = (x: number, y: number) => fireEvent.pointerUp(window, at(x, y));

describe("useMiniDrag", () => {
  test("a press without movement stays a click", () => {
    const { picture, onCorner, onClick } = setup();
    press(picture);
    release(500, 500);
    fireEvent.click(picture);
    expect(onCorner).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("a drag picks a corner and swallows the click that follows", () => {
    const { picture, onCorner, onClick } = setup();
    press(picture);
    moveTo(100, 100);
    release(100, 100);
    fireEvent.click(picture);
    expect(onCorner).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  test("Esc abandons the drag, and the release does not open the player", () => {
    const { picture, onCorner, onClick } = setup();
    press(picture);
    moveTo(100, 100);
    fireEvent.keyDown(window, { key: "Escape" });
    moveTo(50, 50);
    release(50, 50);
    fireEvent.click(picture);
    expect(onCorner).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  test("buttons keep their own meaning", () => {
    const { control, onCorner } = setup();
    press(control);
    moveTo(100, 100);
    release(100, 100);
    expect(onCorner).not.toHaveBeenCalled();
  });
});
