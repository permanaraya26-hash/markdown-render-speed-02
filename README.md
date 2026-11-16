# markdown-render-speed-02

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/permanaraya26-hash/markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/permanaraya26-hash/markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A dependency-free, hand-written Markdown parser (`parse.js`, ES module)
whose `parse(markdown)` returns exactly what
[marked 18.1.3](https://github.com/markedjs/marked) returns with default
options (GFM on, breaks off, pedantic off). `main.ts` reads
`/input/cases.json` and writes `/output/html.json`.

## Layout

- `parse.js` — the parser: CommonMark 0.31.2 + GFM 0.29 (tables, task
  lists, strikethrough, autolinks). No dependencies, deterministic.
- `main.ts` — the driver: reads cases, renders each alone, writes the
  HTML array.
- `LICENSE` — MIT.

## Run locally

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./practice/output \
  node main.ts
```

## Status

Practice set: **720/720 cases byte-identical to marked 18.1.3**
(all 680 spec examples + all 40 generated documents pass).
Runs the full practice set in ~0.9 s, faster than marked itself (~4 s).

Round-5 fixes (this session, re-derived under a fresh recording
after the 714 checkpoint): blank lines inside backtick fenced code
blocks are dedented by up to `fenceIndent` like content lines (a
tab partially consumed by the dedent is dropped whole); marked's
`emStrong` mask pre-pass hides link / code-span / HTML constructs
from emphasis (delimiters the mask replaces stay literal); emphasis
is now resolved with marked's opener-driven scan (each opener
searches forward with the `m`/`f`/`y` accounting, rule of 3 and `R`
flag; `use` = `min(k, bAdj) % 2` parity; an opener's leftover
delimiters move inside the wrapper and are re-parsed, a closer's
excess stays outside; a failed opener retries as a shorter run;
a single `*` inside a `__...__` span -- or `_` inside `**...**` --
at the scan start is hidden by the closer regex's first alternative).

Round-3 fixes (earlier session): fenced-code absorb in list items now
requires a non-blank line already in the fence; tilde fences keep
their content indent; a marker-less blank line ends a blockquote even
when its tip is a fence; extended-autolink end uses marked's
`_backpedal`; link labels use marked's code-span rule (a backtick run
with no closer fails the label); delimiters inside a failed link
label stay literal; a `www.` autolink keeps a trailing backslash; a
table-candidate paragraph is not turned into a setext heading; a bare
`>` line closes a nested blockquote instead of lazily continuing the
paragraph; a `**` opener closed by `***` after an inner `*` em keeps
the extra star inside the strong.
