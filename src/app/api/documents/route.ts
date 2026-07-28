import { NextResponse } from "next/server";
import { extractEngineeringFile, extractEngineeringRequirements } from "@/lib/extract-engineering";
import { authenticatedSupabase } from "@/lib/server-supabase";
import type { EngineeringDocumentType } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const allowedTypes = new Set<EngineeringDocumentType>([
  "city-standard", "client-standard", "manual", "geotechnical-report",
  "environmental-report", "seismic-source", "water-table-source", "flood-source", "soil-source"
]);

async function loadStoredFile(
  client: SupabaseClient,
  companyId: string,
  form: FormData
) {
  const filePath = String(form.get("filePath") ?? "");
  if (!filePath) return { file: null, filePath: null, originalName: null, fileType: "" };
  if (!filePath.startsWith(`${companyId}/standards/`)) throw new Error("The uploaded standard file path is invalid.");
  const { data, error } = await client.storage.from("proposal-files").download(filePath);
  if (error || !data) throw new Error(error?.message ?? "The uploaded standard could not be loaded.");
  if (data.size > 50_000_000) throw new Error("Document exceeds the 50 MB extraction limit.");
  return {
    file: data,
    filePath,
    originalName: String(form.get("originalName") ?? ""),
    fileType: String(form.get("fileType") ?? "")
  };
}

export async function GET(request: Request) {
  const auth = await authenticatedSupabase(request);
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const includeArchived = new URL(request.url).searchParams.get("archived") === "true";
  let query = auth.client
    .from("engineering_documents")
    .select("*")
    .order("updated_at", { ascending: false });
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const auth = await authenticatedSupabase(request);
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const form = await request.formData();
    const { file, filePath, originalName, fileType } = await loadStoredFile(auth.client, auth.companyId, form);
    const pastedText = String(form.get("text") ?? "").trim();
    const documentType = String(form.get("documentType") ?? "") as EngineeringDocumentType;
    if (!allowedTypes.has(documentType)) {
      return NextResponse.json({ error: "Unsupported document type." }, { status: 400 });
    }
    if (!file && !pastedText) {
      return NextResponse.json({ error: "A PDF, text file, or pasted document text is required." }, { status: 400 });
    }
    const title = String(form.get("title") ?? "").trim() || originalName || "Untitled source";
    const jurisdiction = String(form.get("jurisdiction") ?? "").trim();
    const clientId = String(form.get("clientId") ?? "").trim() || null;
    const projectTypes = String(form.get("projectTypes") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const mode = ["city-standard", "client-standard", "manual"].includes(documentType) ? "standard" : "site-report";
    const context = `TITLE: ${title}\nSOURCE TYPE: ${documentType}\nJURISDICTION: ${jurisdiction}`;
    const extraction = file
      ? fileType === "application/pdf"
        ? await extractEngineeringFile({
            bytes: await file.arrayBuffer(), filename: originalName || "standard.pdf", mediaType: fileType, context, mode
          })
        : await extractEngineeringRequirements({ text: await file.text(), context, mode })
      : await extractEngineeringRequirements({ text: pastedText, context, mode });

    const requirements = extraction.data.requirements.map((item, index) => ({
      id: `${crypto.randomUUID()}-${index}`,
      clientId: clientId ?? "",
      jurisdiction,
      topic: item.topic,
      metric: item.metric,
      comparator: item.comparator,
      value: item.value,
      unit: item.unit ?? undefined,
      sourceType: documentType,
      sourceTitle: title,
      citation: item.excerpt,
      scopeTags: projectTypes.length ? projectTypes : extraction.data.projectScope,
      rationale: item.description,
      page: item.page,
      excerpt: item.excerpt,
      sourceUrl: String(form.get("sourceUrl") ?? "").trim() || undefined,
      embedding: item.embedding
    }));
    const { data, error } = await auth.client.from("engineering_documents").insert({
      user_id: auth.user.id,
      company_id: auth.companyId,
      title,
      document_type: documentType,
      jurisdiction,
      client_id: clientId,
      project_types: projectTypes,
      effective_date: String(form.get("effectiveDate") ?? "") || null,
      original_name: file ? originalName : null,
      file_path: filePath,
      source_url: String(form.get("sourceUrl") ?? "").trim() || null,
      extraction_status: "complete",
      detected_jurisdiction: extraction.data.jurisdiction,
      project_scope: extraction.data.projectScope,
      requirements,
      openai_response_id: extraction.responseId ?? null
    }).select("*").single();
    if (error) throw new Error(error.message);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Extraction failed." }, { status: 500 });
  }
}
