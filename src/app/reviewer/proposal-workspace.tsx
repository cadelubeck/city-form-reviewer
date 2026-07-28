"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  AlertTriangle, BarChart3, CheckCircle2, ChevronLeft, FileSearch, Filter,
  History, Link2, Plus, RefreshCw, Search, Sparkles, Trash2, Upload, UserRound
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api-fetch";
import type { PageReviewFinding, Proposal, ProposalPriority, ProposalSection, ProposalStatus, ReviewResult } from "@/lib/types";

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
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const headers = useCallback(async (): Promise<Record<string, string>> => {
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [supabase]);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch("/api/proposals", { headers: await headers() });
      const data = await response.json();
      if (!response.ok) return setMessage(data.error ?? "Unable to load proposals.");
      setProposals(data as Proposal[]);
      if (selected) setSelected((data as Proposal[]).find((item) => item.id === selected.id) ?? null);
    } catch (error) {
      setMessage(error instanceof Error && error.name === "TimeoutError"
        ? "The proposal service did not respond within 25 seconds."
        : "Unable to load proposals.");
    }
  }, [headers, selected?.id]);

  useEffect(() => { void load(); }, [load]);

  async function updateProposal(patch: Partial<Proposal> & { id: string }) {
    const response = await apiFetch("/api/proposals", {
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
    if (!confirm("Archive this proposal? Its files, status, reviews, and history will be retained.")) return;
    const response = await apiFetch(`/api/proposals?id=${id}`, { method: "DELETE", headers: await headers() });
    if (!response.ok) return setMessage("Unable to archive proposal.");
    setSelected(null);
    setMessage("Proposal archived. The complete record remains available under Archived records.");
    await load();
  }

  const visible = proposals.filter((proposal) => {
    const matchesText = [proposal.name, proposal.client, proposal.location]
      .some((value) => value.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = !status || proposal.status === status;
    const matchesMode = mode !== "my-work" || proposal.assigned_to_id === user.id;
    const matchesArchive = showArchived ? Boolean(proposal.archived_at) : !proposal.archived_at;
    return matchesText && matchesStatus && matchesMode && matchesArchive;
  });

  if (selected) {
    return <ProposalDetail
      proposal={selected}
      user={user}
      headers={headers}
      onBack={() => setSelected(null)}
      onUpdate={updateProposal}
      onReplace={(proposal) => {
        setSelected(proposal);
        setProposals((items) => items.map((item) => item.id === proposal.id ? proposal : item));
      }}
      onDelete={() => deleteProposal(selected.id)}
    />;
  }

  if (mode === "dashboard") return <ProposalDashboard proposals={proposals.filter((item) => !item.archived_at)} onOpen={setSelected} onRefresh={load} />;

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
        <button className={`soft-button ${showArchived ? "active" : ""}`} onClick={() => setShowArchived((value) => !value)}><History size={16} />{showArchived ? "Current records" : "Archived records"}</button>
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
          try {
            const response = await apiFetch("/api/proposals", {
              method: "POST", headers: await headers(), body: form,
              signal: AbortSignal.timeout(290_000)
            }, 120_000);
            const data = await response.json().catch(() => ({ error: `Upload failed with status ${response.status}.` }));
            if (!response.ok) return setMessage(data.error ?? "Upload failed.");
            setShowUpload(false); setSelected(data as Proposal); await load();
          } catch (error) {
            setMessage(error instanceof Error && error.name === "TimeoutError"
              ? "The initial extraction timed out. Your file was not lost—please retry with the deep review after the upload completes."
              : error instanceof Error ? error.message : "Upload failed.");
          } finally {
            setBusy(false);
          }
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
      <button className="primary" disabled={busy || (!file && !fields.text.trim())}><Sparkles size={18} />{busy ? "Reading words and pages… this can take a few minutes" : "Create review"}</button>
    </form>
  </div>;
}

function ProposalDetail({ proposal, user, headers, onBack, onUpdate, onReplace, onDelete }: {
  proposal: Proposal; user: User; headers: () => Promise<Record<string, string>>;
  onBack: () => void; onUpdate: (patch: Partial<Proposal> & { id: string }) => Promise<void>;
  onReplace: (proposal: Proposal) => void; onDelete: () => void;
}) {
  const [sectionId, setSectionId] = useState(proposal.sections[0]?.id ?? "");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [team, setTeam] = useState<Array<{ user_id: string; full_name: string; email: string }>>([]);
  const [versionModal, setVersionModal] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [statute, setStatute] = useState({ title: "", url: "", relevance: "", jurisdiction: "" });
  const [activePage, setActivePage] = useState(proposal.page_reviews?.[0]?.page ?? 1);
  const section = proposal.sections.find((item) => item.id === sectionId);
  const viewedVersion = selectedVersion === null ? null : proposal.versions[selectedVersion];
  const viewedText = viewedVersion?.text_content ?? proposal.text_content;
  const viewedFileUrl = viewedVersion?.file_url ?? proposal.file_url;
  const viewedFileName = viewedVersion?.original_name ?? proposal.original_name;
  const lines = viewedText.split("\n");
  const sectionIndex = proposal.sections.findIndex((item) => item.id === sectionId);
  const sectionText = section
    ? lines.slice(section.startLine, proposal.sections[sectionIndex + 1]?.startLine ?? lines.length).join("\n")
    : viewedText;
  const pageReview = proposal.page_reviews?.find((item) => item.page === activePage);

  useEffect(() => {
    headers().then((auth) => apiFetch("/api/team", { headers: auth })).then((response) => response.json())
      .then((data) => setTeam(data.members ?? [])).catch(() => {});
  }, [headers]);

  async function updateSection(patch: Partial<ProposalSection>) {
    await onUpdate({ id: proposal.id, sections: proposal.sections.map((item) => item.id === sectionId ? { ...item, ...patch } : item) });
  }

  async function addHighlight() {
    const text = window.getSelection()?.toString().trim();
    if (!text) return setMessage("Select text in the document first.");
    const note = window.prompt("Add a note for this highlight (optional):", "") ?? "";
    await onUpdate({
      id: proposal.id,
      highlights: [...proposal.highlights, {
        id: crypto.randomUUID(), text, note, sectionId, createdAt: new Date().toISOString()
      }]
    });
  }

  async function addStatute(event: FormEvent) {
    event.preventDefault();
    if (!section || !statute.title.trim()) return;
    await updateSection({
      statutes: [...(section.statutes ?? []), { id: crypto.randomUUID(), ...statute }]
    });
    setStatute({ title: "", url: "", relevance: "", jurisdiction: "" });
  }

  async function analyzeSection() {
    if (!section) return;
    setBusy("section"); setMessage("");
    try {
      const response = await apiFetch("/api/proposals/analyze", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await headers()) },
        body: JSON.stringify({ mode: "section", projectName: proposal.name, sectionTitle: section.title, text: sectionText }),
        signal: AbortSignal.timeout(290_000)
      }, 120_000);
      const data = await response.json().catch(() => ({ error: "The AI response could not be read." }));
      if (!response.ok) return setMessage(data.error ?? "AI review failed.");
      await updateSection({ score: data.data.score, aiReview: data.data });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI review failed.");
    } finally {
      setBusy("");
    }
  }

  async function runDeepReview() {
    setBusy("deep"); setMessage("The AI is reviewing every page, word, table, and diagram. This may take several minutes.");
    try {
      const response = await apiFetch("/api/proposals/analyze", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await headers()) },
        body: JSON.stringify({ mode: "deep", proposalId: proposal.id }),
        signal: AbortSignal.timeout(290_000)
      }, 200_000);
      const data = await response.json().catch(() => ({ error: "The AI response could not be read." }));
      if (!response.ok) return setMessage(data.error ?? "Deep document review failed.");
      const pages = data.data.pages ?? [];
      await onUpdate({ id: proposal.id, page_reviews: pages, diagram_analysis: data.data, status: "in_review" });
      setActivePage(pages[0]?.page ?? 1);
      setMessage(`Deep review complete: ${pages.length} page${pages.length === 1 ? "" : "s"} reviewed.`);
    } catch (error) {
      setMessage(error instanceof Error && error.name === "TimeoutError"
        ? "The deep review exceeded the browser wait limit. Retry it; the contract remains saved."
        : error instanceof Error ? error.message : "Deep document review failed.");
    } finally {
      setBusy("");
    }
  }

  async function runCompliance() {
    setBusy("compliance"); setMessage("");
    try {
      const response = await apiFetch("/api/reviews", {
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
      }),
      signal: AbortSignal.timeout(290_000)
      }, 120_000);
      const data = await response.json().catch(() => ({ message: "The review response could not be read." }));
      if (!response.ok || !data.review) return setMessage(data.message ?? "Compliance review failed.");
      await onUpdate({ id: proposal.id, compliance_review: data.review });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Compliance review failed.");
    } finally {
      setBusy("");
    }
  }

  return <section className="proposal-detail">
    <div className="detail-toolbar">
      <button className="soft-button" onClick={onBack}><ChevronLeft size={17} />Queue</button>
      <div className="detail-title"><strong>{proposal.name}</strong><small>{proposal.client} · {proposal.location}</small></div>
      <select value={proposal.priority} onChange={(e) => onUpdate({ id: proposal.id, priority: e.target.value as ProposalPriority })}><option value="">No priority</option><option value="low">Low priority</option><option value="medium">Medium priority</option><option value="high">High priority</option></select>
      <select value={proposal.status} onChange={(e) => onUpdate({ id: proposal.id, status: e.target.value as ProposalStatus })}>{statuses.map((item) => <option key={item} value={item}>{statusLabel[item]}</option>)}</select>
      <input className="due-date" type="date" value={proposal.due_date ?? ""} onChange={(e) => onUpdate({ id: proposal.id, due_date: e.target.value || null })} aria-label="Due date" />
      <label className="assignment-control"><UserRound size={15} /><select value={proposal.assigned_to_id ?? ""} onChange={(e) => {
        const member = team.find((item) => item.user_id === e.target.value);
        void onUpdate({ id: proposal.id, assigned_to_id: member?.user_id ?? null, assigned_to_name: member ? (member.full_name || member.email) : null });
      }}><option value="">Unassigned</option>{team.map((member) => <option value={member.user_id} key={member.user_id}>{member.full_name || member.email}{member.user_id === user.id ? " (me)" : ""}</option>)}</select></label>
      <button className="soft-button" onClick={() => setVersionModal(true)}><History size={16} />v{proposal.versions.length + 1}</button>
      {proposal.archived_at
        ? <button className="soft-button" onClick={() => onUpdate({ id: proposal.id, archived_at: null })}><RefreshCw size={16} />Restore</button>
        : <button className="delete-button" onClick={onDelete} title="Archive proposal"><Trash2 size={16} /></button>}
    </div>
    {message ? <p className="message">{message}</p> : null}
    <div className="detail-actions">
      <button className="primary" onClick={runCompliance} disabled={!!busy}><CheckCircle2 size={17} />{busy === "compliance" ? "Reviewing…" : "Controlling standards"}</button>
      <button className="soft-button" onClick={runDeepReview} disabled={!!busy}><FileSearch size={17} />{busy === "deep" ? "Reviewing every page…" : proposal.page_reviews?.length ? "Re-run deep page review" : "Deep review: words, pages & diagrams"}</button>
      <span>{proposal.project_scope.join(" · ") || "Scope not detected"}</span>
    </div>
    {proposal.page_reviews?.length ? <nav className="page-review-nav" aria-label="Reviewed pages">
      {proposal.page_reviews.map((page) => <button className={page.page === activePage ? "active" : ""} key={page.page} onClick={() => setActivePage(page.page)}>
        <span>Page {page.page}</span><small>{page.findings.filter((item) => item.severity !== "pass").length} flags</small>
      </button>)}
    </nav> : null}
    <div className="viewer-grid">
      <section className="document-viewer panel"><div className="panel-heading"><div><p className="eyebrow">{viewedVersion ? `Archived ${viewedVersion.label}` : `Original form · Page ${activePage}`}</p><h2>{viewedFileName ?? section?.title ?? "Proposal"}</h2></div><button className="soft-button" onClick={addHighlight}>Highlight selection</button></div>
        {viewedFileUrl && viewedFileName?.toLowerCase().endsWith(".pdf")
          ? <iframe key={`${selectedVersion}-${activePage}`} title={`${proposal.name}, page ${activePage}`} src={`${viewedFileUrl}#page=${activePage}&view=FitH`} />
          : <pre>{sectionText || "No extractable text was returned."}</pre>}
      </section>
      <aside className="review-sidebar panel">
        <div className="panel-heading"><div><p className="eyebrow">AI + engineer review</p><h2>{pageReview ? `Page ${pageReview.page}: ${pageReview.pageTitle}` : section?.title ?? "Select a section"}</h2></div></div>
        {pageReview ? <PageReview page={pageReview} /> : <div className="deep-review-empty"><FileSearch size={24} /><strong>Run the deep page review</strong><p>The AI will inspect all visible text, tables, diagrams, dimensions, and notes, then organize cited findings beside each proposal page.</p></div>}
        {proposal.sections.length > 1 ? <label>Manual review section<select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>{proposal.sections.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label> : null}
        {section ? <>
          <label>Section disposition<select value={section.score} onChange={(e) => updateSection({ score: e.target.value as ProposalSection["score"] })}><option value="green">Pass / no concern</option><option value="yellow">Needs review</option><option value="red">Deficiency</option></select></label>
          <label>Review notes<textarea value={section.notes} onChange={(e) => updateSection({ notes: e.target.value })} placeholder="Concerns, corrections, and engineer notes…" /></label>
          <button className="primary" onClick={analyzeSection} disabled={!!busy}><Sparkles size={17} />{busy === "section" ? "Analyzing…" : section.aiReview ? "Re-run AI section review" : "Run AI section review"}</button>
          {section.aiReview ? <div className="ai-section-result"><strong>{section.aiReview.summary}</strong>{section.aiReview.concerns.map((item) => <p key={item}>⚠ {item}</p>)}{section.aiReview.recommendations.map((item) => <p key={item}>→ {item}</p>)}</div> : null}
          <div className="review-subsection"><strong>Highlights</strong>{proposal.highlights.filter((item) => item.sectionId === sectionId).map((item) => <article className="highlight-card" key={item.id}><q>{item.text}</q>{item.note ? <p>{item.note}</p> : null}<button onClick={() => onUpdate({ id: proposal.id, highlights: proposal.highlights.filter((entry) => entry.id !== item.id) })}>Remove</button></article>)}</div>
          <div className="review-subsection"><strong>References and statutes</strong>{(section.statutes ?? []).map((item) => <article className="statute-card" key={item.id}><a href={item.url || undefined} target="_blank" rel="noreferrer">{item.title}</a><small>{item.jurisdiction} · {item.relevance}</small><button onClick={() => updateSection({ statutes: section.statutes?.filter((entry) => entry.id !== item.id) })}>Remove</button></article>)}
            <form className="statute-form" onSubmit={addStatute}><input required value={statute.title} onChange={(e) => setStatute({ ...statute, title: e.target.value })} placeholder="Reference title" /><input value={statute.url} onChange={(e) => setStatute({ ...statute, url: e.target.value })} placeholder="Source URL" /><div className="inline-fields"><input value={statute.jurisdiction} onChange={(e) => setStatute({ ...statute, jurisdiction: e.target.value })} placeholder="Jurisdiction" /><input value={statute.relevance} onChange={(e) => setStatute({ ...statute, relevance: e.target.value })} placeholder="Relevance" /></div><button className="soft-button"><Link2 size={15} />Add reference</button></form>
          </div>
        </> : null}
      </aside>
    </div>
    {proposal.compliance_review ? <ComplianceResults result={proposal.compliance_review} /> : null}
    {proposal.diagram_analysis ? <AnalysisPanel analysis={proposal.diagram_analysis} /> : null}
    {versionModal ? <VersionModal proposal={proposal} headers={headers} busy={busy} onBusy={setBusy} onClose={() => setVersionModal(false)} onSelect={(index) => { setSelectedVersion(index); setVersionModal(false); }} onUpdated={(updated) => { onReplace(updated); setSelectedVersion(null); setVersionModal(false); }} /> : null}
  </section>;
}

function PageReview({ page }: { page: Proposal["page_reviews"][number] }) {
  return <div className="page-review">
    <p className="page-summary">{page.summary}</p>
    {page.visualObservations.length ? <details><summary>Visual and diagram observations</summary>
      <ul>{page.visualObservations.map((item) => <li key={item}>{item}</li>)}</ul>
    </details> : null}
    <div className="page-findings">
      {!page.findings.length ? <div className="finding-empty"><CheckCircle2 size={18} />No page-specific concern identified from the supplied standards.</div> : null}
      {page.findings.map((finding: PageReviewFinding) => <article className={`page-finding ${finding.severity}`} key={finding.id}>
        <div className="finding-heading"><span>{finding.severity.replace("-", " ")}</span><strong>{finding.title}</strong></div>
        <dl>
          <div><dt>Proposal evidence</dt><dd>{finding.proposalEvidence || "Not shown or unreadable"} <small>Page {finding.proposalPage}</small></dd></div>
          <div><dt>Controlling standard</dt><dd>{finding.standardRequirement || "No supplied standard supports a deterministic comparison."}</dd></div>
        </dl>
        <p>{finding.explanation}</p>
        {finding.recommendedCorrection ? <p className="correction"><strong>Correction:</strong> {finding.recommendedCorrection}</p> : null}
        {finding.standardUrl
          ? <a className="standard-link" href={finding.standardUrl} target="_blank" rel="noreferrer"><Link2 size={14} />{finding.standardTitle}{finding.standardPage ? ` · page ${finding.standardPage}` : ""}</a>
          : finding.standardTitle ? <span className="library-citation">{finding.standardTitle}{finding.standardPage ? ` · page ${finding.standardPage}` : ""} · document library</span> : null}
      </article>)}
    </div>
  </div>;
}

function VersionModal({ proposal, headers, busy, onBusy, onClose, onSelect, onUpdated }: {
  proposal: Proposal;
  headers: () => Promise<Record<string, string>>;
  busy: string;
  onBusy: (value: string) => void;
  onClose: () => void;
  onSelect: (index: number | null) => void;
  onUpdated: (proposal: Proposal) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  async function upload() {
    if (!file) return;
    onBusy("version"); setError("");
    const body = new FormData();
    body.append("proposalId", proposal.id);
    body.append("name", proposal.name);
    body.append("client", proposal.client);
    body.append("location", proposal.location);
    body.append("versionLabel", label);
    body.append("file", file);
    const response = await apiFetch("/api/proposals", { method: "POST", headers: await headers(), body }, 120_000);
    const data = await response.json();
    onBusy("");
    if (!response.ok) return setError(data.error ?? "Version upload failed.");
    onUpdated(data as Proposal);
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal-card">
      <div className="panel-heading"><div><p className="eyebrow">Document control</p><h2>Version history</h2></div><button className="modal-close" onClick={onClose}>×</button></div>
      <button className="version-row current" onClick={() => onSelect(null)}><span className="document-icon">📄</span><span><strong>v{proposal.versions.length + 1} · Current</strong><small>{proposal.original_name}</small></span></button>
      {[...proposal.versions].reverse().map((version, reverseIndex) => {
        const index = proposal.versions.length - 1 - reverseIndex;
        return <button className="version-row" key={`${version.label}-${index}`} onClick={() => onSelect(index)}><span className="document-icon">📄</span><span><strong>{version.label}</strong><small>{version.original_name} · {new Date(version.uploaded_at).toLocaleString()}</small></span></button>;
      })}
      <div className="version-upload form">
        <p className="eyebrow">Upload replacement</p>
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={`Version label, e.g. v${proposal.versions.length + 2}`} />
        <label className="file-drop"><input type="file" accept=".pdf,.txt,application/pdf,text/plain" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><Upload size={20} /><strong>{file?.name ?? "Choose revised PDF or TXT"}</strong></label>
        {error ? <p className="message">{error}</p> : null}
        <button className="primary" disabled={!file || busy === "version"} onClick={upload}>{busy === "version" ? "Extracting revision…" : "Upload new version"}</button>
      </div>
    </section>
  </div>;
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
  const reviewerCounts = Object.entries(Object.groupBy(proposals, (item) => item.assigned_to_name || "Unassigned"));
  return <section className="dashboard-view">
    <div className="dashboard-heading"><div><p className="eyebrow">Proposal overview</p><h2>Manager dashboard</h2></div><button className="soft-button" onClick={onRefresh}><RefreshCw size={16} />Refresh</button></div>
    <div className="status-grid"><div className="metric"><span>Total proposals</span><strong>{proposals.length}</strong></div>{statuses.map((item) => <div className={`metric status-metric ${item}`} key={item}><span>{statusLabel[item]}</span><strong>{proposals.filter((proposal) => proposal.status === item).length}</strong></div>)}</div>
    <div className="dashboard-grid"><section className="panel"><div className="panel-heading"><h2>By location</h2><BarChart3 size={19} /></div>{locationCounts.map(([name, count]) => <div className="location-bar" key={name}><span>{name}</span><div><i style={{ width: `${proposals.length ? count / proposals.length * 100 : 0}%` }} /></div><strong>{count}</strong></div>)}</section>
    <section className="panel"><div className="panel-heading"><h2>Needs attention</h2><AlertTriangle size={19} /></div>{proposals.filter((item) => item.status === "needs_updates" || item.priority === "high").map((item) => <button className="proposal-row" key={item.id} onClick={() => onOpen(item)}><span className="document-icon">📄</span><span className="proposal-copy"><strong>{item.name}</strong><small>{item.location}</small></span><span className={`proposal-status ${item.status}`}>{statusLabel[item.status]}</span></button>)}</section></div>
    <section className="panel reviewer-workload"><div className="panel-heading"><h2>Reviewer workload</h2><UserRound size={19} /></div><div className="usage-table-wrap"><table className="usage-table"><thead><tr><th>Reviewer</th><th>Total</th>{statuses.map((item) => <th key={item}>{statusLabel[item]}</th>)}</tr></thead><tbody>{reviewerCounts.map(([name, items]) => <tr key={name}><td><strong>{name}</strong></td><td>{items?.length ?? 0}</td>{statuses.map((status) => <td key={status}>{items?.filter((item) => item.status === status).length ?? 0}</td>)}</tr>)}</tbody></table></div></section>
    <section className="panel"><div className="panel-heading"><h2>Recent activity</h2></div>{proposals.slice(0, 10).map((item) => <button className="proposal-row" key={item.id} onClick={() => onOpen(item)}><span className="document-icon">📄</span><span className="proposal-copy"><strong>{item.name}</strong><small>{item.client} · {item.location}</small></span><span>{new Date(item.updated_at).toLocaleDateString()}</span></button>)}</section>
  </section>;
}
