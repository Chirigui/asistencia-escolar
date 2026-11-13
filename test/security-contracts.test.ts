import { strict as assert } from "node:assert";
import { test } from "node:test";
import { signQrToken, verifyQrToken } from "../src/lib/qr-token.ts";
import { encodeCursor, decodeCursor, cursorFilter } from "../src/lib/pagination.ts";
test("QR signature binds code, secret, expiration and format", () => {
  const now = Date.parse("2026-11-13T03:00:00Z"),
    token = signQrToken("SABCDEF", "test-secret", now);
  assert.equal(verifyQrToken("SABCDEF", token, "test-secret", now), true);
  assert.equal(verifyQrToken("SOTHER", token, "test-secret", now), false);
  assert.equal(verifyQrToken("SABCDEF", token, "other-secret", now), false);
  assert.equal(verifyQrToken("SABCDEF", token, "test-secret", now + 901000), false);
  assert.equal(verifyQrToken("SABCDEF", token + "x", "test-secret", now), false);
  assert.equal(verifyQrToken("SABCDEF", "bad", "test-secret", now), false);
});
test("cursor round-trip and rejection of filter injection", () => {
  const cursor = {
    timestamp: "2026-11-13T03:00:00.000Z",
    id: "10000000-0000-4000-8000-000000000001",
  };
  assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
  assert.equal(decodeCursor(null), null);
  assert.throws(() => decodeCursor(encodeCursor({ ...cursor, id: "bad),or(id.neq.0" })));
  assert.throws(() => decodeCursor("%%%"));
  assert.match(cursorFilter("created_at", cursor), /id.lt.10000000/);
});
