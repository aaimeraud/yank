import { describe, expect, test } from "bun:test";
import { makeVideo } from "../test/fixtures";
import { ALL } from "./libraryFilter";
import { DEFAULT_QUERY, isFiltered, sortVideos, sourceCounts, totalDuration, viewVideos, type LibraryQuery } from "./libraryView";

const library = [
  makeVideo("zoo", { title: "Me at the zoo", uploader: "jawed", duration: 19, source: "youtube" }),
  makeVideo("talk", { title: "Électro set", uploader: "DJ", duration: 3600, source: "twitch:vod", watched: true }),
  makeVideo("tweet", { title: "Launch day", uploader: "NASA", duration: 45, source: "twitter" }),
  makeVideo("vimeo", { title: "Short film", uploader: null, duration: null, source: "vimeo", file_path: null }),
];

const query = (patch: Partial<LibraryQuery> = {}): LibraryQuery => ({ folder: ALL, ...DEFAULT_QUERY, ...patch });
const ids = (patch: Partial<LibraryQuery>) => viewVideos(library, query(patch)).map((v) => v.id);

describe("viewVideos", () => {
  test("no filters keeps the library order", () => {
    expect(ids({})).toEqual(["zoo", "talk", "tweet", "vimeo"]);
  });

  test("search matches title or uploader, ignoring case and accents", () => {
    expect(ids({ search: "ZOO" })).toEqual(["zoo"]);
    expect(ids({ search: "nasa" })).toEqual(["tweet"]);
    expect(ids({ search: "electro" })).toEqual(["talk"]);
    expect(ids({ search: "   " })).toEqual(["zoo", "talk", "tweet", "vimeo"]);
    expect(ids({ search: "nothing like this" })).toEqual([]);
  });

  test("source chips combine as OR", () => {
    expect(ids({ sources: ["twitch"] })).toEqual(["talk"]);
    expect(ids({ sources: ["youtube", "twitter"] })).toEqual(["zoo", "tweet"]);
    expect(ids({ sources: ["other"] })).toEqual(["vimeo"]);
  });

  test("status filters", () => {
    expect(ids({ status: "watched" })).toEqual(["talk"]);
    // Unwatched means "ready to watch": a missing file is not offered.
    expect(ids({ status: "unwatched" })).toEqual(["zoo", "tweet"]);
    expect(ids({ status: "missing" })).toEqual(["vimeo"]);
  });

  test("filters stack", () => {
    expect(ids({ sources: ["youtube", "twitter"], search: "launch" })).toEqual(["tweet"]);
  });
});

describe("sortVideos", () => {
  test("title, numeric-aware and case-insensitive", () => {
    const list = [makeVideo("b", { title: "Part 10" }), makeVideo("a", { title: "part 2" }), makeVideo("c", { title: "Alpha" })];
    expect(sortVideos(list, "title").map((v) => v.id)).toEqual(["c", "a", "b"]);
  });

  test("longest first, unknown durations last", () => {
    expect(sortVideos(library, "duration").map((v) => v.id)).toEqual(["talk", "tweet", "zoo", "vimeo"]);
  });

  test("playlist order groups each playlist and sorts by position", () => {
    const list = [
      makeVideo("b2", { playlist_id: "b", playlist_index: 2 }),
      makeVideo("solo"),
      makeVideo("a1", { playlist_id: "a", playlist_index: 1 }),
      makeVideo("b1", { playlist_id: "b", playlist_index: 1 }),
    ];
    expect(sortVideos(list, "playlist").map((v) => v.id)).toEqual(["a1", "b1", "b2", "solo"]);
  });

  test("never mutates its input", () => {
    const before = library.map((v) => v.id);
    sortVideos(library, "title");
    expect(library.map((v) => v.id)).toEqual(before);
  });
});

test("isFiltered ignores the folder and the sort", () => {
  expect(isFiltered(query({ sort: "title", folder: "f1" }))).toBe(false);
  expect(isFiltered(query({ search: "x" }))).toBe(true);
  expect(isFiltered(query({ sources: ["twitch"] }))).toBe(true);
  expect(isFiltered(query({ status: "watched" }))).toBe(true);
});

test("sourceCounts and totalDuration describe the folder", () => {
  expect(sourceCounts(library)).toEqual({ all: 4, youtube: 1, twitter: 1, twitch: 1, other: 1 });
  expect(totalDuration(library)).toBe(19 + 3600 + 45);
});
