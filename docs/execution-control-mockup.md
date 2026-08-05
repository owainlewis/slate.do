# Execution control mockup

This standalone prototype explores Slate as a lightweight execution control plane:

- One workspace-wide work index across boards, repositories, and agents.
- Durable task links.
- Structured Markdown briefs with preview.
- Explicit agent dispatch and run attempts.
- Append-only activity.
- Pull request delivery and check evidence.

It uses in-memory example data and does not write to the Slate API.

## Run locally

From the repository root:

```bash
python3 -m http.server 4173
```

Open <http://127.0.0.1:4173/execution-control-mockup.html>.

## Verify

```bash
npm ci
npx playwright install chromium
npm run test:mockup
```
