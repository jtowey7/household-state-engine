const COOKIE_NAME = "foodos_operator_session";
const MAX_AGE_SECONDS = 12 * 60 * 60;

type Environment = Record<string, unknown> | undefined;

function configuredToken(env: Environment): string | undefined {
  const value = env?.['FOODOS_OPERATOR_READ_TOKEN'];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array | undefined {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(payload: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), new TextEncoder().encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function constantTimeTokenMatch(candidate: string, expected: string): Promise<boolean> {
  const a = new TextEncoder().encode(candidate);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index]! ^ b[index]!;
  return diff === 0;
}

function operatorAuthorizationFailure(error: string, status: number): Response {
  return Response.json({ ok: false, error, detail: error, status: "NOT_READY" }, { status });
}

export async function createOperatorSession(token: string, env: Environment): Promise<Response> {
  const expected = configuredToken(env);
  if (!expected) return Response.json({ ok: false, error: "Operator read access is not configured" }, { status: 503 });
  if (!(await constantTimeTokenMatch(token.trim(), expected))) {
    return Response.json({ ok: false, error: "Invalid operator credential" }, { status: 401 });
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const payload = `${issuedAt}.${nonce}`;
  const session = `${payload}.${await sign(payload, expected)}`;

  return new Response(JSON.stringify({ ok: true, expiresAt: new Date((issuedAt + MAX_AGE_SECONDS) * 1000).toISOString() }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": `${COOKIE_NAME}=${session}; Max-Age=${MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`,
      "cache-control": "no-store",
    },
  });
}

export async function authorizeOperatorSession(request: Request, env: Environment): Promise<Response | undefined> {
  const expected = configuredToken(env);
  if (!expected) return operatorAuthorizationFailure("Operator read access is not configured", 503);

  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const session = match?.[1];
  if (!session) return operatorAuthorizationFailure("Operator session required", 401);

  const parts = session.split(".");
  if (parts.length !== 3) return operatorAuthorizationFailure("Invalid operator session", 401);
  const [issuedAtRaw, nonce, signature] = parts;
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isInteger(issuedAt) || !nonce || !signature) {
    return operatorAuthorizationFailure("Invalid operator session", 401);
  }
  if (Math.floor(Date.now() / 1000) - issuedAt < 0 || Math.floor(Date.now() / 1000) - issuedAt > MAX_AGE_SECONDS) {
    return operatorAuthorizationFailure("Operator session expired", 401);
  }

  const payload = `${issuedAt}.${nonce}`;
  const expectedSignature = await sign(payload, expected);
  const providedBytes = base64UrlToBytes(signature);
  const expectedBytes = base64UrlToBytes(expectedSignature);
  if (!providedBytes || !expectedBytes || providedBytes.length !== expectedBytes.length) {
    return operatorAuthorizationFailure("Invalid operator session", 401);
  }
  let diff = 0;
  for (let index = 0; index < providedBytes.length; index += 1) diff |= providedBytes[index]! ^ expectedBytes[index]!;
  if (diff !== 0) return operatorAuthorizationFailure("Invalid operator session", 401);

  return undefined;
}

export function clearOperatorSession(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`,
      "cache-control": "no-store",
    },
  });
}