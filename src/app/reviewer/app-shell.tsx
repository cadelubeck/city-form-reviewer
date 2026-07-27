"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  FileCheck2,
  Lock,
  LogOut,
  Plus,
  Save,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import type { Review, ReviewStatus, RiskLevel } from "@/lib/types";

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
  city: "",
  permit_type: "",
  applicant: "",
  notes: "",
  risk_level: "medium" as RiskLevel,
  status: "draft" as ReviewStatus
};

export function AppShell() {
  const supabase = useMemo(() => getSupabase(), []);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getUser().then(({ data }) => setUser(data.user));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, [supabase]);

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

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setIsBusy(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      setMessage(
        signUpError
          ? signUpError.message
          : "Account created. Check your email if confirmation is enabled, then sign in."
      );
    } else {
      setMessage("Signed in.");
    }
    setIsBusy(false);
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setForm(emptyForm);
    setMessage("Signed out.");
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
    } else {
      setReviews((current) => [data as Review, ...current]);
      setForm(emptyForm);
      setMessage("Review saved.");
    }

    setIsBusy(false);
  }

  const readyForDatabase = Boolean(supabase);
  const highRiskCount = reviews.filter((review) => review.risk_level === "high").length;
  const approvedCount = reviews.filter((review) => review.status === "approved").length;

  return (
    <main className="app">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Secure review workspace</p>
            <h1>City Form Reviewer</h1>
          </div>
          <div className="security-badge">
            <ShieldCheck size={18} />
            <span>{readyForDatabase ? "Database ready" : "Add Supabase keys"}</span>
          </div>
        </header>

        <div className="metrics">
          <Metric label="Saved reviews" value={reviews.length.toString()} />
          <Metric label="High risk" value={highRiskCount.toString()} tone="warn" />
          <Metric label="Approved" value={approvedCount.toString()} tone="good" />
        </div>

        {!readyForDatabase ? (
          <section className="notice">
            <Lock size={20} />
            <div>
              <h2>Connect Supabase to make saving work</h2>
              <p>
                Add your free Supabase URL and anon key in Vercel or in a local `.env.local`
                file. The app will stay private to each signed-in user through database rules.
              </p>
            </div>
          </section>
        ) : null}

        <div className="grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Intake</p>
                <h2>New review</h2>
              </div>
              <Plus size={20} />
            </div>

            {user ? (
              <form className="form" onSubmit={saveReview}>
                <label>
                  City
                  <input
                    required
                    value={form.city}
                    onChange={(event) => setForm({ ...form, city: event.target.value })}
                    placeholder="Bloomington"
                  />
                </label>
                <label>
                  Permit or form type
                  <input
                    required
                    value={form.permit_type}
                    onChange={(event) => setForm({ ...form, permit_type: event.target.value })}
                    placeholder="Site plan review"
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
                    placeholder="Missing fields, document concerns, follow-up items..."
                  />
                </label>
                <button className="primary" disabled={isBusy}>
                  <Save size={18} />
                  <span>{isBusy ? "Saving" : "Save review"}</span>
                </button>
              </form>
            ) : (
              <AuthForm
                email={email}
                password={password}
                isBusy={isBusy}
                onEmail={setEmail}
                onPassword={setPassword}
                onSubmit={signIn}
              />
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Queue</p>
                <h2>Saved work</h2>
              </div>
              {user ? (
                <button className="icon-button" onClick={signOut} aria-label="Sign out">
                  <LogOut size={18} />
                </button>
              ) : null}
            </div>

            {message ? <p className="message">{message}</p> : null}

            <div className="review-list">
              {reviews.length === 0 ? (
                <div className="empty">
                  <Sparkles size={22} />
                  <p>{user ? "No saved reviews yet." : "Sign in to see saved reviews."}</p>
                </div>
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
        </div>
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
  tone?: "good" | "warn";
}) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AuthForm({
  email,
  password,
  isBusy,
  onEmail,
  onPassword,
  onSubmit
}: {
  email: string;
  password: string;
  isBusy: boolean;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="form" onSubmit={onSubmit}>
      <label>
        Email
        <input
          required
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
          minLength={8}
          type="password"
          value={password}
          onChange={(event) => onPassword(event.target.value)}
          placeholder="At least 8 characters"
        />
      </label>
      <button className="primary" disabled={isBusy}>
        <Lock size={18} />
        <span>{isBusy ? "Working" : "Sign in or create account"}</span>
      </button>
    </form>
  );
}
