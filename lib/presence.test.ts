import { describe, expect, it } from "vitest";

import { PRESENCE_MS, SEEN_STAMP_MS, shouldStamp } from "./presence";

const NOW = 1_700_000_000_000;

describe("presence stamping", () => {
  /**
   * The one that matters. Presence is judged over PRESENCE_MS, and a row is
   * only refreshed every SEEN_STAMP_MS — so if the stamp interval ever grew
   * past the window, someone actively watching would blink out of the viewer
   * list between writes.
   */
  it("refreshes far more often than presence expires", () => {
    expect(SEEN_STAMP_MS).toBeLessThan(PRESENCE_MS);
    // Comfortably, not marginally: at least two refreshes inside a window.
    expect(SEEN_STAMP_MS * 2).toBeLessThanOrEqual(PRESENCE_MS);
  });

  it("skips the write while the row is fresh", () => {
    expect(shouldStamp(NOW, NOW)).toBe(false);
    expect(shouldStamp(NOW - 1_500, NOW)).toBe(false);
    expect(shouldStamp(NOW - (SEEN_STAMP_MS - 1), NOW)).toBe(false);
  });

  it("writes once the row is stale", () => {
    expect(shouldStamp(NOW - SEEN_STAMP_MS, NOW)).toBe(true);
    expect(shouldStamp(NOW - 60_000, NOW)).toBe(true);
  });

  it("collapses a minute of polling into a handful of writes", () => {
    let seenAt = NOW;
    let writes = 0;
    let polls = 0;

    // The real cadence: chat every 1.5s, for a minute.
    for (let t = NOW; t < NOW + 60_000; t += 1_500) {
      polls += 1;
      if (shouldStamp(seenAt, t)) {
        seenAt = t;
        writes += 1;
      }
    }

    expect(polls).toBe(40);
    expect(writes).toBeLessThanOrEqual(Math.ceil(60_000 / SEEN_STAMP_MS));
    // The point of the whole exercise: an order of magnitude fewer writes.
    expect(writes * 10).toBeLessThanOrEqual(polls);
    // And they never went stale enough to vanish from the viewer list.
    expect(NOW + 60_000 - seenAt).toBeLessThan(PRESENCE_MS);
  });
});
