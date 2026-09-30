---
name: advanced-reasoning-mcts
description: Tree-of-Thought (ToT) reasoning and Monte Carlo Tree Search (MCTS) decision framework for ultra-high accuracy problem solving.
---

# Advanced Reasoning & MCTS Skill Protocol

## Overview
This skill enforces Tree-of-Thought (ToT) reasoning and Monte Carlo Tree Search (MCTS) decision modeling for complex engineering, architectural, and analytical tasks.

## Protocol Execution Steps

### 1. Tree-of-Thought (ToT) Branching
- Generate at least 3 distinct conceptual or technical solution branches before taking action.
- Evaluate each branch against hard facts, constraints, and system specifications.
- Immediately prune any branch that introduces logical contradictions or violates single-source-of-truth (SSOT) rules.

### 2. Monte Carlo Tree Search (MCTS) Evaluation
- **Selection**: Select candidate branches with highest probability of meeting user constraints.
- **Expansion**: Explore edge cases, failure modes, and regression risks for each selected branch.
- **Simulation**: Mentally or empirically model the execution of the proposed steps.
- **Backpropagation**: Score branches based on accuracy, zero-hallucination compliance, and runtime safety.
