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
Runs the full practice set in ~1–2 s, faster than marked itself (~4 s).

Round-4 fixes (this session): implemented marked's `#n` emStrong mask
pre-pass (`blockSkip` + `anyPunctuationOutsideCode`, verified
byte-identical on all 5,956 delimiter-bearing paragraphs); blank
lines inside backtick fenced code are dedented by `fenceIndent`;
replaced the closer-driven emphasis pass with marked's opener-driven
emStrong (`m`/`f` accounting, rule of 3, `min(k,bAdj) % 2` use rule);
leftover delimiters move inside the wrapper and are re-lexed there,
while a closer run is truncated to `bAdj` and its excess stays
outside the match. The doc-30 `***` extra-star case is subsumed by
the leftover-inside mechanism.
