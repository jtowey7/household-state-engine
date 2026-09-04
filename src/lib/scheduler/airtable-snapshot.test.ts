import { describe, expect, it } from "vitest";
import { readAirtableQueueSnapshot } from "./airtable-snapshot";
import { selectWork } from "./control-plane";

function response(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

describe("readAirtableQueueSnapshot", () => {
  it("reads the canonical queue, maps only executable metadata, and feeds deterministic selection", async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchImpl = async (
      url: string,
      init?: { method?: string },
    ) => {
      calls.push({ url, method: init?.method ?? "GET" });
      return response({
        records: [
          {
            id: "rec-blocked",
            fields: {
              Task: "Blocked P0",
              Priority: "P0",
              Status: "Blocked",
              "Directive kind": "WEEKLY_SHADOW_CYCLE",
              "Action policy": "PREPARE",
              Blocker: "Waiting on an external gate",
            },
          },
          {
            id: "rec-ready",
            fields: {
              Task: "Ready P1",
              Priority: "P1",
              Status: "Ready",
              "Directive kind": "WEEKLY_SHADOW_CYCLE",
              "Action policy": "PREPARE",
            },
          },
          {
            id: "rec-in-progress",
            fields: {
              Task: "Already being worked",
              Priority: "P0",
              Status: "In progress",
              "Directive kind": "WEEKLY_SHADOW_CYCLE",
              "Action policy": "PREPARE",
            },
          },
          {
            id: "rec-untyped",
            fields: {
              Task: "Untyped work",
              Priority: "P0",
              Status: "Ready",
            },
          },
        ],
      });
    };

    const result = await readAirtableQueueSnapshot(
      {
        lovableApiKey: "test-lovable-key",
        connectionKey: "test-connection-key",
        baseId: "appmqDptH3taN8uby",
        queueTable: "DEVELOPMENT QUEUE",
        gatewayUrl: "https://gateway.test/airtable",
      },
      fetchImpl,
      "2026-09-04T10:00:00.000Z",
    );

    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;

    expect(result.snapshot.mode).toBe("SYNTHETIC");
    expect(result.snapshot.directives).toHaveLength(4);
    expect(result.provenance).toContain("DEVELOPMENT QUEUE");

    const selection = selectWork(result.snapshot, {
      wakeAt: "2026-09-04T10:00:00.000Z",
    });

    expect(selection.selected).toBe(true);
    if (selection.selected) {
      expect(selection.directive.directiveId).toBe("AIRTABLE:rec-ready");
      expect(selection.directive.priority).toBe("P1");
      expect(selection.directive.status).toBe("READY");
    }

    expect(calls).toEqual([
      {
        url: "https://gateway.test/airtable/v0/appmqDptH3taN8uby/DEVELOPMENT%20QUEUE?pageSize=100",
        method: "GET",
      },
    ]);
  });

  it("reads every Airtable page before building the snapshot", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (!url.includes("offset=next-page")) {
        return response({
          records: [
            {
              id: "rec-page-1",
              fields: {
                Task: "First page",
                Priority: "P2",
                Status: "Complete",
                "Directive kind": "WEEKLY_SHADOW_CYCLE",
                "Action policy": "PREPARE",
              },
            },
          ],
          offset: "next-page",
        });
      }
      return response({
        records: [
          {
            id: "rec-page-2",
            fields: {
              Task: "Second page",
              Priority: "P0",
              Status: "Ready",
              "Directive kind": "STOCK_EXCEPTION_REVIEW",
              "Action policy": "PREPARE",
            },
          },
        ],
      });
    };

    const result = await readAirtableQueueSnapshot(
      {
        lovableApiKey: "key",
        connectionKey: "connection",
        baseId: "appmqDptH3taN8uby",
        queueTable: "DEVELOPMENT QUEUE",
        gatewayUrl: "https://gateway.test/airtable",
      },
      fetchImpl,
      "2026-09-04T10:00:00.000Z",
    );

    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    expect(result.snapshot.directives).toHaveLength(2);
    expect(result.snapshot.directives.map((directive) => directive.directiveId)).toEqual([
      "AIRTABLE:rec-page-1",
      "AIRTABLE:rec-page-2",
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("offset=next-page");
    expect(result.provenance).toContain("records=2");
  });

  it("fails closed on an unsuccessful Airtable read", async () => {
    const result = await readAirtableQueueSnapshot(
      {
        lovableApiKey: "key",
        connectionKey: "connection",
        baseId: "appmqDptH3taN8uby",
        queueTable: "DEVELOPMENT QUEUE",
        gatewayUrl: "https://gateway.test/airtable",
      },
      async () => response({ error: "forbidden" }, false, 403),
      "2026-09-04T10:00:00.000Z",
    );

    expect(result.status).toBe("FAILED");
    if (result.status === "FAILED") {
      expect(result.detail).toContain("403");
    }
  });

  it("fails closed when Airtable omits the records array", async () => {
    const result = await readAirtableQueueSnapshot(
      {
        lovableApiKey: "key",
        connectionKey: "connection",
        baseId: "appmqDptH3taN8uby",
        queueTable: "DEVELOPMENT QUEUE",
        gatewayUrl: "https://gateway.test/airtable",
      },
      async () => response({}),
      "2026-09-04T10:00:00.000Z",
    );

    expect(result.status).toBe("FAILED");
    if (result.status === "FAILED") {
      expect(result.detail).toContain("records array");
    }
  });
});
