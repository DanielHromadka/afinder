# aFinder feedback

Cloudflare Worker that receives „Nahlásit chybu nebo navrhnout zlepšení“ from aFinder and files it as a public issue in `DanielHromadka/afinder`. The issue is public, so a report has no e-mail and no screenshot; the Worker drops both when an old aFinder (up to 1.1.25) still sends them. The GitHub token lives only here, as a Worker secret.

```
aFinder ──POST /v1/feedback──▶ Worker ──▶ GitHub: issue (label bug / enhancement)
```

## Setup (once)

1. Create a fine-grained token limited to `DanielHromadka/afinder` with **Issues: Read and write** only.
2. Deploy:
   ```bash
   cd feedback && npm install
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN   # paste the token
   npm run deploy                         # prints https://afinder-feedback.<account>.workers.dev
   ```
3. Put `https://afinder-feedback.<account>.workers.dev/v1/feedback` into `FEEDBACK_URL` in `src/shared/feedback.ts` and release aFinder.

## Development

```bash
npm test          # Worker tests (vitest-pool-workers, GitHub mocked)
npm run typecheck
npm run dev       # local Worker; add --var GITHUB_API:http://… to point it at a fake API
# End to end from the repository root: local Worker + fake GitHub + the built aFinder
npm run test:feedback
```

Limits: 3 reports per minute per IP (Rate Limiting binding), body up to ~2 MB (room for an old version's screenshot), message up to 5000 characters. Validation is shared with the app (`src/shared/feedback.ts`). Everything fits the free plans of Cloudflare and GitHub.
