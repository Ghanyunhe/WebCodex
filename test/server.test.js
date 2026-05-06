import assert from "node:assert/strict";
import test from "node:test";

import { server } from "../src/server.js";

test("server serves static app and protected config API", async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.match(await page.text(), /Codex Remote/);

    const denied = await fetch(`${baseUrl}/api/config`);
    assert.equal(denied.status, 401);

    const allowed = await fetch(`${baseUrl}/api/config`, {
      headers: { Authorization: "Bearer dev-token" }
    });
    assert.equal(allowed.status, 200);
    const config = await allowed.json();
    assert.equal(typeof config.defaultCwd, "string");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
