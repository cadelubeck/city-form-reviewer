import { NextResponse } from "next/server";
import { authenticatedSupabase } from "@/lib/server-supabase";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticatedSupabase(request);
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  const { error } = await auth.client.from("engineering_documents")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
