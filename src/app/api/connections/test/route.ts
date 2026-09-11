import { resolveConnection, resolvedFromInput } from "@/lib/connections/store";
import { validateConnectionInput } from "@/lib/connections/validation";
import { testConnection } from "@/lib/db/engines";
import { jsonError, jsonOk, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await readJson(req)) as Record<string, unknown>;
    if (typeof body.id === "string" && body.id && (body.password === undefined || body.password === "")) {
      const resolved = await resolveConnection(body.id);
      return jsonOk(await testConnection(resolved));
    }
    const parsed = validateConnectionInput(body);
    if (!parsed.ok) {
      return jsonError("Check the highlighted fields.", 400, { errors: parsed.errors });
    }
    return jsonOk(await testConnection(resolvedFromInput(parsed.value)));
  } catch (err) {
    return jsonError(err, 400);
  }
}
