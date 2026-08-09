import { describe, expect, it } from "vitest";

import { mintToken, TOKEN_TTL_MS, verifyToken } from "./media-token";

const SECRET = "a-secret";
const NOW = 1_700_000_000_000;

describe("media tokens", () => {
  it("accepts a token it just minted", () => {
    const token = mintToken("session-1", SECRET, NOW);
    const result = verifyToken(token, SECRET, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.sessionId).toBe("session-1");
  });

  it("refuses a token signed with a different secret", () => {
    const token = mintToken("session-1", SECRET, NOW);
    const result = verifyToken(token, "another-secret", NOW);

    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("refuses a token whose session id was swapped", () => {
    const token = mintToken("session-1", SECRET, NOW);
    const forged = token.replace("session-1", "session-2");

    expect(verifyToken(forged, SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("refuses a token whose expiry was pushed out", () => {
    const token = mintToken("session-1", SECRET, NOW);
    const [sessionId, , signature] = token.split(".");
    const forged = `${sessionId}.${NOW + 999_999}.${signature}`;

    expect(verifyToken(forged, SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("expires exactly at the ttl, not after it", () => {
    const token = mintToken("session-1", SECRET, NOW);

    expect(verifyToken(token, SECRET, NOW + TOKEN_TTL_MS - 1).ok).toBe(true);
    expect(verifyToken(token, SECRET, NOW + TOKEN_TTL_MS)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of ["", "a", "a.b", "a.b.c.d", "..", "a.notanumber.c"]) {
      expect(verifyToken(bad, SECRET, NOW).ok).toBe(false);
    }
  });
});
