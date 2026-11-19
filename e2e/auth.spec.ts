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

test("docente descarga una lista numerada con el período seleccionado", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo Institucional").fill("teacher@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("ci-fixture-password");
  await page.getByRole("button", { name: "Iniciar Sesión" }).click();
  await page.getByRole("button", { name: "Reportes", exact: true }).click();
  await page.getByLabel("Fecha Desde").fill("2026-11-18");
  await page.getByLabel("Fecha Hasta").fill("2026-11-18");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar lista CSV" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("lista-asistencia_2026-11-18_2026-11-18.csv");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain('"N.º";"Estudiante";"Documento"');
  expect(csv).toContain('"1";"Ana Beltrán";"00123"');
  expect(csv).toContain('"Presente";"07:03:00";"QR"');
});

test("administración descarga el resumen semestral de su grupo", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo Institucional").fill("admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("ci-fixture-password");
  await page.getByRole("button", { name: "Iniciar Sesión" }).click();
  await page.getByRole("button", { name: "Reportes", exact: true }).click();
  await page.getByRole("link", { name: "Listas semestrales por grupo" }).click();
  await page.getByRole("link", { name: "6A", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Asistencia de 6A" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Tarde", exact: true })).toBeVisible();
  const event = page.waitForEvent("download");
  await page.getByRole("link", { name: "Descargar Excel" }).click();
  const download = await event;
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile((await download.path())!);
  const sheet = book.worksheets[0];
  expect(sheet.getCell("A5").value).toBe("Ana Beltrán");
  expect(sheet.getCell("F5").value).toBe(1);
  expect(sheet.getCell("G5").value).toBe("Tarde");
});
