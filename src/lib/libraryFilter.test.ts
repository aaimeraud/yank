import { describe, expect, test } from "bun:test";
import type { Video } from "../types";
import { makeVideo } from "../test/fixtures";
import { ALL, UNFILED, filterVideos } from "./libraryFilter";

const video = (id: string, folderId: string | null): Video =>
  makeVideo(id, { file_path: null, folder_id: folderId });

const videos = [video("a", "music"), video("b", null), video("c", "music"), video("d", "talks")];

describe("filterVideos", () => {
  test("all returns every video", () => {
    expect(filterVideos(videos, ALL).map((v) => v.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("unfiled keeps only videos without a folder", () => {
    expect(filterVideos(videos, UNFILED).map((v) => v.id)).toEqual(["b"]);
  });

  test("a folder keeps only its members", () => {
    expect(filterVideos(videos, "music").map((v) => v.id)).toEqual(["a", "c"]);
  });

  test("an unknown folder matches nothing", () => {
    expect(filterVideos(videos, "deleted")).toEqual([]);
  });

  test("an empty library stays empty for every selection", () => {
    expect(filterVideos([], ALL)).toEqual([]);
    expect(filterVideos([], UNFILED)).toEqual([]);
    expect(filterVideos([], "music")).toEqual([]);
  });
});

const playlistVideo = (id: string, index: number | null, playlistId: string) =>
  ({
    ...video(id, "list"),
    playlist_id: playlistId,
    playlist_index: index,
  }) satisfies Video;

describe("playlist order", () => {
  test("sorts a single-playlist folder by position, not download time", () => {
    // Downloaded 5, then 2, then 1: newest-first would show 5, 2, 1.
    const list = [
      playlistVideo("five", 5, "p1"),
      playlistVideo("two", 2, "p1"),
      playlistVideo("one", 1, "p1"),
    ];
    expect(filterVideos(list, "list").map((v) => v.id)).toEqual(["one", "two", "five"]);
  });

  test("orders a playlist around videos from elsewhere", () => {
    const list = [
      playlistVideo("five", 5, "p1"),
      { ...video("solo", "list"), playlist_id: null, playlist_index: null },
      playlistVideo("one", 1, "p1"),
    ];
    // The standalone keeps its slot; the playlist members sort around it.
    expect(filterVideos(list, "list").map((v) => v.id)).toEqual(["one", "solo", "five"]);
  });

  test("leaves a member without a position in its slot", () => {
    const list = [
      playlistVideo("none", null, "p1"),
      playlistVideo("two", 2, "p1"),
      playlistVideo("one", 1, "p1"),
    ];
    expect(filterVideos(list, "list").map((v) => v.id)).toEqual(["none", "one", "two"]);
  });

  test("sorts two playlists independently", () => {
    const list = [
      playlistVideo("a2", 2, "p1"),
      playlistVideo("b1", 1, "p2"),
      playlistVideo("a1", 1, "p1"),
      playlistVideo("b2", 2, "p2"),
    ];
    expect(filterVideos(list, "list").map((v) => v.id)).toEqual(["a1", "b1", "a2", "b2"]);
  });

  test("does not reorder the whole library", () => {
    const list = [
      playlistVideo("five", 5, "p1"),
      { ...video("solo", null), playlist_id: null, playlist_index: null },
      playlistVideo("one", 1, "p1"),
    ];
    expect(filterVideos(list, ALL).map((v) => v.id)).toEqual(["five", "solo", "one"]);
  });
});
