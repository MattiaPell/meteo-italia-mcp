import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startDebugServer } from "../debug.js";

describe("Debug Server Security", () => {
  let server: any;
  const port = 38472;
  const baseUrl = `http://127.0.0.1:${port}`;

  beforeAll(async () => {
    server = startDebugServer(port);
    await new Promise((r) => setTimeout(r, 100));
  });

  afterAll(() => {
    if (server) server.close();
  });

  it("should block requests missing x-debug-api header", async () => {
    const res = await fetch(`${baseUrl}/api/debug`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: "geocoding", params: {} }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("Forbidden: missing x-debug-api header");
  });

  it("should block unsafe reflection in service name", async () => {
    const res = await fetch(`${baseUrl}/api/debug`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-debug-api": "true" },
      body: JSON.stringify({ service: "__proto__", params: {} }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("unknown service: __proto__");
  });

  it("should reject toString service", async () => {
    const res = await fetch(`${baseUrl}/api/debug`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-debug-api": "true" },
      body: JSON.stringify({ service: "toString", params: {} }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("unknown service: toString");
  });
});
