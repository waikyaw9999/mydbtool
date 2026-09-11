import { deleteConnection, getStored, updateConnection } from "@/lib/connections/store";
import { toPublic } from "@/lib/connections/types";
import { validateConnectionInput } from "@/lib/connections/validation";
import { jsonError, jsonOk, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const stored = await getStored(id);
    if (!stored) return jsonError("Connection not found.", 404);
    return jsonOk({ connection: toPublic(stored) });
  } catch (err) {
    return jsonError(err, 500);
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const parsed = validateConnectionInput(await readJson(req));
    if (!parsed.ok) {
      return jsonError("Check the highlighted fields.", 400, { errors: parsed.errors });
    }
    const connection = await updateConnection(id, parsed.value);
    return jsonOk({ connection });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(err, message === "Connection not found." ? 404 : 500);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteConnection(id);
    return jsonOk({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(err, message === "Connection not found." ? 404 : 500);
  }
}
