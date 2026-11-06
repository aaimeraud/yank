// One fake backend for the tests that render hooks. Bun's mock.module is
// process-wide and patches modules already imported, so every hook test
// installs this same fake instead of mocking `api` its own way.
import { mock } from "bun:test";
import type { Stream } from "../types";

export const fake = {
  /** Pending stream lookups, answered by the test in any order. */
  lookups: [] as { url: string; resolve: (s: Stream) => void; reject: (e: unknown) => void }[],
  /** Ids whose file the backend reports gone. */
  missingFiles: [] as string[],
  /** Every update_playback call: [videoId, position, watched]. */
  saves: [] as [string, number, boolean][],
  reset() {
    this.lookups = [];
    this.missingFiles = [];
    this.saves = [];
    streamVideo.mockClear();
  },
};

export const streamVideo = mock(
  (url: string) => new Promise<Stream>((resolve, reject) => fake.lookups.push({ url, resolve, reject })),
);

mock.module("../api", () => ({
  api: {
    streamVideo,
    pruneMissingVideos: async (ids: string[]) => ids.filter((id) => fake.missingFiles.includes(id)),
    updatePlayback: async (id: string, position: number, watched: boolean) => {
      fake.saves.push([id, position, watched]);
    },
  },
}));
mock.module("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
