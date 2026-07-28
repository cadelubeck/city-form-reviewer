import { createClient } from "@supabase/supabase-js";

const SUPABASE_TIMEOUT_MS = 12_000;

function timedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const timeout = AbortSignal.timeout(SUPABASE_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
}

export async function authenticatedSupabase(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!url || !anonKey || !token) return null;
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: timedFetch
    }
  });
  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return null;
    const profileResult = await client
      .from("team_profiles")
      .select("company_id")
      .eq("user_id", data.user.id)
      .maybeSingle();
    let profile = profileResult.data;

    if (profileResult.error) return null;
    if (!profile?.company_id) {
      const email = (data.user.email ?? "").toLowerCase();
      const { data: invite } = await client
        .from("company_invites")
        .select("id,company_id")
        .eq("email", email)
        .eq("status", "pending")
        .order("created_at")
        .limit(1)
        .maybeSingle();

      let companyId = invite?.company_id as string | null | undefined;
      if (!companyId) {
        const defaultName = String(data.user.user_metadata.company_name ?? "").trim()
          || email.split("@")[1]
          || "Engineering company";
        const { data: existingCompany } = await client
          .from("companies")
          .select("id")
          .eq("created_by", data.user.id)
          .limit(1)
          .maybeSingle();
        companyId = existingCompany?.id;
        if (!companyId) {
          const { data: company, error: companyError } = await client
            .from("companies")
            .insert({ name: defaultName, created_by: data.user.id })
            .select("id")
            .single();
          if (companyError) return null;
          companyId = company.id;
        }
      }

      const { data: updatedProfile, error: profileError } = await client.from("team_profiles").upsert({
        user_id: data.user.id,
        email: data.user.email ?? "",
        full_name: String(data.user.user_metadata.full_name ?? ""),
        company_id: companyId
      }, { onConflict: "user_id" }).select("company_id").single();
      if (profileError) return null;
      profile = updatedProfile;
      if (invite?.id) {
        await client.from("company_invites").update({ status: "accepted" }).eq("id", invite.id);
      }
    }

    return { client, user: data.user, companyId: profile.company_id as string };
  } catch {
    return null;
  }
}
