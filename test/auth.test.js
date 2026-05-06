import assert from "node:assert/strict";
import test from "node:test";

import { isAuthorized, readBearerToken } from "../src/auth.js";

test("readBearerToken trims the configured token", () => {
  assert.equal(readBearerToken({ CODEX_WEB_TOKEN: "  secret-token  " }), "secret-token");
});

test("readBearerToken falls back to dev token for local-only development", () => {
  assert.equal(readBearerToken({}), "dev-token");
});

test("isAuthorized accepts bearer token and query token", () => {
  const env = { CODEX_WEB_TOKEN: "secret-token" };
  assert.equal(isAuthorized({ headers: { authorization: "Bearer secret-token" }, url: "/" }, env), true);
  assert.equal(isAuthorized({ headers: {}, url: "/api/sessions?token=secret-token" }, env), true);
});

test("isAuthorized rejects missing or wrong tokens", () => {
  const env = { CODEX_WEB_TOKEN: "secret-token" };
  assert.equal(isAuthorized({ headers: {}, url: "/" }, env), false);
  assert.equal(isAuthorized({ headers: { authorization: "Bearer nope" }, url: "/" }, env), false);
});
