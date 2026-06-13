# Early Preview Feedback

Created: 2026-06-12
Status: live public entrypoint

This document defines the lightweight early preview feedback route for Truly.
It is a public-facing product-feedback path, not a replacement for reproducible
GitHub bug reports.

## Routes

- Product feedback page: `https://trulyreader.org/feedback/`
- Chinese feedback form:
  `https://docs.google.com/forms/d/e/1FAIpQLSeZmQv-Q6lnluoC6_Uu3FMepbRlpCNkcDSQqFIb1Xf3yltAXA/viewform?usp=dialog`
- English feedback form:
  `https://docs.google.com/forms/d/e/1FAIpQLSfXrM9D55r1PzNFdvR6UiZFfo1cGBFcAJ5PFfq5QZsyLyuEaw/viewform?usp=dialog`
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
2. Link to the Chinese and English Google Forms.
3. Provide `hello@trulyreader.org` for direct contact.
4. Explain that reproducible technical problems belong in GitHub Issues.

## Google Form Questions

Use short questions. Avoid long product explanations inside the form.

English form intro:

> Thanks for trying Truly. Your feedback helps us understand what feels useful,
> what feels confusing, and what you would like Truly to support next.

Chinese form:

- 整體而言，你對 Truly 的第一印象是什麼？
- 哪些地方你覺得有幫助？
- 哪些地方讓你覺得困惑、不必要或不準確？
- 你希望 Truly 接下來改善或支援什麼？
- 你是否對假帳號發言帶風向感到困擾？
- 如果有，你通常用哪些線索判斷？
- 願意加入 Google Groups 測試群組，提前體驗新功能並協助測試嗎？
  若願意，請留下 Gmail。

English form:

- Overall, what is your first impression of Truly?
- What felt useful?
- What felt confusing, unnecessary, or inaccurate?
- What should Truly improve or support next?
- Are you bothered by suspected fake accounts or coordinated comments?
- If yes, what clues do you usually look for?
- Would you like to join a Google Groups testing group to try new features
  early and help test them? If yes, please leave your Gmail.

The fake-account clue question must be free text with no predefined answer
choices. The goal is to collect users' own mental models and examples.

## Extension Link Placement

The public feedback URL is final. The Side Panel External Tools area includes a
low-key `提供回饋` / `Feedback` link:

- place it at the lower-right of the section;
- use the same quiet visual style as model/source notes such as `Analyzed by`;
- keep it separate from primary external-tool buttons;
- do not show it before the reading context is available;
- link to `https://trulyreader.org/feedback/`, not directly to a Google Form.

## Response Management

Verified on 2026-06-13 by CDP against the live Google Forms editors:

- both Chinese and English forms are linked to response spreadsheets;
- both forms have email notifications enabled for new responses;
- live feedback page screenshot:
  `tmp/feedback-live-verify/feedback-live.png` (private, not committed).

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
