# City Form Reviewer

AI-assisted civil proposal compliance review using jurisdictional standards, site-specific
geotechnical overrides, deterministic requirement comparison, and cited engineer-ready findings.

The application saves proposals before analysis, keeps every record and revision in company-scoped
storage, and runs AI review only when an engineer selects **Analyze proposal**.

## Cheapest production setup

- Host the app on Vercel Hobby while validating the idea.
- Use Supabase Free for sign-in and the Postgres database.
- Keep Stripe out until you are ready to charge customers.
- Buy a custom domain only when you want the site to look official.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a free Supabase project.

3. In Supabase, open the SQL editor and run these migrations in order:

   1. `supabase/schema.sql`
   2. `supabase/usage-events.sql`
   3. `supabase/engineering-documents.sql`
   4. `supabase/proposals.sql`
   5. `supabase/team.sql`
   6. `supabase/durable-records.sql`

   The final migration adds company isolation, durable proposal history, private file storage,
   archives, and the 50 MiB bucket limit. It is safe to rerun when applying updates because its
   changes are idempotent.

4. Copy `.env.example` to `.env.local` and add:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=your-project-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   OPENAI_API_KEY=your-server-side-openai-key
   OPENAI_MODEL=gpt-5.6-sol
   OPENAI_EMBEDDING_MODEL=text-embedding-3-small
   ```

5. Start the app:

   ```bash
   npm run dev
   ```

## Deploy on Vercel

1. Import `cadelubeck/city-form-reviewer` into Vercel.
2. Add all Supabase and OpenAI environment variables from the local setup to Vercel.
3. Keep `OPENAI_API_KEY` server-side. Never prefix it with `NEXT_PUBLIC_`.
4. Deploy.
5. In Supabase Authentication settings, add your Vercel URL to the allowed redirect URLs.

## End-to-end review workflow

1. An authenticated user uploads a PDF or text proposal directly to the private Supabase bucket.
2. The proposal record is saved as `pending`; upload does not invoke OpenAI.
3. The engineer opens the saved record and selects **Analyze proposal**.
4. Metadata selects applicable company standards and site reports by jurisdiction and client.
5. The OpenAI Responses API runs a durable background review of every page, table, note, and
   diagram and returns strict structured output with citations.
6. The same pass extracts explicit submitted measurements and project scope.
7. Normal software logic selects the city/client baseline and applies a site-specific requirement
   only when it is deterministically comparable and stricter.
8. The proposal receives saved page findings, the deterministic compliance table, and a
   consolidated errors/missing/warnings panel.
9. A licensed engineer reviews the evidence, changes status, adds notes, and makes the decision.
10. Files, revisions, status, AI results, and history remain available for future reference.

`GET /api/reviews` is the health endpoint for the structured comparison service.

## Architecture

- **Document library:** company-scoped standards, manuals, geotechnical reports, environmental
  reports, seismic sources, groundwater sources, flood sources, and soil sources.
- **Parser and retrieval:** strict schema extraction, requirement embeddings, and jurisdiction,
  client, project-type, and document-type metadata.
- **Rules engine:** exact metric matching first, semantic similarity only as a controlled fallback,
  compatible unit normalization, and deterministic stricter-of selection.
- **AI review assistant:** page and diagram reading, structured extraction, citation matching,
  summaries, and correction explanations. It never approves a proposal.
- **Human review:** assignments, priorities, statuses, notes, highlights, source links, revision
  history, archival retention, and manager dashboards.

## Review performance

- Deep reviews use OpenAI background mode so a server timeout does not discard the job.
- The browser polls the durable job and can reconnect after navigation.
- Embedding vectors are retained for software retrieval but removed from the model prompt. This
  substantially reduces request size, token processing, latency, and cost without removing any
  standard text, values, citations, or proposal content.
- The model performs page review and submitted-value extraction in one pass; the rules engine then
  performs the controlling comparison without another model request.
- Re-running a review remains intentionally available, but ordinary uploads never spend AI tokens.

## Security notes

- Database row-level security is enabled in `supabase/schema.sql`.
- Users can only read, create, update, and delete their own reviews.
- Supabase Auth securely hashes passwords; the application never stores readable passwords.
- API usage and account activity are recorded in `usage_events`, protected by row-level security.
- Proposal records, standards, and private storage paths are isolated by company with row-level
  security.
- Interactive sessions are signed out after 24 hours.
- The Profile tab shows each user only their own request totals and recent troubleshooting activity.
- Supabase service-role keys must never be added to the browser or committed to Git.
- Security headers are configured in `next.config.ts`.
- Keep `.env.local` private. It is ignored by Git.
