---
name: Reasoning tokens eat max_completion_tokens
description: gpt-5.6-sol chat completions with high reasoning_effort can return empty content if the completion budget is too small.
---

With `reasoning_effort: "high"` on chat completions, internal reasoning tokens count against `max_completion_tokens`. A 3500-token cap that worked for a small prompt returned EMPTY `message.content` (no error) once large evidence context was added.

**Why:** reasoning consumed the whole budget before any JSON was emitted; the only symptom is empty content (check `finish_reason`).

**How to apply:** give high-reasoning calls generous headroom (e.g. 16000) and include `finish_reason` in empty-response error messages.
