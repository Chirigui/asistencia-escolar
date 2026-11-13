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
  await expect(page.getByRole("alert")).toContainText("Verifica el correo");
  await page.getByLabel("Contraseña", { exact: true }).fill("ci-fixture-password");
  await page.getByRole("button", { name: "Iniciar Sesión" }).click();
  await expect(page).toHaveURL(/\/profesor$/);
  await expect(page.getByText("teacher@example.invalid", { exact: true })).toBeVisible();
  expect((await context.cookies()).some((c) => c.name.includes("auth-token"))).toBeTruthy();
  expect((await context.request.get("/api/maintenance")).status()).toBe(403);
  await page.reload();
  await expect(page).toHaveURL(/\/profesor$/);
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/profesor");
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.request.get("/api/academic")).status()).toBe(401);
});
