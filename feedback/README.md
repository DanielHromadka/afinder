# aFinder feedback

Cloudflare Worker that receives „Nahlásit chybu nebo navrhnout zlepšení“ from aFinder and files it as an issue in the private repository `DanielHromadka/afinder-feedback`. The window screenshot is committed to that repository (`screenshots/YYYY-MM/<id>.jpg`) and linked from the issue, so only people with access to the repository can see it. The GitHub token lives only here, as a Worker secret.

```
aFinder ──POST /v1/feedback──▶ Worker ──▶ GitHub: screenshot file + issue (label bug / enhancement)
```

## Setup (once)

1. Create the private repository `DanielHromadka/afinder-feedback` **with a README** (the Contents API needs a default branch).
2. Create a fine-grained token limited to that repository: **Issues: Read and write**, **Contents: Read and write**.
3. Deploy:
   ```bash
   cd feedback && npm install
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN   # paste the token
   npm run deploy                         # prints https://afinder-feedback.<account>.workers.dev
   ```
4. Put `https://afinder-feedback.<account>.workers.dev/v1/feedback` into `FEEDBACK_URL` in `src/shared/feedback.ts` and release aFinder.

## Development

```bash
npm test          # Worker tests (vitest-pool-workers, GitHub mocked)
npm run typecheck
npm run dev       # local Worker; add --var GITHUB_API:http://… to point it at a fake API
# End to end from the repository root: local Worker + fake GitHub + the built aFinder
npm run test:feedback
```

Limits: 3 reports per minute per IP (Rate Limiting binding), body up to ~2 MB, JPEG screenshots only, message up to 5000 characters. Validation is shared with the app (`src/shared/feedback.ts`). Everything fits the free plans of Cloudflare and GitHub.
