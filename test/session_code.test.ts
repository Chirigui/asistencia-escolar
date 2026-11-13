import test from "node:test";
import assert from "node:assert/strict";
import { generateSessionCode } from "../src/lib/session-code.ts";

test("Generación de códigos de sesión", async (t) => {
  await t.test("usa el formato S + 6 caracteres no ambiguos", () => {
    for (let i = 0; i < 100; i += 1) {
      const code = generateSessionCode();
      assert.match(code, /^S[A-Z2-9]{6}$/);
      assert.equal(code.length, 7);
      assert.doesNotMatch(code, /[OI01]/);
    }
  });

  await t.test("genera códigos distintos en una muestra amplia", () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateSessionCode()));
    assert.ok(codes.size > 490, "se esperaban códigos prácticamente únicos");
  });

  await t.test("respeta una longitud personalizada", () => {
    assert.match(generateSessionCode(10), /^S[A-Z2-9]{10}$/);
  });
});
