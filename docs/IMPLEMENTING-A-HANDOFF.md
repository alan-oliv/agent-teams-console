# Implementing a design handoff

Written after a post-mortem on 2026-09-03: the console had been built through several careful
passes and still diverged from the canvas in six structural ways, none of which anyone had
noticed. Not one of those passes had rendered the canvas. Every decision was made from prose
describing pictures nobody looked at.

This is the loop that would have caught it.

## 0. Establish what outranks what, in writing

Before anything else, put the hierarchy in `CONSOLE-DECISIONS.md` (or the equivalent) and in
`CLAUDE.md`. For this project it is: canvas → prose docs → decisions file → existing code.

The bundle's own MANIFEST already said the canvas *is* the handoff. It still lost to `README.md`
on every close call, because a manifest line is an inference and a habit is a habit.

## 1. Render it. Do not grep it.

```bash
cd <handoff-dir> && python3 -m http.server 8099
# then open http://127.0.0.1:8099/<Canvas>.dc.html#<artboard-id>
```

A `.dc.html` fetches its design-system bundle at runtime, so `file://` gives a blank or
half-drawn page. Some bundles ship a `standalone.html` with everything inlined — that one opens
by double-click.

**Screenshot every artboard to `docs/design/<id>-<name>.jpg` before writing any code.** That set
is the reference for the rest of the project. Ten minutes.

Grep is for finding *which* artboard covers a thing. It is never how you learn what it looks
like. Text extraction gives you labels and ids and silently drops layout, density, and every
piece of furniture in a pane — which is exactly the class of thing that went wrong here.

## 2. Inventory the data before designing the ingest

For every artboard, list every value it displays and mark it:

- **derivable** — we can compute it from what is on disk today
- **partial** — we can compute it sometimes, or with known gaps
- **absent** — nothing on disk produces this

Do this *before* building. Otherwise each absent field becomes its own mid-build refusal, and
the refusals accumulate: on this project five separate rulings each honestly refused one number,
and together they turned a work-item grid into a flat table of dashes.

One inventory is one conversation with the designer, where "then drop that panel" is still an
available answer.

## 3. One artboard, one component, one screenshot

Put the artboard id in the component that implements it, and keep the screenshot next to the
code. `docs/design/8a-trace.jpg` ←→ `src/web/views/Trace.tsx`. Then "does this match?" is always
answerable by opening two files, by anyone, at any time.

## 4. Verify against the picture, not the test suite

This is the step that was missing.

Tests check internal consistency. On this project 1799 of them passed while the solo stream was
the wrong layout, the bar said the wrong word, and two panes were missing furniture. A green
suite never once pointed at the design.

So for every view, before calling it done:

1. screenshot the running app in the state the artboard shows
2. put it beside the artboard screenshot
3. write the differences down — every one, including the ones you intend to keep

A difference you chose is a `deviation` (§5). A difference you did not choose is a bug. The list
is the deliverable; "looks right" is not.

## 5. Log deviations as deviations

Split the decisions file by kind, because "the design contradicts itself and we picked a side"
and "we chose differently from the design" are not the same act and must not read the same:

| Kind | Meaning | What it owes |
|---|---|---|
| `reconcile` | The bundle contradicts itself. | Nothing — cite the sources. |
| `blocked` | The design is right, the data does not exist. | The missing field, named. Reopen when it lands. |
| `gap-fill` | The design is silent; we invented something. | Say that it is not design-backed. |
| `deviation` | **We chose differently from the canvas.** | The artboard, looked at, and what it gives up. |

The requirement that carries the weight: **a `deviation` row must cite the artboard and state
what was traded away.** This project's worst deviation reasoned from the word `stream` in a
sentence and concluded a `stream` view would be "a prop, not a view". The artboard shows a
different layout entirely. That row could not have been written in that form if attaching the
picture had been mandatory.

Never renumber rows — code comments cite them. Mark superseded ones in place.

## 6. Do not seal decisions

A section headed "do not fix these back" stops its contents being re-examined, including when
the reason expires. On this project one such entry outlived its own premise by weeks: bare
sessions were excluded from the picker because they had nowhere to go, and stayed excluded after
they got somewhere to go.

Record the reasoning instead of the prohibition. Settled, not sealed.

## The whole thing in one line

Look at it, check what you can feed it, then keep looking at it.
