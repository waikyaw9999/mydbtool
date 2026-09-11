import { resolveConnection } from "@/lib/connections/store";
import { listObjects } from "@/lib/db/engines";
import { jsonError, jsonOk } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const conn = await resolveConnection(id);
    const focus = new URL(req.url).searchParams.get("database") || undefined;
    return jsonOk({ objects: await listObjects(conn, focus) });
  } catch (err) {
    return jsonError(err, 400);
  }
}
