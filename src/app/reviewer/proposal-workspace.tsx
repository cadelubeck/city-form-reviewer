"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  AlertTriangle, BarChart3, CheckCircle2, ChevronLeft, FileSearch, Filter,
  Plus, RefreshCw, Search, Sparkles, Trash2, Upload, UserRound
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import type { Proposal, ProposalPriority, ProposalSection, ProposalStatus, ReviewResult } from "@/lib/types";

type Mode = "proposals" | "my-work" | "dashboard";
const statuses: ProposalStatus[] = ["pending", "in_review", "needs_updates", "accepted", "rejected"];
const statusLabel: Record<ProposalStatus, string> = {
  pending: "Pending", in_review: "In review", needs_updates: "Needs updates",
  accepted: "Accepted", rejected: "Rejected"
};

export function ProposalWorkspace({ user, mode }: { user: User; mode: Mode }) {
  const supabase = useMemo(() => getSupabase(), []);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const headers = useCallback(async (): Promise<Record<string, string>> => {
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [supabase]);

  const load = useCallback(async () => {
    const response = await fetch("/api/proposals", { headers: await headers() });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error ?? "Unable to load proposals.");
    setProposals(data as Proposal[]);
    if (selected) setSelected((data as Proposal[]).find((item) => item.id === selected.id) ?? null);
  }, [headers, selected?.id]);

  useEffect(() => { void load(); }, [load]);

  async function updateProposal(patch: Partial<Proposal> & { id: string }) {
    const response = await fetch("/api/proposals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(await headers()) },
      body: JSON.stringify(patch)
    });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error ?? "Update failed.");
    setSelected(data as Proposal);
    setProposals((items) => items.map((item) => item.id === data.id ? data : item));
  }

  async function deleteProposal(id: string) {
    if (!confirm("Delete this proposal and its review history?")) return;
    const response = await fetch(`/api/proposals?id=${id}`, { method: "DELETE", headers: await headers() });
    if (!response.ok) return setMessage("Unable to delete proposal.");
    setSelected(null);
    await load();
  }

  const visible = proposals.filter((proposal) => {
    const matchesText = [proposal.name, proposal.client, proposal.location]
      .some((value) => value.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = !status || proposal.status === status;
    const matchesMode = mode !== "my-work" || proposal.assigned_to_id === user.id;
    return matchesText && matchesStatus && matchesMode;
  });

  if (selected) {
    return <ProposalDetail
      proposal={selected}
      user={user}
      headers={headers}
      onBack={() => setSelected(null)}
      onUpdate={updateProposal}
      onDelete={() => deleteProposal(selected.id)}
    />;
  }

  if (mode === "dashboard") return <ProposalDashboard proposals={proposals} onOpen={setSelected} onRefresh={load} />;

  return (
    <section className="proposal-hub">
      <section className="proposal-hero">
        <div>
          <p className="eyebrow">{mode === "my-work" ? "Personal dashboard" : "Proposal review queue"}</p>
          <h2>{mode === "my-work" ? "My assigned work" : "Contracts and proposals"}</h2>
          <p>{mode === "my-work"
            ? "Track assigned reviews, priorities, due dates, and decisions."
            : "Upload proposals, review sections, run AI analysis, and compare against controlling standards."}</p>
        </div>
        <button className="hero-action" onClick={() => setShowUpload(true)}><Plus size={18} />New contract</button>
      </section>

      {message ? <p className="message">{message}</p> : null}
      <div className="queue-toolbar">
        <label className="search-control"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contracts, clients, locations…" /></label>
        <label className="filter-control"><Filter size={15} /><select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {statuses.map((item) => <option key={item} value={item}>{statusLabel[item]}</option>)}
        </select></label>
        <button className="soft-button" onClick={() => void load()}><RefreshCw size={16} />Refresh</button>
      </div>

      <div className="queue-summary">
        <strong>{visible.length}</strong> contract{visible.length === 1 ? "" : "s"}
        <span>·</span><strong>{new Set(visible.map((item) => item.location || "No location")).size}</strong> locations
      </div>

      <div className="proposal-groups">
        {!visible.length ? <div className="empty"><FileSearch size={30} /><p>No matching proposals yet.</p></div> :
          Object.entries(Object.groupBy(visible, (item) => item.location || "No location")).map(([location, items]) => (
            <section className="proposal-group" key={location}>
              <div className="group-heading"><span>📍</span><strong>{location}</strong><span className="count-badge">{items?.length ?? 0}</span></div>
              <div className="proposal-list">{items?.map((proposal) => (
                <button className="proposal-row" key={proposal.id} onClick={() => setSelected(proposal)}>
                  <span className="document-icon">📄</span>
                  <span className="proposal-copy"><strong>{proposal.name}</strong><small>{proposal.client || "No client"} · {new Date(proposal.updated_at).toLocaleDateString()}</small></span>
                  {proposal.priority ? <span className={`priority ${proposal.priority}`}>{proposal.priority}</span> : null}
                  <span className={`proposal-status ${proposal.status}`}>{statusLabel[proposal.status]}</span>
                </button>
              ))}</div>
            </section>
          ))}
      </div>
      {showUpload ? <ProposalUpload
        busy={busy}
        onClose={() => setShowUpload(false)}
        onSubmit={async (form) => {
          setBusy(true); setMessage("");
          const response = await fetch("/api/proposals", { method: "POST", headers: await headers(), body: form });
          const data = await response.json(); setBusy(false);
          if (!response.ok) return setMessage(data.error ?? "Upload failed.");
          setShowUpload(false); setSelected(data as Proposal); await load();
        }}
      /> : null}
    </section>
  );
}

function ProposalUpload({ busy, onClose, onSubmit }: {
  busy: boolean; onClose: () => void; onSubmit: (form: FormData) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState({ name: "", client: "", location: "", text: "" });
  function submit(event: FormEvent) {
    event.preventDefault();
    const body = new FormData();
    Object.entries(fields).forEach(([key, value]) => body.append(key, value));
    if (file) body.append("file", file);
    onSubmit(body);
  }
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <form className="modal-card form" onSubmit={submit}>
      <div className="panel-heading"><div><p className="eyebrow">New review</p><h2>Upload contract or proposal</h2></div><button type="button" className="modal-close" onClick={onClose}>×</button></div>
      <label>Project name<input required value={fields.name} onChange={(e) => setFields({ ...fields, name: e.target.value })} placeholder="Oak Ridge infrastructure contract" /></label>
      <div className="inline-fields">
        <label>Client<input value={fields.client} onChange={(e) => setFields({ ...fields, client: e.target.value })} /></label>
        <label>Location / jurisdiction<input value={fields.location} onChange={(e) => setFields({ ...fields, location: e.target.value })} placeholder="Brigham City, UT" /></label>
      </div>
      <label className="file-drop"><input type="file" accept=".pdf,.txt,application/pdf,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /><Upload size={22} /><strong>{file?.name ?? "Choose PDF or TXT"}</strong><span>AI extracts jurisdiction, scope, sections, and submitted values</span></label>
      <label>Or paste proposal text<textarea value={fields.text} onChange={(e) => setFields({ ...fields, text: e.target.value })} /></label>
      <button className="primary" disabled={busy || (!file && !fields.text.trim())}><Sparkles size={18} />{busy ? "Extracting proposal…" : "Create review"}</button>
    </form>
  </div>;
}

function ProposalDetail({ proposal, user, headers, onBack, onUpdate, onDelete }: {
  proposal: Proposal; user: User; headers: () => Promise<Record<string, string>>;
  onBack: () => void; onUpdate: (patch: Partial<Proposal> & { id: string }) => Promise<void>; onDelete: () => void;
}) {
  const [sectionId, setSectionId] = useState(proposal.sections[0]?.id ?? "");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const section = proposal.sections.find((item) => item.id === sectionId);
  const lines = proposal.text_content.split("\n");
  const sectionIndex = proposal.sections.findIndex((item) => item.id === sectionId);
  const sectionText = section
    ? lines.slice(section.startLine, proposal.sections[sectionIndex + 1]?.startLine ?? lines.length).join("\n")
    : proposal.text_content;

  async function updateSection(patch: Partial<ProposalSection>) {
    await onUpdate({ id: proposal.id, sections: proposal.sections.map((item) => item.id === sectionId ? { ...item, ...patch } : item) });
  }

  async function analyzeSection() {
    if (!section) return;
    setBusy("section"); setMessage("");
    const response = await fetch("/api/proposals/analyze", {
      method: "POST", headers: { "Content-Type": "application/json", ...(await headers()) },
      body: JSON.stringify({ mode: "section", projectName: proposal.name, sectionTitle: section.title, text: sectionText })
    });
    const data = await response.json(); setBusy("");
    if (!response.ok) return setMessage(data.error ?? "AI review failed.");
    await updateSection({ score: data.data.score, aiReview: data.data });
  }

  async function analyzeDiagrams() {
    setBusy("diagrams"); setMessage("");
    const response = await fetch("/api/proposals/analyze", {
      method: "POST", headers: { "Content-Type": "application/json", ...(await headers()) },
      body: JSON.stringify({ mode: "diagrams", projectName: proposal.name, text: proposal.text_content })
    });
    const data = await response.json(); setBusy("");
    if (!response.ok) return setMessage(data.error ?? "Diagram analysis failed.");
    await onUpdate({ id: proposal.id, diagram_analysis: data.data });
  }

  async function runCompliance() {
    setBusy("compliance"); setMessage("");
    const response = await fetch("/api/reviews", {
      method: "POST", headers: { "Content-Type": "application/json", ...(await headers()) },
      body: JSON.stringify({
        proposal: {
          projectName: proposal.name,
          clientId: proposal.client.toLowerCase().replaceAll(" ", "-"),
          jurisdiction: proposal.location,
          address: proposal.location,
          scopeTags: proposal.project_scope,
          proposalText: proposal.text_content,
          uploadedFiles: proposal.original_name ? [proposal.original_name] : [],
          measurements: proposal.extracted_requirements.map((item) => ({
            metric: item.metric, value: item.value, unit: item.unit, citation: item.excerpt, embedding: item.embedding
          }))
        },
        siteFindings: []
      })
    });
    const data = await response.json(); setBusy("");
    if (!response.ok || !data.review) return setMessage(data.message ?? "Compliance review failed.");
    await onUpdate({ id: proposal.id, compliance_review: data.review });
  }

  return <section className="proposal-detail">
    <div className="detail-toolbar">
      <button className="soft-button" onClick={onBack}><ChevronLeft size={17} />Queue</button>
      <div className="detail-title"><strong>{proposal.name}</strong><small>{proposal.client} · {proposal.location}</small></div>
      <select value={proposal.priority} onChange={(e) => onUpdate({ id: proposal.id, priority: e.target.value as ProposalPriority })}><option value="">No priority</option><option value="low">Low priority</option><option value="medium">Medium priority</option><option value="high">High priority</option></select>
      <select value={proposal.status} onChange={(e) => onUpdate({ id: proposal.id, status: e.target.value as ProposalStatus })}>{statuses.map((item) => <option key={item} value={item}>{statusLabel[item]}</option>)}</select>
      <button className="soft-button" onClick={() => onUpdate({ id: proposal.id, assigned_to_id: proposal.assigned_to_id ? null : user.id, assigned_to_name: proposal.assigned_to_id ? null : (user.user_metadata.full_name || user.email) })}><UserRound size={16} />{proposal.assigned_to_id ? "Unassign" : "Assign to me"}</button>
      <button className="delete-button" onClick={onDelete}><Trash2 size={16} /></button>
    </div>
    {message ? <p className="message">{message}</p> : null}
    <div className="detail-actions">
      <button className="primary" onClick={runCompliance} disabled={!!busy}><CheckCircle2 size={17} />{busy === "compliance" ? "Reviewing…" : "Controlling standards"}</button>
      <button className="soft-button" onClick={analyzeDiagrams} disabled={!!busy}><FileSearch size={17} />{busy === "diagrams" ? "Analyzing…" : "Analyze plans & diagrams"}</button>
      <span>{proposal.project_scope.join(" · ") || "Scope not detected"}</span>
    </div>
    <div className="viewer-grid">
      <aside className="section-sidebar panel">
        <p className="eyebrow">Sections</p>
        {proposal.sections.map((item) => <button className={item.id === sectionId ? "active" : ""} key={item.id} onClick={() => setSectionId(item.id)}><span className={`score-dot ${item.score}`} />{item.title}</button>)}
      </aside>
      <section className="document-viewer panel"><div className="panel-heading"><div><p className="eyebrow">Document</p><h2>{section?.title ?? "Proposal text"}</h2></div><span>{proposal.original_name}</span></div><pre>{sectionText || "No extractable text was returned."}</pre></section>
      <aside className="review-sidebar panel">
        <div className="panel-heading"><div><p className="eyebrow">Engineer review</p><h2>{section?.title ?? "Select a section"}</h2></div></div>
        {section ? <>
          <label>Section disposition<select value={section.score} onChange={(e) => updateSection({ score: e.target.value as ProposalSection["score"] })}><option value="green">Pass / no concern</option><option value="yellow">Needs review</option><option value="red">Deficiency</option></select></label>
          <label>Review notes<textarea value={section.notes} onChange={(e) => updateSection({ notes: e.target.value })} placeholder="Concerns, corrections, and engineer notes…" /></label>
          <button className="primary" onClick={analyzeSection} disabled={!!busy}><Sparkles size={17} />{busy === "section" ? "Analyzing…" : section.aiReview ? "Re-run AI section review" : "Run AI section review"}</button>
          {section.aiReview ? <div className="ai-section-result"><strong>{section.aiReview.summary}</strong>{section.aiReview.concerns.map((item) => <p key={item}>⚠ {item}</p>)}{section.aiReview.recommendations.map((item) => <p key={item}>→ {item}</p>)}</div> : null}
        </> : null}
      </aside>
    </div>
    {proposal.compliance_review ? <ComplianceResults result={proposal.compliance_review} /> : null}
    {proposal.diagram_analysis ? <AnalysisPanel analysis={proposal.diagram_analysis} /> : null}
  </section>;
}

function ComplianceResults({ result }: { result: ReviewResult }) {
  return <section className="panel compliance-results"><div className="panel-heading"><div><p className="eyebrow">Cited comparison</p><h2>Controlling standards review</h2></div></div>
    <div className="result-summary"><div className="metric good"><span>Pass</span><strong>{result.summary.pass}</strong></div><div className="metric bad"><span>Fail</span><strong>{result.summary.fail}</strong></div><div className="metric warn"><span>Missing / review</span><strong>{result.summary.missing + result.summary.needsReview}</strong></div></div>
    <div className="comparison-wrap"><table className="comparison-table"><thead><tr><th>Requirement</th><th>Controlling</th><th>Proposal</th><th>Result</th><th>Reason / correction</th><th>Citation</th></tr></thead><tbody>{result.findings.map((finding) => <tr key={finding.requirementId}><td><strong>{finding.topic}</strong><small>{finding.metric}</small></td><td>{String(finding.requiredValue)} {finding.unit}</td><td>{finding.submittedValue === null ? "Missing" : String(finding.submittedValue)}</td><td><span className={`pill finding ${finding.status}`}>{finding.status}</span></td><td>{finding.explanation}<small>{finding.recommendedCorrection}</small></td><td>{finding.controllingSource}<small>{finding.citation}{finding.sourcePage ? ` · p. ${finding.sourcePage}` : ""}</small></td></tr>)}</tbody></table></div>
  </section>;
}

function AnalysisPanel({ analysis }: { analysis: Record<string, unknown> }) {
  const diagrams = Array.isArray(analysis.diagrams) ? analysis.diagrams as Array<Record<string, unknown>> : [];
  return <section className="panel analysis-panel"><p className="eyebrow">Plan intelligence</p><h2>Document and diagram analysis</h2><p>{String(analysis.summary ?? "")}</p>{diagrams.map((item, index) => <article className="review-card" key={index}><strong>{String(item.title ?? "Diagram")}</strong><p>{(item.concerns as string[] ?? []).join(" · ") || "No explicit concern identified."}</p></article>)}</section>;
}

function ProposalDashboard({ proposals, onOpen, onRefresh }: { proposals: Proposal[]; onOpen: (proposal: Proposal) => void; onRefresh: () => void }) {
  const locationCounts = Object.entries(Object.groupBy(proposals, (item) => item.location || "No location")).map(([name, items]) => [name, items?.length ?? 0] as const).sort((a, b) => b[1] - a[1]);
  return <section className="dashboard-view">
    <div className="dashboard-heading"><div><p className="eyebrow">Proposal overview</p><h2>Manager dashboard</h2></div><button className="soft-button" onClick={onRefresh}><RefreshCw size={16} />Refresh</button></div>
    <div className="status-grid"><div className="metric"><span>Total proposals</span><strong>{proposals.length}</strong></div>{statuses.map((item) => <div className={`metric status-metric ${item}`} key={item}><span>{statusLabel[item]}</span><strong>{proposals.filter((proposal) => proposal.status === item).length}</strong></div>)}</div>
    <div className="dashboard-grid"><section className="panel"><div className="panel-heading"><h2>By location</h2><BarChart3 size={19} /></div>{locationCounts.map(([name, count]) => <div className="location-bar" key={name}><span>{name}</span><div><i style={{ width: `${proposals.length ? count / proposals.length * 100 : 0}%` }} /></div><strong>{count}</strong></div>)}</section>
    <section className="panel"><div className="panel-heading"><h2>Needs attention</h2><AlertTriangle size={19} /></div>{proposals.filter((item) => item.status === "needs_updates" || item.priority === "high").map((item) => <button className="proposal-row" key={item.id} onClick={() => onOpen(item)}><span className="document-icon">📄</span><span className="proposal-copy"><strong>{item.name}</strong><small>{item.location}</small></span><span className={`proposal-status ${item.status}`}>{statusLabel[item.status]}</span></button>)}</section></div>
    <section className="panel"><div className="panel-heading"><h2>Recent activity</h2></div>{proposals.slice(0, 10).map((item) => <button className="proposal-row" key={item.id} onClick={() => onOpen(item)}><span className="document-icon">📄</span><span className="proposal-copy"><strong>{item.name}</strong><small>{item.client} · {item.location}</small></span><span>{new Date(item.updated_at).toLocaleDateString()}</span></button>)}</section>
  </section>;
}
