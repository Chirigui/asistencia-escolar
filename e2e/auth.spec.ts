import { test, expect } from "@playwright/test";
test.skip(
  process.env.AUTH_E2E_MOCK !== "true",
  "Requires isolated synthetic authentication service",
);
test("login commits cookies, verifies teacher role, and logout protects direct navigation", async ({
  page,
  context,
}) => {
  await page.goto("/profesor");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Correo Institucional").fill("teacher@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("wrong-fixture-password");
  await page.getByRole("button", { name: "Iniciar Sesión" }).click();
  await expect(page.getByRole("alert", { name: "Error de acceso" })).toContainText(
    "Verifica el correo",
  );
  await page.getByLabel("Contraseña", { exact: true }).fill("ci-fixture-password");
  await page.getByRole("button", { name: "Iniciar Sesión" }).click();
  await expect(page).toHaveURL(/\/profesor$/);
  await expect(page.getByText("teacher@example.invalid", { exact: true })).toBeVisible();
  expect((await context.cookies()).some((c) => c.name.includes("auth-token"))).toBeTruthy();
  expect((await context.request.get("/api/maintenance")).status()).toBe(403);
  expect((await context.request.get("/api/coordination?day=2026-11-18")).status()).toBe(403);
  await page.reload();
  await expect(page).toHaveURL(/\/profesor$/);
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/profesor");
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.request.get("/api/academic")).status()).toBe(401);
});

test("coordination remembers the expected group and keeps it pending without a class", async ({
  page,
}, testInfo) => {
  const day = testInfo.project.name === "desktop" ? "2026-11-19" : "2026-11-20";
  await page.goto("/login");
  await page.getByLabel("Correo Institucional").fill("admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("ci-fixture-password");
  await page.getByRole("button", { name: "Iniciar Sesión" }).click();
  await page.getByRole("button", { name: "Coordinación" }).click();
  await page.getByLabel("Fecha", { exact: true }).fill(day);
  await page.getByText("Grupos esperados (0)").click();
  await page.getByRole("checkbox", { name: "6A" }).check();
  await expect(page.getByText("Grupos esperados (1)")).toBeVisible();
  await expect(page.locator(".stat-card").getByText("6A", { exact: true })).toBeVisible();
  await expect(page.getByText("Todavía no hay clases registradas para esta fecha.")).toBeVisible();
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await expect(page.getByText("Grupos esperados (1)")).toBeVisible();
});
