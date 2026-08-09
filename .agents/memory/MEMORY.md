# Memory index

- [AI provider decision](ai-provider-setup.md) — this project uses the OpenAI SDK directly with the OPENAI_API_KEY secret; Replit AI Integrations proxy is unavailable in this workspace.
- [OpenAPI spec integers](openapi-codegen-quirks.md) — declare whole-number fields as `type: number`, not `type: integer`, or codegen output fails the lib typecheck.
- [Reasoning token budget](reasoning-token-budget.md) — high reasoning_effort silently returns empty content when max_completion_tokens is too small; give ample headroom.
