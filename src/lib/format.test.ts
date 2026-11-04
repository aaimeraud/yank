import { describe, expect, test } from "bun:test";
import { formatBytes, formatClock, formatDuration, formatEta, formatSpeed, plural } from "./format";

describe("formatClock", () => {
  test("minutes and hours", () => {
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(59.9)).toBe("0:59");
  });
  test("junk reads as zero", () => {
    expect(formatClock(-3)).toBe("0:00");
    expect(formatClock(Number.NaN)).toBe("0:00");
    expect(formatClock(null)).toBe("0:00");
  });
});

describe("formatDuration", () => {
  test("is empty when unknown", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(61)).toBe("1:01");
  });
});

describe("yt-dlp progress values", () => {
  test("speed", () => {
    expect(formatSpeed("2400000")).toBe("2.4 MB/s");
    expect(formatSpeed("51200.5")).toBe("51 KB/s");
    expect(formatSpeed("200")).toBe("1 KB/s");
    expect(formatSpeed("NA")).toBe("");
    expect(formatSpeed(null)).toBe("");
  });
  test("eta", () => {
    expect(formatEta("200")).toBe("3m 20s left");
    expect(formatEta("9")).toBe("9s left");
    expect(formatEta("0")).toBe("");
    expect(formatEta("NA")).toBe("");
  });
});

describe("formatBytes", () => {
  test("picks a unit", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1_536_000)).toBe("1.5 MB");
    expect(formatBytes(2_100_000_000)).toBe("2.1 GB");
    expect(formatBytes(null)).toBe("");
  });
});

test("plural", () => {
  expect(plural(1, "video")).toBe("1 video");
  expect(plural(0, "video")).toBe("0 videos");
  expect(plural(3, "video")).toBe("3 videos");
});
