// CI only. Synthetic Supabase responses exercise the application's cookie/role flow.
// This server is not imported by the application and never connects to Supabase.
import http from "node:http";
import { randomUUID } from "node:crypto";
const tokens = new Map();
const send = (res, status, data, extra = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...extra });
  res.end(JSON.stringify(data));
};
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1:54321");
    if (url.pathname === "/health") return send(res, 200, { ready: true });
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (url.pathname === "/auth/v1/token") {
      let text = "";
      for await (const chunk of req) text += chunk;
      const body = JSON.parse(text || "{}");
      if (body.email !== "teacher@example.invalid" || body.password !== "ci-fixture-password")
        return send(res, 400, {
          error_code: "invalid_credentials",
          msg: "Invalid login credentials",
        });
      const sub = "70000000-0000-4000-8000-000000000001";
      const payload = {
        sub,
        aud: "authenticated",
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: randomUUID(),
      };
      const access =
        [{ alg: "HS256", typ: "JWT" }, payload]
          .map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
          .join(".") + ".c3ludGhldGlj";
      const user = {
        id: sub,
        aud: "authenticated",
        role: "authenticated",
        email: body.email,
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        created_at: "2026-01-01T00:00:00Z",
      };
      tokens.set(access, user);
      return send(res, 200, {
        access_token: access,
        refresh_token: randomUUID(),
        expires_in: 3600,
        token_type: "bearer",
        user,
      });
    }
    if (url.pathname === "/auth/v1/user")
      return tokens.has(token)
        ? send(res, 200, tokens.get(token))
        : send(res, 401, { msg: "Invalid token", code: "bad_jwt" });
    if (url.pathname === "/auth/v1/logout") {
      tokens.delete(token);
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === "/rest/v1/rpc/consume_request_limit")
      return send(res, 200, { allowed: true, retryAfterSeconds: 1 });
    if (!tokens.has(token)) return send(res, 401, { message: "Not authenticated" });
    if (url.pathname === "/rest/v1/profiles") return send(res, 200, [{ role: "teacher" }]);
    if (url.pathname === "/rest/v1/academic_periods")
      return send(res, 200, [
        {
          id: "71000000-0000-4000-8000-000000000001",
          name: "2026",
          starts_on: "2026-01-01",
          ends_on: "2026-12-31",
          active: true,
        },
      ]);
    if (url.pathname.startsWith("/rest/v1/")) return send(res, 200, [], { "Content-Range": "*/0" });
    return send(res, 404, { message: "Unexpected mock request" });
  })
  .listen(54321, "127.0.0.1", () => console.log("Synthetic auth service ready"));
