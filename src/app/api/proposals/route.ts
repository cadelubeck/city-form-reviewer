import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticatedSupabase } from "@/lib/server-supabase";

export const maxDuration = 300;

function detectSections(text: string) {
  const sections = text.split("\n").flatMap((line, startLine) => {
    const title = line.trim();
    const isHeading =
      /^\d+(\.\d+)*[.)]\s+\S/.test(title) ||
      /^(SECTION|ARTICLE|CHAPTER|PART)\s+[\dIVX]/i.test(title) ||
      (/^[A-Z][A-Z\s\-:/]{3,60}$/.test(title) && !/[a-z]/.test(title));
    return isHeading && title.length <= 120
      ? [{ id: crypto.randomUUID(), title, startLine, score: "green", notes: "" }]
      : [];
  });
  return sections.length
    ? sections
    : [{ id: crypto.randomUUID(), title: "Full document", startLine: 0, score: "green", notes: "" }];
}

function prepareProposal(form: FormData, companyId: string) {
  const filePath = String(form.get("filePath") ?? "");
  const originalName = String(form.get("originalName") ?? "");
  const pastedText = String(form.get("text") ?? "").trim();
  if (!filePath && !pastedText) throw new Error("Upload a PDF or TXT file, or paste proposal text.");
  if (filePath && !filePath.startsWith(`${companyId}/`)) throw new Error("The uploaded file path is invalid.");
  const name = String(form.get("name") ?? "").trim();
  const client = String(form.get("client") ?? "").trim();
  const location = String(form.get("location") ?? "").trim();
  return {
    name,
    client,
    location,
    original_name: filePath ? originalName : null,
    text_content: pastedText,
    detected_jurisdiction: {},
    project_scope: [],
    extracted_requirements: [],
    sections: detectSections(pastedText)
  };
}

async function withFileUrl<T extends { file_path?: string | null }>(
  client: SupabaseClient,
  proposal: T
) {
  const paths = [
    ...(proposal.file_path ? [proposal.file_path] : []),
    ...(((proposal as T & { versions?: Array<{ file_path?: string | null }> }).versions ?? [])
      .map((version) => version.file_path).filter(Boolean) as string[])
  ];
  const { data } = paths.length
    ? await client.storage.from("proposal-files").createSignedUrls(paths, 3600)
    : { data: [] };
  const urls = new Map((data ?? []).map((item) => [item.path, item.signedUrl]));
  const versions = ((proposal as T & { versions?: Array<{ file_path?: string | null }> }).versions ?? [])
    .map((version) => ({ ...version, file_url: version.file_path ? urls.get(version.file_path) ?? null : null }));
  return {
    ...proposal,
    file_url: proposal.file_path ? urls.get(proposal.file_path) ?? null : null,
    ...("versions" in proposal ? { versions } : {})
  };
}

export async function GET(request: Request) {
  const auth = await authenticatedSupabase(request);
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  const { data, error } = id
    ? await auth.client.from("proposals").select("*").eq("id", id).single()
    : await auth.client.from("proposals").select("*").order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "PGRST116" ? 404 : 500 });
  if (Array.isArray(data)) {
    return NextResponse.json(await Promise.all(data.map((proposal) => withFileUrl(auth.client, proposal))));
  }
  return NextResponse.json(await withFileUrl(auth.client, data));
}

export async function POST(request: Request) {
  const auth = await authenticatedSupabase(request);
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const form = await request.formData();
    const proposal = prepareProposal(form, auth.companyId);
    if (!proposal.name) return NextResponse.json({ error: "Project name is required." }, { status: 400 });
    const existingId = String(form.get("proposalId") ?? "");
    const submittedFilePath = String(form.get("filePath") ?? "");
    const filePath = submittedFilePath || null;
    if (existingId) {
      const { data: current, error: readError } = await auth.client
        .from("proposals").select("*").eq("id", existingId).single();
      if (readError) throw new Error(readError.message);
      const versions = [
        ...(current.versions ?? []),
        {
          label: String(form.get("versionLabel") ?? "").trim() || `v${(current.versions?.length ?? 0) + 1}`,
          original_name: current.original_name,
          file_path: current.file_path,
          uploaded_at: current.updated_at,
          text_content: current.text_content,
          sections: current.sections,
          extracted_requirements: current.extracted_requirements
        }
      ];
      const { data, error } = await auth.client.from("proposals").update({
        ...proposal,
        file_path: filePath ?? current.file_path,
        versions,
        compliance_review: null,
        page_reviews: []
      }).eq("id", existingId).select("*").single();
      if (error) throw new Error(error.message);
      await auth.client.from("proposal_history").insert({
        proposal_id: existingId,
        company_id: auth.companyId,
        actor_id: auth.user.id,
        event_type: "version_uploaded",
        status: data.status,
        summary: `Uploaded revision ${proposal.original_name ?? "document"}.`,
        snapshot: data
      });
      return NextResponse.json(await withFileUrl(auth.client, data));
    }
    const { data, error } = await auth.client.from("proposals").insert({
      user_id: auth.user.id,
      company_id: auth.companyId,
      file_path: filePath,
      ...proposal
    }).select("*").single();
    if (error) throw new Error(error.message);
    await auth.client.from("proposal_history").insert({
      proposal_id: data.id,
      company_id: auth.companyId,
      actor_id: auth.user.id,
      event_type: "created",
      status: data.status,
      summary: "Created proposal record.",
      snapshot: data
    });
    return NextResponse.json(await withFileUrl(auth.client, data));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Proposal save failed." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticatedSupabase(request);
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json();
  const id = String(body.id ?? "");
  const allowed = [
    "name", "client", "location", "status", "priority", "assigned_to_id", "assigned_to_name",
    "due_date", "sections", "highlights", "compliance_review", "diagram_analysis"
    , "page_reviews", "archived_at"
  ];
  const { data: before } = await auth.client.from("proposals").select("*").eq("id", id).single();
  const patch = Object.fromEntries(allowed.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
  const { data, error } = await auth.client.from("proposals").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const changed = Object.keys(patch);
  if (changed.some((key) => ["status", "assigned_to_id", "due_date", "compliance_review", "page_reviews", "archived_at"].includes(key))) {
    const eventType = patch.archived_at ? "archived"
      : patch.archived_at === null ? "restored"
        : patch.status && patch.status !== before?.status ? "status_changed"
          : patch.compliance_review || patch.page_reviews ? "review_saved"
            : "updated";
    await auth.client.from("proposal_history").insert({
      proposal_id: id,
      company_id: auth.companyId,
      actor_id: auth.user.id,
      event_type: eventType,
      status: data.status,
      summary: changed.join(", "),
      snapshot: data
    });
  }
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const auth = await authenticatedSupabase(request);
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Proposal id is required." }, { status: 400 });
  const archivedAt = new Date().toISOString();
  const { data: proposal, error } = await auth.client.from("proposals")
    .update({ archived_at: archivedAt })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await auth.client.from("proposal_history").insert({
    proposal_id: id,
    company_id: auth.companyId,
    actor_id: auth.user.id,
    event_type: "archived",
    status: proposal.status,
    summary: "Archived proposal. Files and review history retained.",
    snapshot: proposal
  });
  return NextResponse.json({ ok: true, archivedAt });
}
