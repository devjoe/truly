# General Page Reader Fable 5 Validation Handoff

This checklist is for an external product/design review after the Page/Web
parser advisor and model-brief path are implemented.

## What To Validate

- A clean article page should show a readable extracted preview, source links,
  `Reading context`, and an auto-generated page brief when Tier B is configured.
- A noisy fallback page should show caution, run the parser advisor, and either
  produce `page_overview_only` or ask for a user target instead of pretending it
  found a clean article.
- A short but semantic article should remain eligible for model context, but be
  visibly marked as caution.
- A selected paragraph should analyze the selected text, not the whole page.
- Candidate-block recovery should replace weak fallback text with the full
  selected block before the model brief is sent.
- The panel should expose enough context for early users to judge quality
  without feeling like a developer console.

## Suggested Review Flow

1. Run `npm run check:public` to verify the committed public gates.
2. Run the CDP audit against the loaded unpacked extension:

   ```bash
   TRULY_EXTENSION_ID=... TRULY_AUDIT_AUTO_RELOAD=1 npm run audit:general-page-reader
   ```

3. Run a private 200-target review and label it in `review.html`.
4. Export `manual-labels.jsonl`.
5. Run:

   ```bash
   npm run score:general-page-product-quality -- \
     --review tmp/general-page-product-quality/review-.../review.json \
     --labels tmp/general-page-product-quality/review-.../manual-labels.jsonl \
     --output tmp/general-page-product-quality/review-.../quality-gate.json
   ```

6. Inspect failures by category and issue tag, then decide whether they become
   new synthetic fixtures, parser heuristic changes, or model-advisor prompt
   changes.

## Privacy Boundary

Do not attach or commit real URLs, screenshots, review HTML, JSONL labels,
source HTML, copied page text, or per-target findings to the public repo. Public
follow-up should be aggregate-only or converted into synthetic fixtures.
