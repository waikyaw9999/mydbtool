import { resolveConnection } from "@/lib/connections/store";
import { previewObjects } from "@/lib/db/engines";
import { clampLimit, clampOffset } from "@/lib/db/query-safety";
import { jsonError, jsonOk, readJson } from "@/lib/api";
import type { PreviewTarget } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const conn = await resolveConnection(id);
    const body = (await readJson(req)) as PreviewTarget & { limit?: number; offset?: number };
    const result = await previewObjects(
      conn,
      {
        database: body.database,
        schema: body.schema,
        table: body.table,
        collection: body.collection,
      },
      clampLimit(body.limit),
      clampOffset(body.offset),
    );
    return jsonOk({ result });
  } catch (err) {
    return jsonError(err, 400);
  }
}
