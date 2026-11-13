import { test } from "node:test";
import assert from "node:assert/strict";
import { isSameOriginRequest } from "../src/lib/request-origin.ts";
test("same-origin uses the actual Host when Next's internal hostname differs", () => {
  assert.equal(
    isSameOriginRequest(
      new Request("http://localhost:3100/api/auth/login", {
        headers: { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" },
      }),
    ),
    true,
  );
  assert.equal(
    isSameOriginRequest(
      new Request("https://internal.vercel.app/api/maintenance", {
        headers: { host: "asistencia.example.edu", origin: "https://asistencia.example.edu" },
      }),
    ),
    true,
  );
});
test("missing, malformed, cross-host and cross-scheme origins are rejected", () => {
  for (const origin of [
    "null",
    "https://evil.example",
    "http://school.example",
    "https://school.example/path",
    "",
  ]) {
    assert.equal(
      isSameOriginRequest(
        new Request("https://school.example/api/maintenance", {
          headers: { host: "school.example", origin },
        }),
      ),
      false,
    );
  }
});
