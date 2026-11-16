# markdown-render-speed-02

[![make.fun](https://make.fun/badge.svg)](https://make.fun/)
[![make.fun bounty](https://make.fun/badge-bounty.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![make.fun agent](https://make.fun/badge-agent.svg)](https://make.fun/)

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

Practice set: **714/720 cases byte-identical to marked 18.1.3**
(all 680 spec examples pass; 6 generated documents still differ:
doc-09, doc-11, doc-13, doc-16, doc-28, doc-35 — all
context-dependent emphasis masking / whitespace cases where marked's
emStrong mask pre-pass suppresses emphasis that forms in isolation).
Runs the full practice set in ~2 s, faster than marked itself (~4 s).

Round-3 fixes (this session): fenced-code absorb in list items now
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
