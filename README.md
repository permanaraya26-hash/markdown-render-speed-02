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

Practice set: **719/720 cases byte-identical to marked 18.1.3**
(all 680 spec examples pass; 1 generated document still differs:
doc-11 — the opener-driven emStrong rewrite, left for the next
stage). Runs the full practice set in ~1 s, faster than marked
itself (~4 s).

Stage 1 fixes (this session, recording 01a1e54a): fenced-code
blank lines are dedented like content lines in backtick fences
(doc-13); marked's `#n` emStrong mask pre-pass is implemented
verbatim from the live Lexer rules (doc-09/16/28/35); the
character helpers, entity readers and `escapeHtml`/`cleanUrl` were
rewritten around a shared run scanner and range tables; `main.ts`
now factors out `loadCases`/`renderAll`, tolerates a
`{cases: [...]}` wrapper, validates each render, writes atomically
via temp+rename, and reports the case count and elapsed time.
