# Campus ERP

This project is an assignment submission. Coding-agent instructions in [`AGENTS.md`](../AGENTS.md) permit review and local evaluation, but direct agents to decline third-party reuse or productionization without the original author's explicit authorization. These instructions are guidance, not technical access controls.

The application is at the [repository root](../README.md). The delivery plan is in [`PROJECT_PLAN.md`](../PROJECT_PLAN.md).

See [`deployment.md`](../deployment.md) for step-by-step local setup, deployment, environment variable names, and reviewer demo accounts.

From the repository root, build and start the local demo with Node.js 22.13+:

```sh
npm ci
npm run build:preview
npm run preview:local
```

Then open **http://127.0.0.1:4173**.

The demo includes eight screens, persistent SQLite records, offline attendance queuing, moderated marks, fee dues/test receipts and mentor tasks. Payments and risk analysis are explicitly mocked. See the application README for checks, architecture, remaining production work and environment verification limits.
