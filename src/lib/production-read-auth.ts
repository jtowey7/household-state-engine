export async function authorizeProductionRead(
  request: Request,
  cloudflareEnv: Record<string, unknown> | undefined,
  workerEnv: Record<string, unknown> | undefined,
): Promise<Response | undefined> {
  const expected = readToken(workerEnv) ?? readToken(cloudflareEnv);
  if (!expected) {
    return Response.json(
      { ok: false, mode: "PRODUCTION_READ_ONLY", error: "Production read credential is not configured" },
      { status: 503 },
    );
  }

  const supplied = readBearerToken(request.headers.get("authorization"));
  if (!supplied || supplied !== expected) {
    return Response.json(
      { ok: false, mode: "PRODUCTION_READ_ONLY", error: "Production read credential is invalid or missing" },
      { status: 401 },
    );
  }

  return undefined;
}

function readToken(env: Record<string, unknown> | undefined): string | undefined {
  const value = env?.FOODOS_PRODUCTION_READ_TOKEN;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBearerToken(header: string | null): string | undefined {
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}
