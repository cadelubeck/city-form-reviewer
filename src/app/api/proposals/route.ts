import { NextResponse } from "next/server";
import { extractEngineeringFile, extractEngineeringRequirements } from "@/lib/extract-engineering";
import { authenticatedSupabase } from "@/lib/server-supabase";

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

async function extractProposal(form: FormData) {
  const file = form.get("file");
  const pastedText = String(form.get("text") ?? "").trim();
  if (!(file instanceof File) && !pastedText) throw new Error("Upload a PDF or TXT file, or paste proposal text.");
  if (file instanceof File && file.size > 25 * 1024 * 1024) throw new Error("Proposal exceeds the 25 MB extraction limit.");
  const name = String(form.get("name") ?? "").trim();
  const client = String(form.get("client") ?? "").trim();
  const location = String(form.get("location") ?? "").trim();
  const context = `PROPOSAL: ${name}\nCLIENT: ${client}\nSUBMITTED LOCATION: ${location}\nExtract submitted design values, not governing standards.`;
  const rawText = file instanceof File && file.type !== "application/pdf" ? await file.text() : pastedText;
  const extraction = file instanceof File && file.type === "application/pdf"
    ? await extractEngineeringFile({
        bytes: await file.arrayBuffer(),
        filename: file.name,
        mediaType: file.type,
        context,
        mode: "proposal"
      })
    : await extractEngineeringRequirements({ text: rawText, context, mode: "proposal" });
  const searchableText = rawText || extraction.data.requirements
    .map((item) => `${item.topic}\n${item.description}\n${item.excerpt}`)
    .join("\n\n");
  return {
    name,
    client,
    location,
    original_name: file instanceof File ? file.name : null,
    text_content: searchableText,
    detected_jurisdiction: extraction.data.jurisdiction,
    project_scope: extraction.data.projectScope,
    extracted_requirements: extraction.data.requirements,
    sections: detectSections(searchableText)
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
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const auth = await authenticatedSupabase(request);
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const form = await request.formData();
    const proposal = await extractProposal(form);
    if (!proposal.name) return NextResponse.json({ error: "Project name is required." }, { status: 400 });
    const existingId = String(form.get("proposalId") ?? "");
    if (existingId) {
      const { data: current, error: readError } = await auth.client
        .from("proposals").select("*").eq("id", existingId).single();
      if (readError) throw new Error(readError.message);
      const versions = [
        ...(current.versions ?? []),
        {
          label: String(form.get("versionLabel") ?? "").trim() || `v${(current.versions?.length ?? 0) + 1}`,
          original_name: current.original_name,
          uploaded_at: current.updated_at,
          text_content: current.text_content,
          sections: current.sections,
          extracted_requirements: current.extracted_requirements
        }
      ];
      const { data, error } = await auth.client.from("proposals").update({
        ...proposal,
        versions,
        compliance_review: null
      }).eq("id", existingId).select("*").single();
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }
    const { data, error } = await auth.client.from("proposals").insert({
      user_id: auth.user.id,
      ...proposal
    }).select("*").single();
    if (error) throw new Error(error.message);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Proposal extraction failed." }, { status: 500 });
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
  ];
  const patch = Object.fromEntries(allowed.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
  const { data, error } = await auth.client.from("proposals").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const auth = await authenticatedSupabase(request);
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Proposal id is required." }, { status: 400 });
  const { error } = await auth.client.from("proposals").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
