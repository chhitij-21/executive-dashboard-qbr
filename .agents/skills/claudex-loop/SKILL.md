---
name: claudex-loop
description: Multi-model, adversarial code review and continuous feedback loop protocol.
---

# Claudex Loop Skill Specification

## Overview
The Claudex Loop is an adversarial multi-model code review protocol that systematically inventories production codebase targets, executes batch reviews, performs strict line-by-line verification, and produces verified, zero-hallucination code review reports.

## Execution Protocol

### Step 1: Inventory & Batching (`skill.inventory`)
- Scan target codebase excluding specified patterns (`node_modules/`, `dist/`, `.git/`, etc.).
- Sort files by priority tier:
  - **Tier 1 (Core)**: Server entry points, middleware, request handlers, auth service, SLA calculation engine, file I/O operations.
  - **Tier 2 (Services/Utils)**: Business logic services, data mappers, chart/PDF/PPT renderers, validators.
  - **Tier 3 (Supporting/Misc)**: Route handlers, helper scripts, non-core utilities.
- Partition files into batches of max 5 files or ~2,000 lines per batch.

### Step 2: Batch Review & Single/Multi-Model Verification (`skill.review`, `skill.verify`)
For each batch:
1. **Review**: Perform line-by-line inspection of all functions, branches, variable declarations, formulas, and error handling.
2. **Adversarial Verification**: For every potential defect found:
   - Check if the quoted line exists verbatim in the file.
   - Inspect surrounding lines to verify logic and state context.
   - Disprove false positives, style preferences, and non-actionable suggestions.
   - If confirmed, classify severity (`Critical`, `High`, `Medium`, `Low`, `Nit`).
   - If unverified or refuted, drop and record under `Discarded (Hallucination Filter)`.
3. **Null Check**: If 0 findings are returned for a batch, manually spot-check 3 random functions in that batch before confirming clean status.

### Step 3: Consolidation & Final Report (`skill.merge`)
- Merge all batch findings into a single consolidated report.
- Deduplicate by `(file, line, issue-class)`.
- Format report with Summary, Batch Ledger, Confirmed Findings, Discarded Items, and Final Verdict (`SHIP` / `SHIP WITH FIXES` / `DO NOT SHIP`).
