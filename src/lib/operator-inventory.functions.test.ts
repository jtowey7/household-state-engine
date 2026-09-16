import { describe, expect, it } from "vitest";

import { buildAirtableInventoryRequest } from "./operator-inventory.functions";

describe("operator inventory Airtable route", () => {
  it("uses direct Airtable REST when Lovable is not configured", () => {
    const request = buildAirtableInventoryRequest({ baseId: "appTest" });

    expect(request.url).toContain("https://api.airtable.com/v0/appTest/");
    expect(request.url).not.toContain("connector-gateway.lovable.dev");
    expect(request.headers).toEqual({ Accept: "application/json" });
  });

  it("uses the Lovable gateway only when a non-blank key is configured", () => {
    const request = buildAirtableInventoryRequest({ baseId: "appTest", lovableApiKey: "  gateway-test-key  " });

    expect(request.url).toContain("https://connector-gateway.lovable.dev/airtable/v0/appTest/");
    expect(request.headers).toEqual({
      Authorization: "Bearer gateway-test-key",
      Accept: "application/json",
    });
  });

  it("treats whitespace-only Lovable configuration as absent", () => {
    const request = buildAirtableInventoryRequest({ baseId: "appTest", lovableApiKey: "   " });

    expect(request.url).toContain("https://api.airtable.com/v0/appTest/");
    expect(request.headers).toEqual({ Accept: "application/json" });
  });
});
