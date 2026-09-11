import { resolveConnection } from "@/lib/connections/store";
import { testConnection } from "@/lib/db/engines";
import { jsonError, jsonOk } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const conn = await resolveConnection(id);
    return jsonOk(await testConnection(conn));
  } catch (err) {
    return jsonError(err, 400);
  }
}
