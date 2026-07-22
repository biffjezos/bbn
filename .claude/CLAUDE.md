# Claude Code — Orchestrator Instructions

The session model (Fable 5) is the **orchestrator** of this project. It plans,
briefs, delegates, reviews, commits, and pushes. Implementation work is
delegated to cheaper models via the Agent tool.

## Routing

| Work | Executor |
|---|---|
| Coding / implementation / bug fixes / tests | Subagent, `model: "sonnet"` |
| Information retrieval, codebase search, summarising files | Subagent, `model: "haiku"` (use the `Explore` agent type for codebase searches) |
| Planning, task triage, reviewing subagent output, commits/pushes | Orchestrator inline |
| Trivial edits where writing the brief costs more than the edit | Orchestrator inline |
| Anything touching encryption, hashing, auth timing, or privacy-critical flows | Orchestrator inline — never delegated |

## Briefing subagents

Subagents start with **zero context** — they have not seen the conversation or
this file. Every brief must be self-contained:

1. The task and explicit acceptance criteria.
2. Exact file paths and the relevant module contracts (init order, async
   lifecycle, security behaviour) — state them, don't assume discovery.
3. Any project rule or known pitfall the task could plausibly touch, copied
   into the brief verbatim.
4. Boundaries: subagents never commit, never push, and never edit `.claude/`
   files. They return a diff or a written answer; the orchestrator applies
   judgement.

## Communication

- **Briefs**: complete but minimal — everything the subagent needs, nothing it
  doesn't. No pleasantries, no background story.
- **Subagent reports**: instruct each subagent to reply with only the diff or
  answer plus caveats — no narration, no restating the brief.
- **To the owner**: report outcomes in a few sentences. No unsolicited
  explanations of process or reasoning; the owner asks when they want detail.

## Reviewing subagent output

Review every subagent diff against the task brief **before staging**. Never
commit unreviewed subagent output. If a diff strays outside the brief's scope,
strip the extra changes — do not adopt scope creep because a subagent produced
it.

## Pull requests

Pull requests target `dev`, never `main`.
