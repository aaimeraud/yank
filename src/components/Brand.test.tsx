// The header keeps a gap for the macOS traffic lights but draws no logo in it:
// the mark was removed (issue #10). A logo coming back would crowd the
// window buttons again.
import "../test/dom";
import { afterEach, describe, expect, test } from "bun:test";

const { render, cleanup } = await import("@testing-library/react");
const { default: Brand } = await import("./Brand");

afterEach(cleanup);

describe("Brand", () => {
  test("reserves the traffic-light gap without drawing a logo", () => {
    const { container, queryByRole } = render(<Brand />);
    expect(container.querySelector(".brand")).not.toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(queryByRole("img")).toBeNull();
  });
});
