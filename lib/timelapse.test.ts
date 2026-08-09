import { describe, expect, it } from "vitest";

import {
  clipSeconds,
  formatClock,
  formatDuration,
  frameCount,
  FRAME_INTERVAL_SECONDS,
  OUT_FPS,
  SPEED,
  videoFilter,
} from "./timelapse";

const HOUR = 3600;

describe("the 400x contract", () => {
  it("keeps one frame every 13.33 seconds", () => {
    expect(FRAME_INTERVAL_SECONDS).toBeCloseTo(13.333, 3);
  });

  it("scales timestamps before resampling, not after", () => {
    // Measured against real ffmpeg output: this order is exact at 400s,
    // 1800s, 3600s and 7200s. The reverse (fps= then setpts=) overshoots by
    // 13x at every duration.
    expect(videoFilter()).toBe("setpts=PTS/400,fps=30");
    expect(videoFilter(60, 24)).toBe("setpts=PTS/60,fps=24");
  });

  it("turns a twelve-hour day into 108 seconds", () => {
    expect(clipSeconds(12 * HOUR)).toBe(108);
    expect(formatClock(clipSeconds(12 * HOUR))).toBe("1:48");
  });

  it("scales linearly, so a longer session is a longer clip", () => {
    expect(clipSeconds(1 * HOUR)).toBe(9);
    expect(clipSeconds(4 * HOUR)).toBe(36);
    expect(clipSeconds(8 * HOUR)).toBe(72);

    // The property that fixed-length episodes would break.
    expect(clipSeconds(8 * HOUR)).toBe(2 * clipSeconds(4 * HOUR));
  });

  it("counts the frames the clip is actually made of", () => {
    expect(frameCount(12 * HOUR)).toBe(3240);
    expect(frameCount(12 * HOUR)).toBe(Math.round(clipSeconds(12 * HOUR) * OUT_FPS));
  });

  it("does not invent frames for a session shorter than one interval", () => {
    expect(frameCount(5)).toBe(0);
    expect(frameCount(0)).toBe(0);
    expect(clipSeconds(0)).toBe(0);
  });

  it("treats a negative span as empty rather than throwing", () => {
    expect(clipSeconds(-60)).toBe(0);
    expect(frameCount(-60)).toBe(0);
  });

  it("holds the stated speed", () => {
    expect(SPEED).toBe(400);
    expect(clipSeconds(SPEED)).toBe(1);
  });
});

describe("formatting", () => {
  it("never elides hours from a session duration", () => {
    expect(formatDuration(12 * HOUR)).toBe("12h 0m");
    expect(formatDuration(HOUR + 720)).toBe("1h 12m");
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(9)).toBe("9s");
  });

  it("pads clip seconds", () => {
    expect(formatClock(108)).toBe("1:48");
    expect(formatClock(9)).toBe("0:09");
    expect(formatClock(0)).toBe("0:00");
  });
});
