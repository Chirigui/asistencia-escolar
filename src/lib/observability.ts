import { randomUUID } from "node:crypto";
export function logError(operation: string, error: unknown, correlationId?: string | null) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code).slice(0, 30)
      : "UNEXPECTED";
  const requestId =
    correlationId && /^[a-f0-9-]{36}$/i.test(correlationId) ? correlationId : randomUUID();
  console.error(
    JSON.stringify({ level: "error", operation, code, requestId, time: new Date().toISOString() }),
  );
  return requestId;
}
