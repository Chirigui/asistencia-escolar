export interface Cursor {
  timestamp: string;
  id: string;
}
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
export function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  if (value.length > 300 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid cursor");
  let cursor;
  try {
    cursor = JSON.parse(Buffer.from(value, "base64url").toString());
  } catch {
    throw new Error("Invalid cursor");
  }
  if (
    !cursor ||
    typeof cursor.timestamp !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)$/.test(cursor.timestamp) ||
    !Number.isFinite(Date.parse(cursor.timestamp)) ||
    typeof cursor.id !== "string" ||
    !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(cursor.id)
  )
    throw new Error("Invalid cursor");
  return cursor;
}
export function cursorFilter(column: string, cursor: Cursor): string {
  return `${column}.lt.${cursor.timestamp},and(${column}.eq.${cursor.timestamp},id.lt.${cursor.id})`;
}
