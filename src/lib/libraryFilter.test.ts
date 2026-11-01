import { describe, expect, test } from "bun:test";
import type { Video } from "../types";
import { ALL, UNFILED, filterVideos } from "./libraryFilter";

const video = (id: string, folderId: string | null): Video => ({
  id,
  title: `Video ${id}`,
  uploader: null,
  duration: null,
  thumbnail_path: null,
  source: "Youtube",
  url: `https://example.com/${id}`,
  file_path: null,
  watched: false,
  last_position: 0,
  folder_id: folderId,
});

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
