---
trigger: always_on
description: Use this project's Strata memory (decisions, history, rules) before changing code.
---
<!-- managed by `strata setup`; rerun it to update this file instead of editing it -->

# Project memory (Strata)

This repository keeps its development memory with Strata: why the code is the way it is, what was tried and
failed, and the rules a change must respect.

Before you change code:

1. Read `docs/strata/DECISIONS.md` for decisions, failed approaches and rules that apply to the files you will
   touch. A decision marked `OUT OF DATE` or `CONTRADICTED BY GIT` must not be relied on without checking the code.
   Items labelled `DECLARED` are claims someone wrote down, not verified facts.
2. Read `docs/strata/FLOW.md` for how the project evolved and how its modules fit together.
3. If you can run commands, get context for your exact task: `strata context "<your task>"`.
   Its first section, APPLICABILITY, says how far the context answers the task.

After you finish, if you made a decision or an approach failed, record it so the next agent knows:

`strata record --intent "<what was decided and why>" --files <paths> --attempt "<approach>:failed:<why>"`
