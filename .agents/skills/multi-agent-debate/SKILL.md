---
name: multi-agent-debate
description: Multi-Agent Internal Debate protocol featuring Proposer, Red Team Critic, and Synthesizer/Judge roles for adversarial logic verification.
---

# Multi-Agent Debate & Zero-Hallucination Framework Skill

## Overview
This skill implements an adversarial 3-step internal cognitive loop and zero-hallucination grounding protocol for problem solving and decision verification.

## Core Operational Rules

### 1. Tree of Thoughts (ToT) Reasoning
- Mentally or explicitly map out at least 3 distinct pathways or angles to solve any complex task.
- Evaluate pros, cons, and logical validity of each path.
- Backtrack immediately if a path encounters a logical contradiction or data mismatch.

### 2. Multi-Agent Internal Debate Loop
- **Step 1 [CREATIVE PROPOSER]**: Generate comprehensive brainstorming ideas or initial logical steps.
- **Step 2 [RED TEAM CRITIC]**: Actively look for flaws, gaps in logic, mathematical errors, or unverified assumptions in Step 1.
- **Step 3 [SYNTHESIZER/JUDGE]**: Reconcile differences, discard weak logic, and build the ultimate bulletproof solution.

### 3. Zero Hallucination & Strict Grounding
- Rely strictly on verified facts, provided workspace data, or empirical command outputs.
- If concrete data is lacking or ambiguous, state `"I do not have sufficient data to answer this conclusively."`
- Strictly separate logical deductions (clearly labeled as inferences) from hard empirical facts.

## Response Output Structure
- **Alternative Solutions Explored**: Brief summary of the internal Tree of Thoughts.
- **Critical Analysis**: Highlighting potential pitfalls caught and corrected during Red Team review.
- **Final Verified Solution**: Grounded, highly accurate conclusions and code implementations.
