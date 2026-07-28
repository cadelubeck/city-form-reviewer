# City Form Reviewer

A low-cost SaaS foundation for reviewing and saving city form intake work.

The app now includes a standards-review API that compares proposal values against public
city/client standards, then applies geotechnical or site-report requirements only when they are
stricter than the city baseline.

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

3. In Supabase, open the SQL editor and run:

   ```sql
   -- Paste the contents of supabase/schema.sql here.
   ```

   For an existing database that already has the review schema, run only
   `supabase/usage-events.sql` to add usage logging.

   Then run `supabase/engineering-documents.sql` to enable the authenticated
   standards and site-document library. This migration creates the document
   metadata/requirement store, indexes, and row-level security policies.

   Run `supabase/proposals.sql` to enable the full proposal queue, assignment
   workflow, section reviews, version metadata, dashboards, and saved compliance
   results.

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
2. Add the same two Supabase environment variables in Vercel.
3. Add `OPENAI_API_KEY` if you want AI reviewer notes. The API still returns rule-based findings
   without it.
4. Deploy.
5. In Supabase Authentication settings, add your Vercel URL to the allowed redirect URLs.

## Review API

- `GET /api/reviews` confirms the API is live and returns the public source registry.
- `POST /api/reviews` accepts proposal measurements and site/geotech findings, then returns
  controlling requirements, findings, next actions, sources used, and optional AI notes.

The current source registry includes Jones Civil public client references, Brigham City public
standards, USGS seismic screening, FEMA flood mapping, and NRCS soils screening.

## OpenAI-assisted compliance architecture

- The server uses the OpenAI Responses API with strict JSON Schema outputs.
- Proposal and geotechnical/site-report text is converted into structured civil requirements.
- Embeddings are generated for requirement-level semantic retrieval.
- Reviews retrieve the current user’s matching sources by jurisdiction/client metadata,
  then use exact metrics with embedding similarity as a controlled fallback.
- The deterministic review engine—not the model—selects the controlling value.
- City/client standards remain the baseline. A site source controls only when its value is
  deterministically comparable and stricter.
- Compatible inch/foot values are normalized. Incompatible units, comparators, or categorical
  conflicts are sent to licensed-engineer review.
- Every finding includes its controlling source, citation, optional page/excerpt, explanation,
  and recommended correction.
- AI narrative output is advisory and cannot approve a proposal.

## Security notes

- Database row-level security is enabled in `supabase/schema.sql`.
- Users can only read, create, update, and delete their own reviews.
- Supabase Auth securely hashes passwords; the application never stores readable passwords.
- API usage and account activity are recorded in `usage_events`, protected by row-level security.
- The Profile tab shows each user only their own request totals and recent troubleshooting activity.
- Supabase service-role keys must never be added to the browser or committed to Git.
- Security headers are configured in `next.config.ts`.
- Keep `.env.local` private. It is ignored by Git.
