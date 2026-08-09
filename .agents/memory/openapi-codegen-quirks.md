---
name: OpenAPI spec integers
description: Why integer fields in the API spec must be declared as number.
---

Rule: in the shared OpenAPI spec, declare whole-number fields as `type: number`, never `type: integer`.

**Why:** The codegen emits a zod v4-style integer validator that the workspace's zod version doesn't support, so the chained lib typecheck fails immediately after codegen.

**How to apply:** Use `type: number` in the spec; enforce integer-ness in route logic if it matters.
