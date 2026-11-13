import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanString,
  getClientIp,
  isValidDateString,
  isUuid,
  normalizeTimeString,
  readJsonObject,
} from "../src/lib/validation.ts";

test("Validación de UUID", async (t) => {
  await t.test("acepta UUID v4 válidos", () => {
    assert.equal(isUuid("550e8400-e29b-41d4-a716-446655440000"), true);
  });

  await t.test("rechaza formatos inválidos", () => {
    assert.equal(isUuid("no-es-uuid"), false);
    assert.equal(isUuid("550e8400-e29b-91d4-a716-446655440000"), false);
    assert.equal(isUuid(123), false);
  });
});

test("Validación de fechas", async (t) => {
  await t.test("acepta fechas reales", () => {
    assert.equal(isValidDateString("2026-11-12"), true);
    assert.equal(isValidDateString("2024-02-29"), true);
  });

  await t.test("rechaza fechas imposibles o con otro formato", () => {
    assert.equal(isValidDateString("2023-02-29"), false);
    assert.equal(isValidDateString("2026-13-01"), false);
    assert.equal(isValidDateString("12/11/2026"), false);
    assert.equal(isValidDateString("2026-1-1"), false);
  });
});

test("Normalización de horas", async (t) => {
  await t.test("normaliza HH:MM y HH:MM:SS", () => {
    assert.equal(normalizeTimeString("07:05"), "07:05:00");
    assert.equal(normalizeTimeString("23:59:59"), "23:59:59");
  });

  await t.test("rechaza horas fuera de rango", () => {
    assert.equal(normalizeTimeString("24:00"), null);
    assert.equal(normalizeTimeString("07:60"), null);
    assert.equal(normalizeTimeString("7:00"), null);
  });
});

test("Limpieza de cadenas", async (t) => {
  await t.test("recorta, limita y convierte números", () => {
    assert.equal(cleanString("  hola  ", 10), "hola");
    assert.equal(cleanString("abcdef", 3), "abc");
    assert.equal(cleanString(123, 10), "123");
  });

  await t.test("descarta objetos y valores nulos", () => {
    assert.equal(cleanString({}, 10), "");
    assert.equal(cleanString(null, 10), "");
  });
});

test("Lectura segura de cuerpos JSON", async (t) => {
  await t.test("acepta objetos JSON", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hola: "mundo" }),
    });
    assert.deepEqual(await readJsonObject(request), { hola: "mundo" });
  });

  await t.test("rechaza content-type incorrecto", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    assert.equal(await readJsonObject(request), null);
  });

  await t.test("rechaza arrays y JSON inválido", async () => {
    const arrayRequest = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "[]",
    });
    assert.equal(await readJsonObject(arrayRequest), null);

    const invalidRequest = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(await readJsonObject(invalidRequest), null);
  });

  await t.test("rechaza cuerpos declarados demasiado grandes", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "3000000",
      },
      body: "{}",
    });
    assert.equal(await readJsonObject(request), null);
  });
});

test("Obtención de IP del cliente", async (t) => {
  await t.test("usa la primera IP de x-forwarded-for", () => {
    const request = new Request("http://localhost/api/test", {
      headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
    });
    assert.equal(getClientIp(request), "203.0.113.10");
  });

  await t.test("usa x-real-ip como respaldo", () => {
    const request = new Request("http://localhost/api/test", {
      headers: { "x-real-ip": "198.51.100.7" },
    });
    assert.equal(getClientIp(request), "198.51.100.7");
  });
});

test("rechaza cuerpos chunked que superan el límite sin Content-Length", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2_000_001));
      controller.close();
    },
  });
  const request = new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  assert.equal(await readJsonObject(request), null);
});
