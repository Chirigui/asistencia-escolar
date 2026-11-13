import { signQrToken } from "./qr-token";
export function sessionUrl(base: string, code: string, required: boolean) {
  const url = new URL("/asistencia", base);
  url.searchParams.set("sesion", code);
  if (required) {
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error("Missing QR signing configuration");
    url.searchParams.set("token", signQrToken(code, secret));
  }
  return url.toString();
}
