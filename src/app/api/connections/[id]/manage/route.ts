import { resolveConnection } from "@/lib/connections/store";
import { jsonError, jsonOk, readJson } from "@/lib/api";
import { parseManageRequest } from "@/lib/db/ddl";
import { runManage } from "@/lib/db/engines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const conn = await resolveConnection(id);
    const parsed = parseManageRequest(await readJson(req));
    const result = await runManage(conn, parsed);
    return jsonOk(result);
  } catch (err) {
    return jsonError(err, 400);
  }
}
