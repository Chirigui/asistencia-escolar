import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionWindow } from "../src/lib/session-window.ts";
test("default attendance window uses Colombia time and exactly ten minutes", () => {
  const value = sessionWindow(new Date("2026-11-13T15:34:27.123Z"));
  assert.equal(value.date, "2026-11-13");
  assert.equal(value.startTime, "10:34:27");
  assert.equal(value.endTime, "10:44:27");
  assert.equal(
    Date.parse(value.registration_closes_at) - Date.parse(value.registration_opens_at),
    600000,
  );
});
test("ten minute window can cross midnight and year boundaries", () => {
  const value = sessionWindow(new Date("2027-01-01T04:55:00Z"));
  assert.equal(value.date, "2026-12-31");
  assert.equal(value.startTime, "23:55:00");
  assert.equal(value.endTime, "00:05:00");
  assert.equal(value.registration_closes_at, "2027-01-01T05:05:00.000Z");
});
