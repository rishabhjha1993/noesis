# Noesis Operating Contract

## Product

Noesis

Internal thesis: “Noesis discovers what you didn't know to ask about what you're looking at.”

External promise: “See what you would have missed.”

## Core Product Rule

Research may deepen the image. Research may never leave the image behind.

Every final discovery must be triggered by something genuinely present in the uploaded visual. Contextual or researched facts are valuable only when they explain a visible feature, make a visible pattern more surprising, overturn a tempting misreading, verify an identity necessary for interpretation, or materially change how the user reads the image. Reject generic topic trivia.

## Quality Bar

Optimize for accuracy, visual dependence, surprise, explanatory depth, specificity, consequential understanding, and reinterpretation of the original visual. Do not optimize for the maximum number of facts or pad output to five discoveries.

## Product Architecture Principle

The desired loop is:

SEE → QUESTION → selectively RESEARCH → DISCOVER → RETURN TO THE IMAGE

The visual remains the source of the investigation.

## Cost–Quality Engineering

Production cost efficiency is a first-class product requirement. Optimize for the lowest cost per successful analysis while preserving non-inferior visual grounding, discovery usefulness, unsupported-claim rate, research usefulness, source integrity, and existing evaluation dimensions. Evaluate every optimization on fixed same-input baselines.

Prefer deterministic governance at pipeline handoffs: validate structured outputs and invariants; pass only required, deduplicated candidates, questions, claims, and evidence; use deterministic computation and cache checks where appropriate; select cheaper model/reasoning configurations only when evidence supports them; escalate only ambiguous or failing portions; and repair individual invalid outputs instead of regenerating a full pipeline. Do not automatically add an LLM manager between stages.

The preferred operating model is: use the cheapest configuration likely to succeed, enforce strict grounding and quality validation, escalate only the portion that fails, and stop once baseline quality is met. Never weaken tests, quality gates, validation, safety, or product constraints to make an optimization pass, and do not redesign the current pipeline merely because this principle exists.

Track cost per successful analysis, cost per retained discovery, escalation rate, cache-hit rate, research calls, token usage, and latency. Preserve the existing security protections, instrumentation, and legacy `/` behavior.

## Visual Scope

Noesis must work across arbitrary visuals, including photographs, maps, slides, charts, Sankeys, dashboards, architecture diagrams, scientific figures, schematics, screenshots, historical images, artwork, visual documents, and unfamiliar image types.

Never assume every visual can be understood through rectangular segmentation. Support LOCAL, RELATIONAL, and GLOBAL discoveries.

## Legacy Preservation

The existing root `/` legacy Noesis experience must remain working unless a future task explicitly authorizes replacing it.

Do not casually alter legacy AI prompts, model allocation, deterministic computation, existing eval artifacts, or baseline/V1/V2 experiments.

## Replit

Replit is historical prototype infrastructure. Do not reconnect Replit, deploy to Replit, modify its deployment, or treat it as the current product source of truth.

## Current Product Infrastructure

The independent product is deployed through the existing Railway project named `Noesis`:

https://noesis-production-b3c2.up.railway.app/

Keep this deployment target unless explicitly instructed otherwise.

## Safety

Never expose `OPENAI_API_KEY`, secrets, internal prompts, or private environment variables.

Preserve the existing rate limits, upload limits, concurrency protection, sanitized errors, security headers, CORS controls, and optional access gate.

Never commit `.env`, `.env.local`, API keys, Railway secrets, database credentials, `node_modules`, local caches, temporary native binaries, or unintended generated files.

## Development Discipline

Before changing code:

1. Read this file and `PROGRESS.md`.
2. Inspect Git status and the current branch.
3. Understand the relevant existing code before replacing it.
4. Preserve dirty working-tree changes; never discard them silently.

After a meaningful milestone:

1. Update `PROGRESS.md`.
2. Run proportionate verification.
3. Inspect the relevant diff and staged files for secrets.
4. Create a focused commit and push the intended branch.
5. Record the milestone commit SHA in `PROGRESS.md` when practical.

Never use destructive reset, force push, destructive stash/pop, or shared-history rewriting unless the user explicitly approves it. Never push knowingly broken work merely to satisfy a checkpoint schedule. Use an explicitly labeled WIP commit only when necessary to prevent incomplete work from being lost.

## AI and Research Discipline

Use official OpenAI documentation for current OpenAI API behavior; do not guess current SDK syntax. Do not add agents merely because multi-agent architecture sounds sophisticated. Quality gains must justify complexity. Human judgment remains the final judge of discovery quality.

## No Automatic Iteration

When an experiment says “run once and stop,” do exactly that. Do not tune prompts or models based on the result until the user has reviewed it.
