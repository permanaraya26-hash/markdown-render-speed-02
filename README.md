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

Practice set: **720/720 cases byte-identical to marked 18.1.3**
(all 680 spec examples and all 40 generated documents pass).
Runs the full practice set in ~1 s, faster than marked itself (~4 s).

Round-7 fixes (this session): fenced-code blank lines in backtick
fences lose up to `fenceIndent` columns like content lines (doc-13);
the `emStrong` mask pre-pass replicates marked's `#n` hook with its
own rule regexes, so delimiters inside links, code spans and HTML
stay literal (doc-09, doc-16, doc-28, doc-35); emphasis is resolved
with marked's opener-driven emStrong algorithm — the `m`/`f`/`y`
scan, rule of 3, `bAdj` truncation and `use` parity, leftovers
inside the wrapper and closer excess outside (doc-11); `~~` del
resolves inside emphasis spans as well as at the top level.
