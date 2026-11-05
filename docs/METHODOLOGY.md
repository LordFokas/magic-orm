# Methodology

How a project keeps what it knows: which documents exist, what goes in each, and how they change along with the code. For everyone who works on the project, people and AI assistants alike.

This file is project-neutral on purpose. Drop it into the `docs/` folder of an empty project and follow [Bootstrapping a project](#bootstrapping-a-project) to recreate the rest. Once the other documents exist, they own their content; the templates here are only seeds.

## Why

- **The repository is the memory.** Conversations end, people move on, and AI assistants start each session blank. What survives is what's written in the repo. Anything decided that will matter later goes into the document where its next reader will look. If it isn't in a doc, it wasn't decided.
- **Known issues are written down, not remembered.** A bug that only lives in someone's head gets rediscovered the hard way. A bug with an entry, a workaround and a failing test is just work waiting its turn.
- **Each fact has one home.** Two copies of a fact will eventually disagree, and nobody will know which one is right.
- **Keep it light.** This is a handful of Markdown files and a few habits, not a process. Write what the next reader needs and stop.

## The documents

All of them live in `docs/`, with names in capitals.

| File | For | Holds | Changes when |
|---|---|---|---|
| `<PROJECT>.md` | users | the user manual: what the product does and how to use it | user-visible behavior changes |
| `DEVELOPMENT.md` | contributors, embedders | how it works and why; the limitations we accept | internals or decisions change; a limitation is accepted |
| `PROBLEMS.md` | contributors | known issues we want to solve | an issue is found, better understood, or fixed |
| `TESTING.md` | contributors | how we verify: philosophy, layers, conventions | test structure, tooling or rules change |
| `METHODOLOGY.md` | everyone | this file: the documents, the rules between them, the loop | the way we work changes |

Every document has the same shape:
- **Title:** `# <PROJECT> - <Purpose>`. This file is the exception, so it can be copied as-is.
- **Opening lines:** who it's for and what it holds. Contributor documents also link to their neighbours.
- **Present tense.** It describes how things are now. History lives in git, and plans are labeled as plans (a status column, an "Intended fix").
- **Pointers over copies.** It links to the owner of a fact instead of restating it.

### `<PROJECT>.md`: the user manual
For the people who use the product, and named after it. It covers what the product is, how to install and run it, every feature and rule users can rely on, the errors they can hit, and reference material such as built-ins, options and formats.
- **It's a promise.** Users may rely on anything written here, so tests should check it. Don't document behavior you don't want to keep: if something is deliberately loose, say it's loose rather than describing today's strictness. When the manual, the code and the tests disagree, one of them has a bug, and it goes through triage.
- **No internals.** How and why it works belongs in DEVELOPMENT.md.

### `DEVELOPMENT.md`: how it works and why
For people working on the project, or building on top of it. Typical sections:
- **Repository layout:** a table of paths and what each is for.
- **Architecture:** the big picture, and the one or two decisions that shape everything else.
- **Component notes:** contracts, invariants and gotchas, part by part.
- **Extending / embedding:** what someone building on top must provide.
- **Build, run, package:** a command table.
- **Testing:** a pointer to TESTING.md.
- **Known limitations (accepted):** always last.

Decisions are written down with their reasons. A decision without a why gets "fixed" by the next person, who doesn't know it was deliberate. Where it applies, also write what would reopen it: "No subclasses yet. Add one the first time a caller needs to branch on it."

**Known limitations (accepted)** holds what we know about and have decided to live with. Each bullet says what the limitation is, why we live with it (harmless today, or not worth the cost), what would make it matter, and, for judgment calls, who decided. Quoting them is fine. If the acceptance has a boundary, state it as a rule ("X must accept at least everything Y accepts") and test exactly that rule, nothing more.

### `PROBLEMS.md`: what we want to fix
Known issues we **want to solve**: bugs, drift between copies of a fact, gaps in tooling or tests. It tracks issues, not ideas: a missing feature belongs here only if its absence is a problem we intend to fix.

Entries are grouped under `##` headings by area, with a standing "Single source of truth" section for copies of facts that can't be removed yet. An entry:

```markdown
N. **What is wrong, in one sentence.** The detail: input, what happens, what should happen, how far the damage spreads.
   - **Seen in the wild:** where it actually bit someone.
   - **Workaround:** what to do until it's fixed.
   - **Intended fix:** the plan, or the options and the one we lean towards.
   - **Accused by:** the failing tests that reproduce it.
```

Only the first line is required. Add the rest as they become known, but have an intended fix agreed before starting on anything non-trivial.
- **Numbers are handles.** People say "fix #3", and commits, plans and tests cite them, so a number is never changed or reused. Entries are ordered by section, so numbers can appear out of order. The intro line keeps the next free number.
- **Fixed means deleted.** There's no "fixed" list; git history is the archive. Fixing an entry also means updating the documents that describe the new behavior.
- **Moving out.** An entry we decide to live with moves to DEVELOPMENT.md's accepted limitations, in the same change. One that turns out not to be a problem is deleted.

### `TESTING.md`: how we verify
For anyone writing or running tests. It holds the testing philosophy, the layers (what each touches, what it's for, its tooling, and whether it exists yet), the regression policy, and the conventions: layout, naming, shared helpers, commands. The template below carries the general rules; the project's copy makes them concrete.

### `METHODOLOGY.md`: this file
Owns the document set, the rules that connect the documents, and the development loop. A change to how we work is a decision like any other: make it here, with its reason.

### Optional companions
- **`README.md`** at the root is the front door: a few lines on what the project is and how to start, then links into `docs/`. It doesn't duplicate the user manual.
- **An AI assistant instruction file** (`CLAUDE.md`, `AGENTS.md` or similar) tells the assistant to read this file first. Project knowledge stays in `docs/`, so people and assistants read the same truth.

## Rules that connect the documents

### One home per fact
Every fact (a syntax rule, a keyword list, a version, a command) has exactly one owner.
- **In code,** the owner is a single definition that everything else imports or generates from: for example, an identifier pattern defined by the tokenizer and imported by the syntax highlighter and the tests.
- **In docs,** one document states the fact and the others link to it. When content moves between documents, leave a pointer where it was.
- **Copies that can't be removed yet are problems.** List them in PROBLEMS.md under "Single source of truth", saying where each copy lives.
- **After centralizing a fact, scan for its other copies**: code, config, generated files, tests and docs. Fix what's in scope and record the rest.
- **Compatible isn't identical.** When two things only need to agree in one direction, a written contract can replace shared code. State it as an accepted limitation ("the runtime conversion accepts at least everything the literal syntax accepts") and test the contract.

### Every known issue is triaged
A known issue gets exactly one outcome:

| Outcome | Meaning | Where it goes |
|---|---|---|
| Problem | we want it solved | PROBLEMS.md |
| Accepted | we live with it, for a stated reason | DEVELOPMENT.md, Known limitations (accepted) |
| Not an issue | intended behavior, or just something that happened | nowhere; if people could trip over the behavior, document it |

Triage is the maintainer's call. Whoever finds an issue, person or assistant, presents it with a recommendation. Decisions can change: moving an entry between PROBLEMS.md and the accepted limitations is one change that edits both.

### Docs move with the code
A change isn't done until every document describing it is true again, in the same commit or PR:
- user-visible behavior → the user manual
- internals or decisions → DEVELOPMENT.md
- a problem found → a new entry; a problem fixed → its entry deleted
- test structure, helpers or commands → TESTING.md
- a rename → search every document for the old name

### Decisions carry their reasons
Every non-obvious decision is written next to what it governs (DEVELOPMENT.md for code, TESTING.md for tests, this file for process), with its reason and, where there is one, the tripwire that would reopen it. A ruling made in a conversation goes into its document before the conversation moves on.

### Structure follows need
Don't build structure before something needs it: no new error class until a caller branches on it, no second helper file until the first one hurts, no new document until a topic outgrows its section. Write the threshold down ("reconsider when it reaches the high hundreds of lines") so growing later is an easy call. The five documents are the baseline; when a topic outgrows its section and gets its own file, the old section becomes a pointer.

## The development loop
How a change flows through the documents. Small, obvious changes skip steps, but the order holds.

1. **Notice.** A symptom, a failing test, a scan, a review, a user report. Pin it down: input, what happens, what should happen.
2. **Triage.** Problem, accepted, or not an issue. Finding a bug while doing something else is not a license to fix it on the spot: record it, accuse it, and ask.
3. **Record.** Write the PROBLEMS.md entry or the accepted bullet. Skip this only when the fix lands in the same change.
4. **Accuse.** Write a test that reproduces it, at the lowest layer that can, and watch it fail for the right reason. Name the tests under "Accused by". If the fix is far off, mark them as expected failures that cite the entry, so the suite stays green and the fix forces the marker off.
5. **Plan.** For anything non-trivial, write the intended fix into the entry and agree on it before coding. A plan names the code change, the documents it will update, what is deliberately out of scope, and how it will be verified.
6. **Fix.** Make the accusing tests pass without breaking the others.
7. **Prove it.** Undo the fix, or break the code another way, and watch the tests fail again. Then restore. A test that passes with and without the fix proves nothing.
8. **Clean up.** Delete the entry, update the documents that describe the new behavior, and triage anything new you found along the way.

### Scans
Besides reacting, sweep for drift now and then, and always after centralizing or renaming something: copies of facts, documents describing things that changed, scripts and commands pointing at paths that no longer exist, tests that can't fail. Findings go through triage like anything else.

### Locked-in behavior
Tests pin behavior. When a test would pin something nobody decided, like an odd escape rule or a side effect, surface it instead of enshrining it. It's intended (document it), a problem, or accepted.

## Working with AI assistants
- Point the assistant's instruction file at this file. The assistant follows the same rules as everyone else.
- An assistant's own memory is the wrong place for project knowledge: it may not carry over to the next session or machine, and nobody else can read it. Rulings go into `docs/`.
- Assistants surface, maintainers decide. Scans, locked-in behavior and triage proposals come back as findings with a recommendation.
- Whatever an assistant writes into `docs/` follows the same shape and rules as everything else.

## Bootstrapping a project
1. Create `docs/` and put this file in it.
2. Create the other four documents from the templates below, replacing `<PROJECT>`. Leave sections empty rather than inventing content, and mark what doesn't exist yet as planned.
3. Seed PROBLEMS.md with the gaps you already know about. "No tests yet" is a fine first entry.
4. If you use them, add a `README.md` front door and an assistant instruction file, both pointing here.
5. From then on, follow the loop. The documents grow out of real changes.

### Template: `<PROJECT>.md`
```markdown
# <PROJECT> - Manual

## What is it?
<What it does, and for whom.>

## Getting started
<How to install and run it.>

## <One section per feature area>
<What users can rely on, stated as promises.>

## Errors
<What users can get wrong, and what they will see.>

## Reference
<Built-ins, options, file formats.>
```

### Template: `DEVELOPMENT.md`
```markdown
# <PROJECT> - Development Guide

For people working on <PROJECT> itself, or building on top of it. How to use it is in [<PROJECT>.md](<PROJECT>.md); how we work is in [METHODOLOGY.md](METHODOLOGY.md).

## Repository layout
| Path | Purpose |
|---|---|

## Architecture
<The big picture, and the decisions that shape everything else, with their reasons.>

## Build, run, package
| Command | What it does |
|---|---|

## Testing
See [TESTING.md](TESTING.md) for the test layers, how to run them and the rules for adding tests.

## Known limitations (accepted)
Things we know about and have decided to live with. Issues we want to fix are tracked in [PROBLEMS.md](PROBLEMS.md).
```

### Template: `PROBLEMS.md`
```markdown
# <PROJECT> - Known Problems

Known issues we **want to solve**. Limitations we have decided to accept live in [DEVELOPMENT.md](DEVELOPMENT.md#known-limitations-accepted). When a problem is fixed, delete its entry. Numbers are never reused; the next one is **#1**.

## Single source of truth
Places that keep their own copy of a fact owned elsewhere.
```

### Template: `TESTING.md`
```markdown
# <PROJECT> - Testing

How we test <PROJECT>, and why. For how the code is organized see [DEVELOPMENT.md](DEVELOPMENT.md); for known bugs see [PROBLEMS.md](PROBLEMS.md).

## Philosophy
- **Tests are how we trust the code, so they must be trustworthy.** A test that can't fail is worth nothing. See every test fail for the right reason at least once. To check that a whole suite can fail, plant a canary (a case you know is wrong), watch the suite go red, then remove it.
- **Layers are defined by dependencies, not by size.** "Small" is arguable; what a test touches is not. A test belongs to the lowest layer that has everything it needs.
- **Many unit tests, fewer system tests, few integration tests.** Lower layers are faster and point straight at the broken thing; higher layers catch the wiring.
- **Errors matter as much as successes.** Every rule that rejects something needs a test proving it's rejected, with the right kind of error.
- **Pin contracts, not accidents.** Test what the manual promises and what decisions require. Ask before pinning anything nobody decided.
- **No bug fix without a test that failed first.**

## The layers
| Layer | Touches | Typical subjects | Tooling | Status |
|---|---|---|---|---|
| Manual | whatever is quickest to poke | ad-hoc case tables with readable output, for breaking things fast and debugging new symptoms; still exits non-zero on a wrong result | | planned |
| Unit | one thing: no collaborators, no I/O | | | planned |
| System | real collaborators in-process; no filesystem or network | | | planned |
| Integration | the whole thing, with real files | golden files: an input tree and its exact expected output | | planned |

## Regression tests
Regression is not a layer, it's a purpose. When we find a bug, we add a test at whichever layer reproduces it most directly. It fails before the fix and passes after.
- Put it in its natural layer, not in a separate `regression/` folder.
- Name it after what went wrong, and cite the PROBLEMS.md entry number. While the bug is open, the entry names the test under "Accused by".
- Edge cases we merely discover (not bugs) get tests the same way.

## Conventions
- **Layout:** <one folder per layer>
- **Framework and commands:** <…>
- **Helpers:** all shared test utilities go in one file until it hurts. Write down when to reconsider.
- **Determinism:** tests don't depend on the clock, the working directory or the machine.
```
