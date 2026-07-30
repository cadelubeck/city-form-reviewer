"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  CheckCircle2,
  CircleDot,
  FileCheck2,
  Globe2,
  Lock,
  LogOut,
  ClipboardList,
  Plus,
  UserCircle,
  Save,
  SearchCheck,
  Sparkles,
  Trash2,
  Upload
} from "lucide-react";
import { ProposalWorkspace } from "./proposal-workspace";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api-fetch";
import type {
  Review,
  ReviewResult,
  ReviewStatus,
  RiskLevel,
  SiteFinding,
  UsageEvent,
  EngineeringDocument,
  EngineeringDocumentType
} from "@/lib/types";

const statusLabels: Record<ReviewStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  needs_revision: "Needs revision"
};

const statusIcons: Record<ReviewStatus, React.ReactNode> = {
  draft: <CircleDot size={16} />,
  in_review: <FileCheck2 size={16} />,
  approved: <CheckCircle2 size={16} />,
  needs_revision: <AlertTriangle size={16} />
};

const emptyForm = {
  city: "Brigham City",
  clientId: "brigham-city",
  permit_type: "Site development review",
  applicant: "",
  projectName: "",
  address: "",
  proposalText: "",
  geotechText: "",
  aggregateBaseDepth: "",
  frostDepth: "",
  groundwaterClearance: "",
  seismicDesignCategory: false,
  geotechAggregateBaseDepth: "",
  geotechFrostDepth: "",
  geotechGroundwaterClearance: "",
  scopeTags: ["site-development", "roadway", "commercial"],
  uploadedFiles: [] as string[],
  notes: "",
  risk_level: "medium" as RiskLevel,
  status: "draft" as ReviewStatus
};

type ReviewApiResponse = {
  ok: boolean;
  message?: string;
  review?: ReviewResult;
  aiNarrative?: string | null;
  extraction?: {
    detectedJurisdiction?: { city?: string | null; state?: string | null; confidence?: number };
    projectScope?: string[];
  };
};

const scopeOptions = [
  { id: "site-development", label: "Site" },
  { id: "roadway", label: "Road" },
  { id: "utility", label: "Utility" },
  { id: "stormwater", label: "Stormwater" },
  { id: "structure", label: "Structure" },
  { id: "commercial", label: "Commercial" }
];

type DocumentFormState = {
  title: string;
  documentType: EngineeringDocumentType;
  jurisdiction: string;
  clientId: string;
  projectTypes: string;
  effectiveDate: string;
  sourceUrl: string;
  text: string;
};

type AppView = "proposals" | "my-work" | "dashboard" | "reviewer" | "documents" | "profile";

function viewFromPath(pathname: string): AppView {
  if (pathname.startsWith("/my-work")) return "my-work";
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/quick-review")) return "reviewer";
  if (pathname.startsWith("/standards")) return "documents";
  if (pathname.startsWith("/profile")) return "profile";
  return "proposals";
}

function routeForView(view: AppView) {
  return {
    proposals: "/proposals",
    "my-work": "/my-work",
    dashboard: "/dashboard",
    reviewer: "/quick-review",
    documents: "/standards",
    profile: "/profile"
  }[view];
}

export function AppShell() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => getSupabase(), []);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [aiNarrative, setAiNarrative] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<ReviewApiResponse["extraction"]>();
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [activeView, setActiveView] = useState<"proposals" | "my-work" | "dashboard" | "reviewer" | "documents" | "profile">(() => viewFromPath(pathname));
  const [usageEvents, setUsageEvents] = useState<UsageEvent[]>([]);
  const [documents, setDocuments] = useState<EngineeringDocument[]>([]);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentForm, setDocumentForm] = useState<DocumentFormState>({
    title: "", documentType: "city-standard" as EngineeringDocumentType,
    jurisdiction: "Brigham City", clientId: "brigham-city",
    projectTypes: "roadway, utility, site-development", effectiveDate: "", sourceUrl: "", text: ""
  });

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    const loginKey = "city-form-reviewer-login-time";
    const dailySessionMs = 24 * 60 * 60 * 1000;
    const enforceDailyLogout = async () => {
      const { data } = await supabase.auth.getUser();
      const signedInAt = Number(localStorage.getItem(loginKey));
      if (data.user && signedInAt && Date.now() - signedInAt >= dailySessionMs) {
        await supabase.auth.signOut();
        localStorage.removeItem(loginKey);
        setMessage("For security, you were signed out after 24 hours. Please sign in again.");
        setUser(null);
      } else {
        if (data.user && !signedInAt) localStorage.setItem(loginKey, String(Date.now()));
        setUser(data.user);
      }
      setAuthReady(true);
    };
    void enforceDailyLogout();
    const timer = window.setInterval(() => void enforceDailyLogout(), 60_000);

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      window.clearInterval(timer);
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    setActiveView(viewFromPath(pathname));
  }, [pathname]);

  function navigate(view: typeof activeView) {
    setActiveView(view);
    router.push(routeForView(view));
  }

  async function logUsage(
    userId: string,
    eventType: string,
    data: {
      endpoint?: string;
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      statusCode?: number;
      durationMs?: number;
      details?: Record<string, unknown>;
    } = {}
  ) {
    if (!supabase) return;
    const { error } = await supabase.from("usage_events").insert({
      user_id: userId,
      event_type: eventType,
      endpoint: data.endpoint ?? null,
      method: data.method ?? null,
      status_code: data.statusCode ?? null,
      duration_ms: data.durationMs ?? null,
      details: data.details ?? {}
    });
    if (error) console.error("Usage logging failed:", error.message);
  }

  useEffect(() => {
    if (!supabase || !user) {
      setReviews([]);
      return;
    }

    supabase
      .from("reviews")
      .select("*")
      .order("updated_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setMessage(error.message);
          return;
        }
        setReviews((data ?? []) as Review[]);
      });
  }, [supabase, user]);

  useEffect(() => {
    if (!supabase || !user || activeView !== "profile") return;
    supabase
      .from("usage_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (error) {
          setMessage(error.message);
          return;
        }
        setUsageEvents((data ?? []) as UsageEvent[]);
      });
  }, [activeView, supabase, user]);

  useEffect(() => {
    if (!supabase || !user || activeView !== "documents") return;
    loadDocuments();
  }, [activeView, supabase, user]);

  async function authHeaders(): Promise<Record<string, string>> {
    const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function loadDocuments() {
    const response = await apiFetch("/api/documents", { headers: await authHeaders() });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error ?? "Unable to load documents.");
    setDocuments(data as EngineeringDocument[]);
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!documentFile && !documentForm.text.trim()) return setMessage("Choose a file or paste document text.");
    setDocumentBusy(true);
    setMessage("");
    const body = new FormData();
    Object.entries(documentForm).forEach(([key, value]) => body.append(key, value));
    try {
      const auth = await authHeaders();
      if (documentFile) {
        const ticketResponse = await apiFetch("/api/proposals/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({
            filename: documentFile.name,
            contentType: documentFile.type,
            size: documentFile.size,
            category: "standard"
          })
        });
        const ticket = await ticketResponse.json().catch(() => ({ error: "The upload ticket could not be read." }));
        if (!ticketResponse.ok) throw new Error(ticket.error ?? "Unable to prepare the private file upload.");
        if (!supabase) throw new Error("File storage is not configured.");
        const { error } = await supabase.storage
          .from("proposal-files")
          .uploadToSignedUrl(ticket.path, ticket.token, documentFile, { contentType: documentFile.type });
        if (error) {
          const uploadMessage = error.message.toLowerCase().includes("maximum allowed size")
            ? "Supabase Storage is still using its old bucket limit. Update the proposal-files bucket to 52,428,800 bytes, then retry."
            : `Private file upload failed: ${error.message}`;
          throw new Error(uploadMessage);
        }
        body.set("filePath", ticket.path);
        body.set("originalName", documentFile.name);
        body.set("fileType", documentFile.type);
      }
      const response = await apiFetch("/api/documents", { method: "POST", headers: auth, body }, 180_000);
      const data = await response.json().catch(() => ({ error: `Document upload failed with status ${response.status}.` }));
      if (!response.ok) return setMessage(data.error ?? "Document extraction failed.");
      setDocumentFile(null);
      setDocumentForm((current) => ({ ...current, title: "", effectiveDate: "", sourceUrl: "", text: "" }));
      setMessage(`Extracted ${data.requirements?.length ?? 0} requirements from ${data.title}.`);
      await loadDocuments();
    } catch (error) {
      setMessage(error instanceof Error && error.name === "TimeoutError"
        ? "Document extraction timed out after two minutes. Please retry."
        : error instanceof Error ? error.message : "Document extraction failed.");
    } finally {
      setDocumentBusy(false);
    }
  }

  async function deleteDocument(id: string) {
    if (!confirm("Remove this source from the compliance library?")) return;
    const response = await apiFetch(`/api/documents/${id}`, { method: "DELETE", headers: await authHeaders() });
    if (!response.ok) return setMessage("Unable to remove document.");
    await loadDocuments();
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setIsBusy(true);
    setMessage("");

    if (authMode === "register") {
      if (password.length < 12) {
        setMessage("Password must be at least 12 characters.");
        setIsBusy(false);
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName.trim() } }
      });
      if (error) {
        setMessage(error.message);
      } else {
        if (data.user) await logUsage(data.user.id, "account_created");
        setMessage("Account created. Check your email if confirmation is enabled.");
      }
    } else {
      const startedAt = Date.now();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage("Invalid email or password.");
      } else {
        if (data.user) {
          localStorage.setItem("city-form-reviewer-login-time", String(Date.now()));
          await logUsage(data.user.id, "login_succeeded", {
            durationMs: Date.now() - startedAt
          });
        }
        setMessage("Signed in.");
      }
    }
    setIsBusy(false);
  }

  async function signOut() {
    if (!supabase) return;
    if (user) await logUsage(user.id, "logout");
    await supabase.auth.signOut();
    localStorage.removeItem("city-form-reviewer-login-time");
    setForm(emptyForm);
    setReviewResult(null);
    setAiNarrative(null);
    setMessage("Signed out.");
    navigate("proposals");
  }

  function updateScope(tag: string) {
    setForm((current) => {
      const scopeTags = current.scopeTags.includes(tag)
        ? current.scopeTags.filter((item) => item !== tag)
        : [...current.scopeTags, tag];
      return { ...current, scopeTags };
    });
  }

  function updateFiles(files: FileList | null) {
    setForm((current) => ({
      ...current,
      uploadedFiles: Array.from(files ?? []).map((file) => file.name)
    }));
  }

  function numberOrNull(value: string) {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function buildSiteFindings() {
    const siteFindings: SiteFinding[] = [];

    const geotechAggregate = numberOrNull(form.geotechAggregateBaseDepth);
    if (geotechAggregate !== null) {
      siteFindings.push({
        id: "uploaded-geo-road-base-depth",
        topic: "Roadway section",
        metric: "aggregate_base_depth",
        comparator: "minimum",
        value: geotechAggregate,
        unit: "in",
        sourceType: "geotechnical-report",
        sourceTitle: "Uploaded geotechnical report",
        citation: "Geotechnical/site report aggregate base recommendation",
        rationale: "Site-specific soils can require a deeper road base than the city standard."
      });
    }

    const geotechFrost = numberOrNull(form.geotechFrostDepth);
    if (geotechFrost !== null) {
      siteFindings.push({
        id: "uploaded-geo-frost-depth",
        topic: "Frost protection",
        metric: "frost_depth",
        comparator: "minimum",
        value: geotechFrost,
        unit: "in",
        sourceType: "geotechnical-report",
        sourceTitle: "Uploaded geotechnical report",
        citation: "Geotechnical/site report frost recommendation",
        rationale: "Site-specific frost or soil conditions can require deeper protection."
      });
    }

    const geotechGroundwater = numberOrNull(form.geotechGroundwaterClearance);
    if (geotechGroundwater !== null) {
      siteFindings.push({
        id: "uploaded-water-clearance",
        topic: "Groundwater",
        metric: "groundwater_clearance",
        comparator: "minimum",
        value: geotechGroundwater,
        unit: "ft",
        sourceType: "water-table-source",
        sourceTitle: "Uploaded geotechnical or water table report",
        citation: "Seasonal high groundwater / water table recommendation",
        rationale: "Use the stricter separation requirement when the site source exceeds the city minimum."
      });
    }

    return siteFindings;
  }

  async function runStandardsReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsReviewing(true);
    setMessage("");
    setReviewResult(null);
    setAiNarrative(null);

    const startedAt = Date.now();
    try {
      const accessToken = supabase
        ? (await supabase.auth.getSession()).data.session?.access_token
        : null;
      const response = await apiFetch("/api/reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify({
          proposal: {
            projectName: form.projectName || form.applicant || "Untitled project",
            clientId: form.clientId,
            jurisdiction: form.city,
            address: form.address || "Address not provided",
            scopeTags: form.scopeTags,
            proposalText: form.proposalText,
            uploadedFiles: form.uploadedFiles,
            measurements: [
            {
              metric: "aggregate_base_depth",
              value: numberOrNull(form.aggregateBaseDepth),
              unit: "in",
              citation: "Proposal roadway section"
            },
            {
              metric: "frost_depth",
              value: numberOrNull(form.frostDepth),
              unit: "in",
              citation: "Proposal utility/profile notes"
            },
            {
              metric: "groundwater_clearance",
              value: numberOrNull(form.groundwaterClearance),
              unit: "ft",
              citation: "Proposal stormwater/site notes"
            },
            {
              metric: "geotechnical_report_provided",
              value: Boolean(form.geotechText || form.uploadedFiles.length),
              citation: "Uploaded or pasted geotechnical report"
            },
            {
              metric: "seismic_design_category",
              value: form.seismicDesignCategory,
              citation: "Proposal structural criteria"
            }
            ]
          },
          siteFindings: buildSiteFindings(),
          siteDocumentText: form.geotechText
        })
      }, 120_000);

      const data = (await response.json()) as ReviewApiResponse;
      if (user) {
        await logUsage(user.id, "api_request", {
          endpoint: "/api/reviews",
          method: "POST",
          statusCode: response.status,
          durationMs: Date.now() - startedAt,
          details: { aiRequested: true }
        });
      }
      if (!response.ok || !data.ok || !data.review) {
        setMessage(data.message ?? "The review API could not complete the review.");
        return;
      }

      setReviewResult(data.review);
      setAiNarrative(data.aiNarrative ?? null);
      setExtraction(data.extraction);
      setForm((current) => ({
        ...current,
        notes: [
          data.aiNarrative,
          ...data.review!.nextActions,
          `Pass: ${data.review!.summary.pass}, fail: ${data.review!.summary.fail}, missing: ${data.review!.summary.missing}`
        ]
          .filter(Boolean)
          .join("\n")
      }));
      setMessage("Standards review complete.");
    } catch (error) {
      setMessage(error instanceof Error && error.name === "TimeoutError"
        ? "The review service did not respond within two minutes. Your form remains available to retry."
        : error instanceof Error ? error.message : "The review API could not complete the review.");
    } finally {
      setIsReviewing(false);
    }
  }

  async function saveReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !user) return;
    setIsBusy(true);
    setMessage("");

    const { data, error } = await supabase
      .from("reviews")
      .insert({
        user_id: user.id,
        city: form.city.trim(),
        permit_type: form.permit_type.trim(),
        applicant: form.applicant.trim(),
        notes: form.notes.trim(),
        risk_level: form.risk_level,
        status: form.status
      })
      .select()
      .single();

    if (error) {
      setMessage(error.message);
      await logUsage(user.id, "review_save_failed", {
        statusCode: 400,
        details: { message: error.message }
      });
    } else {
      setReviews((current) => [data as Review, ...current]);
      setForm(emptyForm);
      setReviewResult(null);
      setAiNarrative(null);
      setMessage("Review saved.");
      await logUsage(user.id, "review_saved");
    }

    setIsBusy(false);
  }

  const readyForDatabase = Boolean(supabase);
  const approvedCount = reviews.filter((review) => review.status === "approved").length;
  const needsAttention =
    (reviewResult?.summary.fail ?? 0) +
    (reviewResult?.summary.missing ?? 0) +
    (reviewResult?.summary.needsReview ?? 0);

  if (!authReady) {
    return <main className="auth-page"><p>Loading secure sign-in…</p></main>;
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-shell">
          <div className="auth-brand">
            <div className="auth-mark">🏛</div>
            <p className="eyebrow">Municipal review portal</p>
            <h1>City Form Reviewer</h1>
          </div>
          {!readyForDatabase ? (
            <section className="notice">
              <Lock size={20} />
              <div>
                <h2>Supabase setup required</h2>
                <p>Add the Supabase URL and anon key to continue.</p>
              </div>
            </section>
          ) : (
            <AuthForm
              mode={authMode}
              fullName={fullName}
              email={email}
              password={password}
              isBusy={isBusy}
              message={message}
              onMode={(mode) => {
                setAuthMode(mode);
                setMessage("");
              }}
              onFullName={setFullName}
              onEmail={setEmail}
              onPassword={setPassword}
              onSubmit={submitAuth}
            />
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="app">
      <section className="workspace">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">🏛</div>
            <div>
              <h1>City Form Reviewer</h1>
              <p>AI compliance review</p>
            </div>
          </div>
          <div className="topbar-actions">
            <button className={`nav-button ${activeView === "proposals" ? "active" : ""}`} onClick={() => navigate("proposals")}>
              <ClipboardList size={18} /><span>Proposals</span>
            </button>
            <button className={`nav-button ${activeView === "my-work" ? "active" : ""}`} onClick={() => navigate("my-work")}>
              <UserCircle size={18} /><span>My work</span>
            </button>
            <button className={`nav-button ${activeView === "reviewer" ? "active" : ""}`} onClick={() => navigate("reviewer")}>
              <SearchCheck size={18} /><span>Quick review</span>
            </button>
            <button className={`nav-button ${activeView === "documents" ? "active" : ""}`} onClick={() => navigate("documents")}>
              <BookOpen size={18} /><span>Standards library</span>
            </button>
            <button className={`nav-button ${activeView === "dashboard" ? "active" : ""}`} onClick={() => navigate("dashboard")}>
              <BarChart3 size={18} /><span>Dashboard</span>
            </button>
            <button
              className={`nav-button ${activeView === "profile" ? "active" : ""}`}
              onClick={() => navigate("profile")}
            >
              <UserCircle size={18} />
              <span>Profile</span>
            </button>
            <button className="user-avatar" onClick={() => navigate("profile")} aria-label="Open profile">
              {(user.user_metadata.full_name || user.email || "U").charAt(0).toUpperCase()}
            </button>
            <button className="icon-button" onClick={signOut} aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {activeView === "proposals" || activeView === "my-work" || activeView === "dashboard" ? (
          <ProposalWorkspace user={user} mode={activeView} />
        ) : activeView === "profile" ? (
          <ProfileView user={user} events={usageEvents} />
        ) : activeView === "documents" ? (
          <DocumentLibrary
            documents={documents}
            form={documentForm}
            file={documentFile}
            busy={documentBusy}
            message={message}
            onForm={setDocumentForm}
            onFile={setDocumentFile}
            onSubmit={uploadDocument}
            onDelete={deleteDocument}
          />
        ) : (
        <>
        <section className="review-hero">
          <div>
            <p className="eyebrow">Start a compliance review</p>
            <h2>Upload a proposal. Get a clear, sourced risk review.</h2>
            <p>
              AI identifies the jurisdiction and project scope, retrieves controlling standards,
              applies stricter site-specific requirements, and prepares every finding for an
              engineer&apos;s decision.
            </p>
          </div>
          <button
            className="hero-action"
            type="button"
            onClick={() => document.querySelector(".intake-panel")?.scrollIntoView({ behavior: "smooth" })}
          >
            <Upload size={18} />
            New review
          </button>
        </section>

        <div className="metrics">
          <Metric label="Saved reviews" value={reviews.length.toString()} />
          <Metric label="Needs attention" value={needsAttention.toString()} tone="warn" />
          <Metric label="Approved" value={approvedCount.toString()} tone="good" />
        </div>

        <div className="review-layout">
          <section className="panel intake-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Intake</p>
                <h2>Proposal and site facts</h2>
              </div>
              <Plus size={20} />
            </div>

            <>
                <form className="form" onSubmit={runStandardsReview}>
                  <div className="inline-fields">
                    <label>
                      Client
                      <select
                        value={form.clientId}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            clientId: event.target.value,
                            city: event.target.value === "brigham-city" ? "Brigham City" : "Bloomington"
                          })
                        }
                      >
                        <option value="brigham-city">Brigham City</option>
                        <option value="lmrwd">Lower Minnesota River Watershed District</option>
                      </select>
                    </label>
                    <label>
                      City
                      <input
                        required
                        value={form.city}
                        onChange={(event) => setForm({ ...form, city: event.target.value })}
                      />
                    </label>
                  </div>

                  <div className="inline-fields">
                    <label>
                      Project
                      <input
                        required
                        value={form.projectName}
                        onChange={(event) => setForm({ ...form, projectName: event.target.value })}
                        placeholder="McDonald's redevelopment"
                      />
                    </label>
                    <label>
                      Applicant
                      <input
                        required
                        value={form.applicant}
                        onChange={(event) => setForm({ ...form, applicant: event.target.value })}
                        placeholder="Applicant name"
                      />
                    </label>
                  </div>

                  <label>
                    Address or area
                    <input
                      value={form.address}
                      onChange={(event) => setForm({ ...form, address: event.target.value })}
                      placeholder="Project address or parcel area"
                    />
                  </label>

                  <div className="scope-row">
                    {scopeOptions.map((scope) => (
                      <label className="check-label" key={scope.id}>
                        <input
                          type="checkbox"
                          checked={form.scopeTags.includes(scope.id)}
                          onChange={() => updateScope(scope.id)}
                        />
                        <span>{scope.label}</span>
                      </label>
                    ))}
                  </div>

                  <div className="field-group">
                    <h3>Proposal values</h3>
                    <div className="inline-fields">
                      <label>
                        Road base depth
                        <input
                          inputMode="decimal"
                          value={form.aggregateBaseDepth}
                          onChange={(event) =>
                            setForm({ ...form, aggregateBaseDepth: event.target.value })
                          }
                          placeholder="inches"
                        />
                      </label>
                      <label>
                        Frost depth
                        <input
                          inputMode="decimal"
                          value={form.frostDepth}
                          onChange={(event) => setForm({ ...form, frostDepth: event.target.value })}
                          placeholder="inches"
                        />
                      </label>
                    </div>
                    <div className="inline-fields">
                      <label>
                        Groundwater clearance
                        <input
                          inputMode="decimal"
                          value={form.groundwaterClearance}
                          onChange={(event) =>
                            setForm({ ...form, groundwaterClearance: event.target.value })
                          }
                          placeholder="feet"
                        />
                      </label>
                      <label className="check-label switch">
                        <input
                          type="checkbox"
                          checked={form.seismicDesignCategory}
                          onChange={(event) =>
                            setForm({ ...form, seismicDesignCategory: event.target.checked })
                          }
                        />
                        <span>Seismic category included</span>
                      </label>
                    </div>
                  </div>

                  <div className="field-group">
                    <h3>Geotech or site report overrides</h3>
                    <div className="inline-fields">
                      <label>
                        Report road base
                        <input
                          inputMode="decimal"
                          value={form.geotechAggregateBaseDepth}
                          onChange={(event) =>
                            setForm({ ...form, geotechAggregateBaseDepth: event.target.value })
                          }
                          placeholder="inches"
                        />
                      </label>
                      <label>
                        Report frost depth
                        <input
                          inputMode="decimal"
                          value={form.geotechFrostDepth}
                          onChange={(event) =>
                            setForm({ ...form, geotechFrostDepth: event.target.value })
                          }
                          placeholder="inches"
                        />
                      </label>
                    </div>
                    <label>
                      Report groundwater clearance
                      <input
                        inputMode="decimal"
                        value={form.geotechGroundwaterClearance}
                        onChange={(event) =>
                          setForm({ ...form, geotechGroundwaterClearance: event.target.value })
                        }
                        placeholder="feet"
                      />
                    </label>
                  </div>

                  <label>
                    Upload proposal or geotech files
                    <input multiple onChange={(event) => updateFiles(event.target.files)} type="file" />
                  </label>

                  <label>
                    Proposal text
                    <textarea
                      value={form.proposalText}
                      onChange={(event) => setForm({ ...form, proposalText: event.target.value })}
                      placeholder="Paste proposal details, scope notes, or extracted PDF text."
                    />
                  </label>

                  <label>
                    Geotech report notes
                    <textarea
                      value={form.geotechText}
                      onChange={(event) => setForm({ ...form, geotechText: event.target.value })}
                      placeholder="Paste soil, frost, groundwater, pavement, or seismic recommendations."
                    />
                  </label>

                  <button className="primary" disabled={isReviewing}>
                    <SearchCheck size={18} />
                    <span>{isReviewing ? "Reviewing" : "Run standards review"}</span>
                  </button>
                </form>

                <form className="form save-form" onSubmit={saveReview}>
                  <div className="inline-fields">
                    <label>
                      Risk
                      <select
                        value={form.risk_level}
                        onChange={(event) =>
                          setForm({ ...form, risk_level: event.target.value as RiskLevel })
                        }
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </label>
                    <label>
                      Status
                      <select
                        value={form.status}
                        onChange={(event) =>
                          setForm({ ...form, status: event.target.value as ReviewStatus })
                        }
                      >
                        <option value="draft">Draft</option>
                        <option value="in_review">In review</option>
                        <option value="needs_revision">Needs revision</option>
                        <option value="approved">Approved</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Review notes
                    <textarea
                      required
                      value={form.notes}
                      onChange={(event) => setForm({ ...form, notes: event.target.value })}
                      placeholder="Run a standards review or enter reviewer notes."
                    />
                  </label>
                  <button className="secondary" disabled={isBusy}>
                    <Save size={18} />
                    <span>{isBusy ? "Saving" : "Save review"}</span>
                  </button>
                </form>
            </>
          </section>

          <section className="panel result-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Results</p>
                <h2>Controlling standards</h2>
              </div>
              <Globe2 size={20} />
            </div>

            {message ? <p className="message">{message}</p> : null}

            {reviewResult ? (
              <div className="result-stack">
                <div className="result-summary">
                  <Metric label="Pass" value={reviewResult.summary.pass.toString()} tone="good" />
                  <Metric label="Fail" value={reviewResult.summary.fail.toString()} tone="bad" />
                  <Metric label="Missing" value={reviewResult.summary.missing.toString()} tone="warn" />
                </div>

                {extraction ? (
                  <section className="scope-summary">
                    <div><span>Detected jurisdiction</span><strong>
                      {[extraction.detectedJurisdiction?.city, extraction.detectedJurisdiction?.state].filter(Boolean).join(", ") || form.city}
                    </strong></div>
                    <div><span>Project scope</span><strong>{extraction.projectScope?.join(", ") || form.scopeTags.join(", ")}</strong></div>
                  </section>
                ) : null}

                {aiNarrative ? (
                  <section className="narrative">
                    <h3>AI reviewer note</h3>
                    <p>{aiNarrative}</p>
                  </section>
                ) : null}

                <div className="finding-list">
                  {reviewResult.findings.map((finding) => (
                    <article className="review-card" key={finding.requirementId}>
                      <div>
                        <h3>{finding.topic}</h3>
                        <p>{finding.controllingSource}</p>
                      </div>
                      <div className="review-meta">
                        <span className={`pill finding ${finding.status}`}>{finding.status}</span>
                        <span className="pill status">
                          Required {String(finding.requiredValue)}
                          {finding.unit ? ` ${finding.unit}` : ""}
                        </span>
                        <span className="pill status">
                          Submitted{" "}
                          {finding.submittedValue === null
                            ? "missing"
                            : `${String(finding.submittedValue)}${finding.unit ? ` ${finding.unit}` : ""}`}
                        </span>
                      </div>
                      <p className="notes">{finding.explanation}</p>
                      {finding.recommendedCorrection ? <p className="correction">{finding.recommendedCorrection}</p> : null}
                      <p className="citation">
                        {finding.citation}
                        {finding.sourcePage ? ` · Page ${finding.sourcePage}` : ""}
                        {finding.sourceExcerpt ? ` · “${finding.sourceExcerpt}”` : ""}
                      </p>
                    </article>
                  ))}
                </div>

                <section className="comparison-section">
                  <h3>Controlling-standard comparison</h3>
                  <div className="comparison-wrap">
                    <table className="comparison-table">
                      <thead><tr><th>Requirement</th><th>City/client</th><th>Site-specific</th><th>Controlling</th><th>Proposal</th><th>Result</th></tr></thead>
                      <tbody>
                        {reviewResult.controllingRequirements.map((item, index) => {
                          const finding = reviewResult.findings[index];
                          return <tr key={item.baseRequirement.id}>
                            <td><strong>{item.baseRequirement.topic}</strong><small>{item.baseRequirement.metric}</small></td>
                            <td>{String(item.baseRequirement.value)} {item.baseRequirement.unit ?? ""}<small>{item.baseRequirement.sourceTitle}</small></td>
                            <td>{item.overrideApplied ? `${String(item.controlling.value)} ${item.controlling.unit ?? ""}` : item.conflict ? "Conflict" : "Not stricter"}</td>
                            <td><strong>{String(item.controlling.value)} {item.controlling.unit ?? ""}</strong></td>
                            <td>{finding.submittedValue === null ? "Missing" : String(finding.submittedValue)}</td>
                            <td><span className={`pill finding ${finding.status}`}>{finding.status}</span></td>
                          </tr>;
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="source-list">
                  <h3>Sources checked</h3>
                  {reviewResult.sourcesUsed.map((source) => (
                    <a href={source.url} key={source.id} rel="noreferrer" target="_blank">
                      {source.name}
                    </a>
                  ))}
                </section>
              </div>
            ) : (
              <div className="empty">
                <Sparkles size={22} />
                <p>Run a standards review to see findings.</p>
              </div>
            )}
          </section>
        </div>

        <section className="panel saved-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Queue</p>
              <h2>Saved work</h2>
            </div>
          </div>
          <div className="review-list">
            {reviews.length === 0 ? (
              <p className="muted">No saved reviews yet.</p>
            ) : (
              reviews.map((review) => (
                <article className="review-card" key={review.id}>
                  <div>
                    <h3>{review.applicant}</h3>
                    <p>
                      {review.city} · {review.permit_type}
                    </p>
                  </div>
                  <div className="review-meta">
                    <span className={`pill ${review.risk_level}`}>{review.risk_level}</span>
                    <span className="pill status">
                      {statusIcons[review.status]}
                      {statusLabels[review.status]}
                    </span>
                  </div>
                  <p className="notes">{review.notes}</p>
                </article>
              ))
            )}
          </div>
        </section>
        </>
        )}
      </section>
    </main>
  );
}

function DocumentLibrary({
  documents, form, file, busy, message, onForm, onFile, onSubmit, onDelete
}: {
  documents: EngineeringDocument[];
  form: DocumentFormState;
  file: File | null;
  busy: boolean;
  message: string;
  onForm: React.Dispatch<React.SetStateAction<DocumentFormState>>;
  onFile: (file: File | null) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDelete: (id: string) => void;
}) {
  const types: Array<[EngineeringDocumentType, string]> = [
    ["city-standard", "City standard"], ["client-standard", "Client standard"], ["manual", "Manual / specification"],
    ["geotechnical-report", "Geotechnical report"], ["seismic-source", "Seismic report"],
    ["water-table-source", "Groundwater report"], ["flood-source", "Floodplain source"],
    ["soil-source", "Soils source"], ["environmental-report", "Other engineering report"]
  ];
  return (
    <section className="document-view">
      <div className="library-hero">
        <div><p className="eyebrow">Controlled source registry</p><h2>Standards and site-document library</h2></div>
        <div className="library-count"><strong>{documents.length}</strong><span>indexed sources</span></div>
      </div>
      {message ? <p className="message">{message}</p> : null}
      <div className="library-layout">
        <form className="panel form" onSubmit={onSubmit}>
          <div className="panel-heading"><div><p className="eyebrow">Add source</p><h2>Upload and extract</h2></div><Upload size={20} /></div>
          <label>Document title<input value={form.title} onChange={(event) => onForm({ ...form, title: event.target.value })} placeholder="Brigham City Public Works Standards" /></label>
          <div className="inline-fields">
            <label>Source type<select value={form.documentType} onChange={(event) => onForm({ ...form, documentType: event.target.value as EngineeringDocumentType })}>
              {types.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select></label>
            <label>Effective date<input type="date" value={form.effectiveDate} onChange={(event) => onForm({ ...form, effectiveDate: event.target.value })} /></label>
          </div>
          <div className="inline-fields">
            <label>Jurisdiction<input required value={form.jurisdiction} onChange={(event) => onForm({ ...form, jurisdiction: event.target.value })} /></label>
            <label>Client<select value={form.clientId} onChange={(event) => onForm({ ...form, clientId: event.target.value })}>
              <option value="">Any client</option><option value="brigham-city">Brigham City</option><option value="lmrwd">LMRWD</option>
            </select></label>
          </div>
          <label>Project types<input value={form.projectTypes} onChange={(event) => onForm({ ...form, projectTypes: event.target.value })} placeholder="roadway, utility, stormwater" /></label>
          <label>Official source link<input type="url" value={form.sourceUrl} onChange={(event) => onForm({ ...form, sourceUrl: event.target.value })} placeholder="https://city.gov/public-works/standards.pdf" /></label>
          <label className="file-drop">
            <input type="file" accept=".pdf,.txt,text/plain,application/pdf" onChange={(event) => onFile(event.target.files?.[0] ?? null)} />
            <Upload size={22} /><strong>{file ? file.name : "Choose PDF or TXT"}</strong><span>Maximum 50 MB</span>
          </label>
          <label>Or paste source text<textarea value={form.text} onChange={(event) => onForm({ ...form, text: event.target.value })} placeholder="Paste standards or engineering-report text…" /></label>
          <button className="primary" disabled={busy}><Sparkles size={18} />{busy ? "Extracting requirements…" : "Add and extract source"}</button>
        </form>
        <section className="panel">
          <div className="panel-heading"><div><p className="eyebrow">Indexed sources</p><h2>Available to reviews</h2></div><BookOpen size={20} /></div>
          <div className="document-list">
            {!documents.length ? <div className="empty"><BookOpen size={24} /><p>Upload your first controlling source.</p></div> :
              documents.map((document) => <article className="document-card" key={document.id}>
                <div className="document-icon">📄</div>
                <div className="document-copy"><h3>{document.title}</h3><p>{document.document_type.replaceAll("-", " ")} · {document.jurisdiction || "Any jurisdiction"}</p>
                  <div className="document-tags"><span>{document.requirements.length} requirements</span><span>{document.extraction_status}</span>{document.project_scope.slice(0, 3).map((scope) => <span key={scope}>{scope}</span>)}</div>
                </div>
                <button type="button" className="delete-button" onClick={() => onDelete(document.id)} aria-label={`Remove ${document.title}`}><Trash2 size={17} /></button>
              </article>)}
          </div>
        </section>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AuthForm({
  mode,
  fullName,
  email,
  password,
  isBusy,
  message,
  onMode,
  onFullName,
  onEmail,
  onPassword,
  onSubmit
}: {
  mode: "login" | "register";
  fullName: string;
  email: string;
  password: string;
  isBusy: boolean;
  message: string;
  onMode: (mode: "login" | "register") => void;
  onFullName: (value: string) => void;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="auth-card">
      <div className="auth-tabs" role="tablist" aria-label="Account type">
        <button className={mode === "login" ? "active" : ""} onClick={() => onMode("login")} type="button">
          Existing user
        </button>
        <button className={mode === "register" ? "active" : ""} onClick={() => onMode("register")} type="button">
          New user
        </button>
      </div>
      <form className="form" onSubmit={onSubmit}>
      {mode === "register" ? (
        <label>
          Full name
          <input
            required
            autoComplete="name"
            value={fullName}
            onChange={(event) => onFullName(event.target.value)}
            placeholder="Jane Smith"
          />
        </label>
      ) : null}
      <label>
        Email
        <input
          required
          autoComplete="email"
          type="email"
          value={email}
          onChange={(event) => onEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </label>
      <label>
        Password
        <input
          required
          minLength={mode === "register" ? 12 : undefined}
          type="password"
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => onPassword(event.target.value)}
          placeholder={mode === "register" ? "At least 12 characters" : "Your password"}
        />
      </label>
      <button className="primary" disabled={isBusy}>
        <Lock size={18} />
        <span>{isBusy ? "Working" : mode === "login" ? "Sign in" : "Create account"}</span>
      </button>
      {message ? <p className="message">{message}</p> : null}
      {mode === "register" ? <p className="security-note">Passwords are securely managed and hashed by Supabase Auth. They are never stored as readable text.</p> : null}
      </form>
    </div>
  );
}

function ProfileView({ user, events }: { user: User; events: UsageEvent[] }) {
  const apiEvents = events.filter((event) => event.event_type === "api_request");
  const now = Date.now();
  const recentCount = (days: number) =>
    apiEvents.filter((event) => now - new Date(event.created_at).getTime() < days * 86400000).length;
  const errors = apiEvents.filter((event) => (event.status_code ?? 0) >= 400).length;

  return (
    <section className="profile-view">
      <div className="panel profile-identity">
        <div className="profile-avatar">
          {(user.user_metadata.full_name || user.email || "U").charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="eyebrow">Account</p>
          <h2>{user.user_metadata.full_name || "City reviewer"}</h2>
          <p className="muted">{user.email}</p>
        </div>
      </div>
      <div className="usage-grid">
        <Metric label="API requests today" value={recentCount(1).toString()} />
        <Metric label="Last 7 days" value={recentCount(7).toString()} />
        <Metric label="Last 30 days" value={recentCount(30).toString()} />
        <Metric label="Request errors" value={errors.toString()} tone={errors ? "bad" : "good"} />
      </div>
      <TeamPanel user={user} />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Usage log</p>
            <h2>Recent activity</h2>
          </div>
        </div>
        {events.length === 0 ? (
          <p className="muted">No activity recorded yet.</p>
        ) : (
          <div className="usage-table-wrap">
            <table className="usage-table">
              <thead>
                <tr><th>Time</th><th>Activity</th><th>Request</th><th>Status</th><th>Duration</th></tr>
              </thead>
              <tbody>
                {events.slice(0, 50).map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.created_at).toLocaleString()}</td>
                    <td>{event.event_type.replaceAll("_", " ")}</td>
                    <td>{event.method && event.endpoint ? `${event.method} ${event.endpoint}` : "—"}</td>
                    <td>{event.status_code ?? "—"}</td>
                    <td>{event.duration_ms === null ? "—" : `${event.duration_ms} ms`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

function TeamPanel({ user }: { user: User }) {
  const supabase = useMemo(() => getSupabase(), []);
  const [members, setMembers] = useState<Array<{ user_id: string; full_name: string; email: string; role: string; company_name: string }>>([]);
  const [invites, setInvites] = useState<Array<{ id: string; email: string; status: string; created_at: string }>>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [notice, setNotice] = useState("");

  async function teamHeaders(): Promise<Record<string, string>> {
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function loadTeam() {
    const response = await apiFetch("/api/team", { headers: await teamHeaders() });
    const data = await response.json();
    if (!response.ok) return setNotice(data.error ?? "Unable to load team.");
    setMembers(data.members ?? []);
    setInvites(data.invites ?? []);
    const me = data.members?.find((member: { user_id: string }) => member.user_id === user.id);
    if (me?.company_name) setCompanyName(me.company_name);
  }

  useEffect(() => { void loadTeam(); }, []);

  async function invite(event: FormEvent) {
    event.preventDefault();
    const response = await apiFetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await teamHeaders()) },
      body: JSON.stringify({ email: inviteEmail })
    });
    const data = await response.json();
    if (!response.ok) return setNotice(data.error ?? "Invite failed.");
    setInviteEmail(""); setNotice(`Invitation recorded for ${data.email}.`); await loadTeam();
  }

  async function saveCompany() {
    const response = await apiFetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await teamHeaders()) },
      body: JSON.stringify({
        action: "profile",
        fullName: user.user_metadata.full_name || "",
        companyName,
        role: members.find((member) => member.user_id === user.id)?.role ?? "reviewer"
      })
    });
    const data = await response.json();
    if (!response.ok) return setNotice(data.error ?? "Profile update failed.");
    setNotice("Company profile saved."); await loadTeam();
  }

  return <section className="team-grid">
    <div className="panel">
      <div className="panel-heading"><div><p className="eyebrow">Organization</p><h2>Company and team</h2></div><UserCircle size={20} /></div>
      {notice ? <p className="message">{notice}</p> : null}
      <label>Company name<div className="inline-action"><input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Your engineering organization" /><button className="soft-button" onClick={saveCompany}>Save</button></div></label>
      <div className="team-list">{members.map((member) => <div className="team-member" key={member.user_id}><span className="profile-avatar small">{(member.full_name || member.email).charAt(0).toUpperCase()}</span><span><strong>{member.full_name || member.email}</strong><small>{member.email} · {member.role}</small></span></div>)}</div>
    </div>
    <form className="panel form" onSubmit={invite}>
      <div className="panel-heading"><div><p className="eyebrow">Collaboration</p><h2>Invite a reviewer</h2></div><Plus size={20} /></div>
      <label>Email address<input required type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="reviewer@company.com" /></label>
      <button className="primary">Create invitation</button>
      <div className="invite-list">{invites.map((item) => <p key={item.id}><strong>{item.email}</strong><span>{item.status} · {new Date(item.created_at).toLocaleDateString()}</span></p>)}</div>
    </form>
  </section>;
}
