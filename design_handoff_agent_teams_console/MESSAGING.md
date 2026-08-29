# How messaging actually works

Notes back to the design, from building it. The console's composers are not a
chat client: the model underneath is different enough that a few things the
design assumes cannot be drawn honestly without knowing this.

## 1. There is no group inbox. Every send is N direct writes.

Each agent owns one file, `~/.claude/teams/{team}/inboxes/{agent}.json`, and
writes straight into other agents' files. There is no channel, no relay, no
broadcast primitive, and **the lead does not forward anything**.

So:

| the operator writes to | what actually happens |
|---|---|
| one teammate | 1 write |
| a pair thread in comms | 2 writes, one per participant |
| "message the team" | one write per live member |

This is why the comms footer says *a thread is two inboxes*. It is literal.

**Design consequence:** a message addressed to several agents is several
messages. The everyone room folds the copies of one send back into a single
line (same sender + same text within 2s) so the operator is not repeated once
per teammate — but the fold is cosmetic. Underneath there are still N messages,
and the room keeps showing each line's real recipient for that reason.

## 2. Who a message arrives as — this is the surprising one

The operator is **not** a member of the team, so every message has to be
stamped as somebody who is. The rule is not uniform:

| composer used | recipient | arrives stamped `from` |
|---|---|---|
| **team-lead's** composer | team-lead | **`console`** |
| **any teammate's** composer | that teammate | **`team-lead`** |
| comms pair thread | both participants | `team-lead`, or `console` for the lead's copy |
| everyone room | every live member | same rule, per recipient |

Why the split: teammates are directed by the lead in the team's own model, so a
message to a teammate arrives as the lead and reads correctly. But a message to
the lead stamped *as the lead* would be addressed from the recipient to itself,
which is the one shape that cannot mean anything — so it carries `console`
instead.

**Design consequences:**

- `console` is the operator's identity, and it appears in real data. The
  everyone room renders it as **`you`**, right-aligned, with no portrait,
  because the operator is not an agent and has no face.
- A message the operator sends *to a teammate* is **indistinguishable from one
  the lead wrote**. Nothing in the data separates them. Any design that wants
  to show "the operator said this" can only do it for messages to the lead.
- Grouping strictly by participant pair produces a `console ⇄ team-lead`
  thread, which reads as though a sixth agent joined the team. It needs its own
  treatment — the room already has one.

## 3. Delivery is not instant, and the design was right to insist on that

A message lands in the recipient's inbox file and sits there. The agent drains
it at its **next turn boundary** — the message enters its context then, not
when it was sent. A busy agent can take minutes.

Two further wrinkles:

- **A message wakes an idle recipient.** An idle agent takes a turn when mail
  arrives, so `idle` is not `unreachable`.
- **The lead's inbox is drained by the agent-teams loop, not by the lead**, and
  that loop stops with the last teammate. A message to the lead with no
  teammates alive sits unread forever. The composer says so: the ack reads
  `queued` rather than `sent` in exactly that case.

Ack states, in full: `sent` · `queued` (lead, no teammate alive) · `not sent`
(the POST failed).

## 4. "Read" is inferred, never reported

Nothing ever writes `read: true` into an inbox file. An entry is written
`read: false` and **deleted** when the agent takes it, so the inbox can only
ever say "not yet read" or say nothing at all.

The only proof a message was read is a `<teammate-message>` frame in the
**recipient's own transcript** — that frame *is* the message inside its context
window, stamped at the turn boundary that pulled it in. That is where
`read at turn N` comes from, and why the turn number is real rather than
decorative.

When the console cannot place the turn within the history it holds, it says a
plain `read` rather than inventing an ordinal.

**This was broken until recently:** the transcript side was never wired, so
every message showed `delivered · unread` forever — including ones acted on
seconds earlier. It looked exactly like messaging being broken. It was not; the
console just had no way to see the other half.

## 5. Enter sends

Originally only `⌘⏎` sent, and a plain Enter inserted a newline into a
one-row box — which scrolled the typed message out of sight and sent nothing.
Typing a message and pressing Enter was indistinguishable from a dead console.

Now: **Enter sends · Shift+Enter newlines · ⌘⏎ still sends.** The hint reads
`⏎`, since naming the one key that did *not* work was most of the trap.

## 6. What a departed agent means for the composer

A departed agent has no inbox reader left, so its composer is disabled rather
than accepting a message nothing will collect. In a pair thread only one of the
two has to still be there. A read-only console disables every composer, because
the control routes answer 409.
