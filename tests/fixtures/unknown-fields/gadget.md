---
type: Gadget
title: Concept with producer-defined keys
description: Consumers MUST NOT reject unknown frontmatter keys (OKF v0.2 §4.1, §11).
x_internal_id: 42
weird_nested:
  a: 1
  b: [x, y, z]
sources:
  - files/spec.txt
generated:
  by: dsh/unversioned
  at: 2026-09-03T18:31:12.862Z
---

# Body

This bundle is conformant despite `x_internal_id` and `weird_nested`.
