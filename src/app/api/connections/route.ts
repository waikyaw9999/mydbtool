import { createConnection, listConnections } from "@/lib/connections/store";
import { validateConnectionInput } from "@/lib/connections/validation";
import { jsonError, jsonOk, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonOk({ connections: await listConnections() });
  } catch (err) {
    return jsonError(err, 500);
  }
}

export async function POST(req: Request) {
  try {
    const parsed = validateConnectionInput(await readJson(req));
    if (!parsed.ok) {
      return jsonError("Check the highlighted fields.", 400, { errors: parsed.errors });
    }
    const connection = await createConnection(parsed.value);
    return jsonOk({ connection }, 201);
  } catch (err) {
    return jsonError(err, 500);
  }
}
