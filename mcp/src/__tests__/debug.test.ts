import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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


  it("should serve HTML page on GET /", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Meteo Italia MCP");
  });

  it("should handle EADDRINUSE gracefully", async () => {
    const portInUse = port; // This port is already in use by the beforeAll setup
    const server2 = startDebugServer(portInUse);

    // Simulate error since the real bind might take time or randomly succeed on another port depending on OS
    const errObj = new Error("EADDRINUSE");
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Emit the error manually to ensure the listener works
    server2.emit("error", errObj);

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("debug page unavailable"));

    // Ensure we close the second server to not leak
    server2.close();
    consoleErrorSpy.mockRestore();
  });
});
