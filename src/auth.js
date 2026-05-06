export function readBearerToken(env = process.env) {
  return (env.CODEX_WEB_TOKEN || "dev-token").trim();
}

export function isAuthorized(req, env = process.env) {
  const expected = readBearerToken(env);
  if (!expected) return false;

  const authorization = req.headers?.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (bearer === expected) return true;

  const url = new URL(req.url || "/", "http://localhost");
  return url.searchParams.get("token") === expected;
}
