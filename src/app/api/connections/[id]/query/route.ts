import { resolveConnection } from "@/lib/connections/store";
import { runMongo, runSql } from "@/lib/db/engines";
import {
  assertMongoAllowed,
  assertSqlAllowed,
  clampLimit,
  clampOffset,
} from "@/lib/db/query-safety";
import { jsonError, jsonOk, readJson } from "@/lib/api";
import type { QueryRequest, QueryResponse } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const conn = await resolveConnection(id);
    const body = (await readJson(req)) as QueryRequest;
    const limit = clampLimit(body.limit);
    const offset = clampOffset(body.offset);

    if (conn.engine === "mongo") {
      if (!body.mongo?.collection) {
        return jsonError("Select a collection and provide a find filter or aggregation pipeline.");
      }
      assertMongoAllowed(body.mongo.mode, conn.readOnly);
      const result = await runMongo(conn, body.mongo, limit, offset);
      return jsonOk({ result } satisfies { result: QueryResponse });
    }

    const sql = body.sql?.trim() ?? "";
    const analysis = assertSqlAllowed(sql, conn.readOnly);
    if (analysis.destructive && !body.confirmDestructive) {
      return jsonOk({
        result: {
          needsConfirmation: true,
          reason: `This statement includes ${analysis.destructiveKeywords.join(", ")}. Confirm to run it.`,
          keywords: analysis.destructiveKeywords,
        },
      });
    }
    const result = await runSql(conn, sql, limit);
    return jsonOk({ result });
  } catch (err) {
    return jsonError(err, 400);
  }
}
