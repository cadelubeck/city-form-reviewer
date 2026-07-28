"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  FileCheck2,
  Globe2,
  Lock,
  LogOut,
  Plus,
  UserCircle,
  Save,
  SearchCheck,
  Sparkles
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import type {
  Review,
  ReviewResult,
  ReviewStatus,
  RiskLevel,
  SiteFinding,
  UsageEvent
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
};

const scopeOptions = [
  { id: "site-development", label: "Site" },
  { id: "roadway", label: "Road" },
  { id: "utility", label: "Utility" },
  { id: "stormwater", label: "Stormwater" },
  { id: "structure", label: "Structure" },
  { id: "commercial", label: "Commercial" }
];

export function AppShell() {
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
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [activeView, setActiveView] = useState<"reviewer" | "profile">("reviewer");
  const [usageEvents, setUsageEvents] = useState<UsageEvent[]>([]);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, [supabase]);

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
    setForm(emptyForm);
    setReviewResult(null);
    setAiNarrative(null);
    setMessage("Signed out.");
    setActiveView("reviewer");
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
    const response = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
        siteFindings: buildSiteFindings()
      })
    });

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
      setIsReviewing(false);
      return;
    }

    setReviewResult(data.review);
    setAiNarrative(data.aiNarrative ?? null);
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
    setIsReviewing(false);
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
          <div>
            <p className="eyebrow">Standards review workspace</p>
            <h1>City Form Reviewer</h1>
          </div>
          <div className="topbar-actions">
            <button
              className={`nav-button ${activeView === "profile" ? "active" : ""}`}
              onClick={() => setActiveView(activeView === "profile" ? "reviewer" : "profile")}
            >
              <UserCircle size={18} />
              <span>Profile</span>
            </button>
            <button className="icon-button" onClick={signOut} aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {activeView === "profile" ? (
          <ProfileView user={user} events={usageEvents} />
        ) : (
        <>
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
                      <p className="citation">{finding.citation}</p>
                    </article>
                  ))}
                </div>

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
