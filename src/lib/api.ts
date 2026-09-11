import { sanitizeError } from "@/lib/db/serialize";

export function jsonOk<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

export function jsonError(err: unknown, status = 400, extra?: Record<string, unknown>): Response {
  const message = typeof err === "string" ? err : sanitizeError(err);
  return Response.json({ error: message, ...extra }, { status });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new Error("Request body must be JSON.");
  }
}
