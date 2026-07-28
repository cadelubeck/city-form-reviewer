import { NextResponse } from "next/server";
import { authenticatedSupabase } from "@/lib/server-supabase";

export async function GET(request: Request) {
  const auth = await authenticatedSupabase(request);
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  await auth.client.from("team_profiles").upsert({
    user_id: auth.user.id,
    email: auth.user.email ?? "",
    full_name: String(auth.user.user_metadata.full_name ?? ""),
    role: "reviewer"
  }, { onConflict: "user_id", ignoreDuplicates: true });
  const [{ data: members, error }, { data: invites }] = await Promise.all([
    auth.client.from("team_profiles").select("*").order("full_name"),
    auth.client.from("company_invites").select("*").order("created_at", { ascending: false })
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ members: members ?? [], invites: invites ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticatedSupabase(request);
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json();
  if (body.action === "profile") {
    const { data, error } = await auth.client.from("team_profiles").upsert({
      user_id: auth.user.id,
      email: auth.user.email ?? "",
      full_name: String(body.fullName ?? "").slice(0, 160),
      company_name: String(body.companyName ?? "").slice(0, 180),
      role: ["reviewer", "manager", "admin"].includes(body.role) ? body.role : "reviewer"
    }, { onConflict: "user_id" }).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  const { data, error } = await auth.client.from("company_invites").insert({
    inviter_id: auth.user.id,
    company_id: auth.companyId,
    email
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
