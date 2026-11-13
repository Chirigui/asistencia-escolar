import { createHmac } from "node:crypto";
import { createAdminClient } from "./supabase/admin";
export async function checkDistributedLimit(
  scope: string,
  ip: string,
  resource: string,
  limit: number,
) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return { allowed: false, retryAfterSeconds: 60, unavailable: true };
  const client = createAdminClient();
  const bucket = createHmac("sha256", secret)
    .update(JSON.stringify([scope, ip, resource]))
    .digest("hex");
  try {
    const { data, error } = await client.rpc("consume_request_limit", {
      p_bucket: bucket,
      p_limit: limit,
      p_seconds: 60,
    });
    if (error || !data || typeof data.allowed !== "boolean")
      return { allowed: false, retryAfterSeconds: 60, unavailable: true };
    return {
      allowed: data.allowed,
      retryAfterSeconds: Number(data.retryAfterSeconds) || 60,
      unavailable: false,
    };
  } catch {
    return { allowed: false, retryAfterSeconds: 60, unavailable: true };
  }
}
