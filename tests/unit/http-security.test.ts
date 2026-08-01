import { describe, expect, it } from "vitest";

import { assertSameOrigin } from "../../apps/web/src/server/http-security";

describe("same-origin protection", () => {
  it("uses the request Host header behind a local or trusted reverse proxy", () => {
    const request = new Request("http://localhost:3000/api/auth/demo", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
      },
    });

    expect(assertSameOrigin(request)).toBeNull();
  });

  it("rejects a cross-origin mutation", async () => {
    const request = new Request("https://app.donelayer.test/api/tasks", {
      method: "POST",
      headers: {
        host: "app.donelayer.test",
        origin: "https://attacker.example",
      },
    });

    const response = assertSameOrigin(request);
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: "Origin not allowed." });
  });
});
