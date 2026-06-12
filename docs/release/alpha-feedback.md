# Early Preview Feedback

Created: 2026-06-12
Status: planned public entrypoint, waiting for Google Form URL

This document defines the lightweight early preview feedback route for Truly.
It is a public-facing product-feedback path, not a replacement for reproducible
GitHub bug reports.

## Routes

- Product feedback page: `https://trulyreader.org/feedback/`
- Human contact: `hello@trulyreader.org`
- Technical issues: GitHub Issues in the public `truly` repository

GitHub Issues should be used for reproducible bugs, visible UI problems,
screenshots, logs, or developer-facing reports. Broad product feedback,
future-use imagination, and tester-interest collection should go through the
feedback page/form.

## Feedback Page Content

The page should stay small and clear:

1. Say that Truly is an early preview and feedback is used to improve the
   reading experience.
2. Link to the Google Form once available.
3. Provide `hello@trulyreader.org` for direct contact.
4. Ask users not to submit other people's personal data, private posts, or
   non-public content.
5. Explain that reproducible technical problems belong in GitHub Issues.

## Google Form Questions

Use short questions. Avoid long product explanations inside the form.

Required or strongly suggested:

- Overall, what is your impression of Truly right now?
- What felt useful?
- What felt confusing, unnecessary, or wrong?
- What would you most want Truly to help with next?
- Are you interested in joining a tester group? If yes, leave a Gmail address.
- Do you want a reply from the maintainer? If yes, leave an email address.

Optional research questions:

- Are you bothered by suspected fake accounts or coordinated influence
  comments?
- If yes, how do you usually judge?

The second research question must be free text with no predefined answer
choices. The goal is to collect users' own mental models and examples, not to
lead them toward our assumptions.

Privacy reminder:

- Please do not submit other people's personal data, private posts, or
  non-public content.

## Extension Link Placement

Once the feedback URL is final, add a low-key `提供回饋` link in the Side Panel
External Tools area:

- place it at the lower-right of the section;
- use the same quiet visual style as model/source notes such as `Analyzed by`;
- keep it separate from primary external-tool buttons;
- do not show it before the reading context is available.

Do not add the link until the public page or form can receive feedback.

## Deferred Contributor Form

Do not include development-help collection in the first early preview feedback
form.
After the public repository or first listing is live, create a separate
contributor-interest form linked from the GitHub repository.

Suggested fields for that later form:

- short self-introduction;
- GitHub account;
- email;
- contribution area, such as UI, Chrome extension, local model setup, tests, or
  documentation.
