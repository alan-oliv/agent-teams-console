---
name: implement-task-list
description: Use when a task list exists and the user asks to implement it, work through it, start on it, or run it — or when a session has settled on several pieces of work and the user asks to delegate them, hand them to teammates, or split them up as a team
---

# Implement Task List

## Overview

Turn work the session has already identified into tasks on the shared list, then
hand each one to a teammate that owns it from unread to open PR.

**Core principle: the lead delegates the work AND the paperwork.** A teammate that
does not claim its own task, invoke its own skills, and open its own PR is a pair
of hands, not an owner — and the lead becomes the bottleneck it was trying to avoid.

## The Pipeline

1. **Name the work.** List the items from session context. Show the list.
2. **Settle the branch shape and the terminal deliverable — once, before
   dispatching.** The branch shape you derive; only the push is the user's call.
   See below.
3. **`TaskCreate` one task per item**, before any teammate exists.
   **REQUIRED SUB-SKILL:** `agent-teams-console:to-agents-task-list` — what each
   task has to carry, and the model each one is worth.
4. **Decide how many teammates.** Count tracks, not tasks.
5. **Dispatch**, using the contract below. Assign the owner with `TaskUpdate`.
6. **Verify the roster before they get deep.** Every teammate you dispatched has
   to appear in `~/.claude/teams/<team>/config.json`:
   `jq -r '.members[].name' ~/.claude/teams/<team>/config.json`. A name missing
   there is not a teammate, whatever the spawn result said — respawn it. Do this
   immediately; a wrong roster is cheap to fix in the first minute and expensive
   once six agents have edited files.
7. **Stay free.** Review diffs, answer questions, relay results.

## Step 2a: Derive the Branch Shape — Don't Ask

The task graph already answers this. Read it off the blockers, state your decision
in one line, and move on. Asking the user to pick a branching strategy pushes a
question at them that only you have the dependency graph to answer.

| What the graph says | Branch shape |
|---|---|
| Any two tracks run at the same time | **One shared branch, one PR for the batch.** The only option |
| Every task is blocked by the previous one — one track, one teammate | One branch per task, stacked, a PR each, IF you want reviewable slices |
| Sequential tasks inside a track, parallel tracks beside it | Still one shared branch. The concurrency decides it |

**Why concurrency forecloses the choice:** teammates share one checkout, so they
share HEAD. Two teammates cannot sit on two branches — a `git checkout -b` moves
everyone. Per-task PRs need per-task branches, and per-task branches need no
concurrency, so the moment two tracks overlap the stacked-branch option is gone.
Do not discover this by trying it.

**Cut the branch yourself before dispatching**, and tell every teammate it is
already checked out and not to run `git checkout -b`. Sequential tasks in one track
land as successive commits on it; parallel tracks stay apart by file ownership, not
by branch.

**One PR, opened by whoever finishes first.** Every dispatch prompt says: open a PR
against `main` if none exists for the branch yet and report its URL, otherwise your
push lands in the existing one — just report that. Without that sentence, either
everyone tries to open a PR or nobody does.

## Step 2b: Settle the Terminal Deliverable

Opening a PR is outward-facing, so an agent will correctly refuse it by default and
end at "committed on your branch." That default is right, and it is also the single
most common way this workflow ends up half-finished.

This half you do ask, because pushing is outward-facing and the branch shape is not.
Ask once, before dispatching, in one line:

> That's <N> tasks across <M> teammates on one shared branch. First one green opens
> a PR against `main` and the rest push into it — ok, or would you rather they stop
> at commits and you open it?

Fill in your own counts from step 4, and your own branch shape from step 2a; the
numbers above are placeholders, not a default shape.

Whatever comes back is the answer **for the whole batch**, and every dispatch prompt
must state it explicitly. Do not ask per teammate, and do not leave it unstated and
let each teammate decide — that is how three branches land and two sit unpushed.

## Step 4: How Many Teammates

**N = the number of tracks that do not fight over the same files.** Not the number
of tasks.

| Situation | Teammates |
|---|---|
| Two tasks edit the same file | One teammate, both tasks, in order |
| A task depends on another's output | Same teammate, sequentially, or a later wave |
| A task nothing else touches | Its own teammate, dispatched now |
| A task that is small and easy | Still a teammate. Never keep it for yourself |

### Teammates share one checkout

**Never pass `isolation: "worktree"` when spawning a teammate.** It routes the
`Agent` call down the ordinary-subagent path, and what comes back is not a
teammate at all: it never enters `members[]`, gets no `TaskGet`/`TaskUpdate`, has
no mailbox, and never appears in the console. Nothing errors. You find out when a
"teammate" messages you saying it cannot read the task list.

There is no per-teammate worktree to reach for. Isolation comes from **disjoint
file ownership**, and the dispatch prompt is where you create it:

- Name the files each teammate owns, and name the ones it must not touch.
- Each stages its own paths **by name**. Never `git add -A` or `git add .` — it
  sweeps up a neighbour's half-finished edit.
- One shared branch for the batch, unless step 2a derived otherwise. They share a
  checkout, so they share HEAD: a teammate running `git checkout -b` moves
  everyone. Create the branch yourself before dispatching.
- A test failure in a file a teammate does not own means a neighbour was
  mid-edit. Re-run once, then report it — never fix another teammate's file.
- A commit can fail on an index lock. Wait, retry.

## The Dispatch Contract

Every dispatch prompt has these seven parts, in this order. Parts 1, 3 and 6 are the
ones that get dropped.

1. **The task.** Its id, and: "Call `TaskGet` on it. Claim it with `TaskUpdate`
   (`owner` = your name, `status` = `in_progress`) before you start."
2. **The goal.** The done state in one sentence — not a list of steps.
3. **Skills.** "Check your available skills before you start and use what fits.
   If the shape of the work is unsettled, `superpowers:brainstorming` first. If you
   are writing a plan, `superpowers:writing-plans`. If you are writing code,
   `superpowers:test-driven-development`. Before you claim done,
   `superpowers:verification-before-completion`."
4. **Scope.** Files you own, files that are off limits, who else is live where.
5. **Verification.** The exact commands, and paste the output.
6. **The terminal deliverable.** The answers from steps 2a and 2b, stated in full.
   Name the branch and say it is already checked out — never "branch off `main`",
   which invites the `git checkout -b` that moves everyone. For the PR case:
   "Commit on `<branch>`, staging your paths by name, then push. If no PR against
   `main` exists for this branch yet, open one and report its URL; if one already
   exists, your push lands in it and you just report that."
   For the commit case: "Commit on `<branch>`. Do not push."
   Add: "No AI attribution or 'generated with' footer in the commit or the PR body."
7. **Close out.** "`TaskUpdate` your task to `completed`, then report: what you did,
   the verification output, and anything you deliberately left alone."

## Common Mistakes

| Mistake | Fix |
|---|---|
| "Pushing is the user's call, so I'll stop at a commit" | You asked in step 2b. Carry that answer into part 6 |
| Asking the user to choose a branching strategy | Step 2a derives it from the blockers. Only you have the graph |
| Per-task branches or PRs while tracks run in parallel | One checkout, one HEAD. Concurrency already foreclosed it |
| Keeping the small task for yourself | Delegate it. A busy lead can't review or unblock |
| Calling `TaskUpdate` on a teammate's behalf | Part 1 makes it theirs. Yours is the owner assignment |
| One teammate per task, mechanically | Count tracks. Two teammates in one file is a merge conflict |
| Dispatching before `TaskCreate` | The list is how the work stays visible when a teammate dies |
| `isolation: "worktree"` to keep parallel writers apart | It silently spawns a subagent, not a teammate. Isolate by file ownership |
| A prompt with no part 3 | Teammates default to improvising. Name the skills |

## Red Flags

- A dispatch prompt that never says how the work ends
- Two live teammates whose scopes name the same file
- You are editing files instead of reviewing them
- A finished teammate whose task is still `pending`
- A "teammate" that cannot call `TaskGet` — it is a subagent; check `members[]`
- More agents in your spawn log than names in `members[]`
