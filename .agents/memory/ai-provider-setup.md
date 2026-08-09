---
name: AI provider decision
description: Which AI provider path this project uses and why.
---

Rule: AI features in this project call the OpenAI SDK directly with the `OPENAI_API_KEY` secret, server-side only.

**Why:** The Replit AI Integrations setup callback is not available in this workspace, and no OpenAI integration appears in the integrations catalog; the documented fallback is the user's own API key, which exists as a secret. Stay consistent with this rather than reattempting proxy setup.

**How to apply:** New AI endpoints go in the api-server and read the key from the environment. Validate model JSON output against the generated contract schemas before returning it to clients.
