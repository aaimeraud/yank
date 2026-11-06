import { expect, test } from "bun:test";
import { isWebUrl } from "./media";

test("web thumbnails are told apart from files on disk", () => {
  expect(isWebUrl("https://i.ytimg.com/vi/abc/hq720.jpg")).toBe(true);
  expect(isWebUrl("HTTP://example.com/a.jpg")).toBe(true);
  expect(isWebUrl("/Users/me/Movies/Yank/a [abc].jpg")).toBe(false);
  // A folder that happens to be named like a scheme is still a path.
  expect(isWebUrl("/Users/me/https:/a.jpg")).toBe(false);
});
