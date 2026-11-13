import { test, expect } from "@playwright/test";
test("login has labeled controls and no horizontal overflow", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Bienvenido a tu aula" })).toBeVisible();
  await expect(page.getByLabel("Correo Institucional")).toBeVisible();
  await expect(page.getByLabel("Contraseña", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
test("attendance requires a QR and protects staff navigation", async ({ page }) => {
  await page.goto("/asistencia");
  await expect(
    page.getByText("Por favor escanea el código QR de tu clase para registrarte."),
  ).toBeVisible();
  await page.goto("/profesor");
  await expect(page).toHaveURL(/\/login$/);
});
test("anonymous clients cannot list or write school data", async ({ request }) => {
  for (const path of [
    "/api/sessions",
    "/api/academic",
    "/api/reports",
    "/api/reports/export",
    "/api/maintenance",
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
  const write = await request.post("/api/attendance/manual", {
    data: { sessionId: "10000000-0000-4000-8000-000000000001", document: "TEST00001" },
  });
  expect(write.status()).toBe(401);
  const cleanup = await request.post("/api/maintenance", {
    data: { action: "clear", confirmation: "BORRAR SESIONES DE PRUEBA" },
  });
  expect(cleanup.status()).toBe(401);
});
