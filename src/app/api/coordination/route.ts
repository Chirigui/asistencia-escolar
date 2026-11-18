import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isValidDateString, isUuid, readJsonObject } from "@/lib/validation";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const day = new URL(request.url).searchParams.get("day") || "";
  if (!isValidDateString(day)) return NextResponse.json({}, { status: 400 });
  const { data, error } = await auth.ctx.supabase.rpc("coordination_day", { p_day: day });
  return error ? NextResponse.json({}, { status: 500 }) : NextResponse.json(data);
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await readJsonObject(request);
  if (
    !body ||
    typeof body.day !== "string" ||
    !isValidDateString(body.day) ||
    typeof body.groupId !== "string" ||
    !isUuid(body.groupId) ||
    typeof body.expected !== "boolean"
  )
    return NextResponse.json({}, { status: 400 });
  const table = auth.ctx.supabase.from("daily_expected_groups");
  const { error } = body.expected
    ? await table.upsert(
        { day: body.day, group_id: body.groupId },
        { onConflict: "day,group_id", ignoreDuplicates: true },
      )
    : await table.delete().eq("day", body.day).eq("group_id", body.groupId);
  return NextResponse.json({ success: !error }, { status: error ? 500 : 200 });
}
