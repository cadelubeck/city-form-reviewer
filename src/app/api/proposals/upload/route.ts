import { NextResponse } from "next/server";
import { authenticatedSupabase } from "@/lib/server-supabase";

const MAX_FILE_SIZE = 50_000_000;
const ALLOWED_TYPES = new Set(["application/pdf", "text/plain"]);

export async function POST(request: Request) {
  const auth = await authenticatedSupabase(request);
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const body = await request.json();
    const filename = String(body.filename ?? "").trim();
    const contentType = String(body.contentType ?? "");
    const size = Number(body.size ?? 0);
    if (!filename || !ALLOWED_TYPES.has(contentType)) {
      return NextResponse.json({ error: "Upload a PDF or plain-text proposal." }, { status: 400 });
    }
    if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Files must be between 1 byte and 50 MB." }, { status: 400 });
    }
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const category = body.category === "standard" ? "standards" : "proposals";
    const path = `${auth.companyId}/${category}/${crypto.randomUUID()}-${safeName}`;
    const { data, error } = await auth.client.storage
      .from("proposal-files")
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return NextResponse.json({ path, token: data.token });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to prepare the private upload."
    }, { status: 500 });
  }
}
