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
(all 680 spec examples and all 40 generated documents pass).
Runs the full practice set in ~1.4 s, faster than marked itself (~4 s).

Stage 3 (final rewrite stage, this session, recording 01a1e579):
the inline parser, renderers, table/unicode, tag scanner and block
matchers were rewritten in a new structure while keeping 720/720:
`parseInlineNodes` is now a dispatch over per-character handler
functions (`scanNewline`, `scanBackslash`, `scanCodeSpan`,
`scanEntity`, `scanLt`, `scanBracket`, `scanDelimRun`,
`scanExtended`) with a shared `feed` buffer and a `plainSuffixOf`
/ `dropDelimNode` local-part remover; the autolink family was split
into `schemeAutolink` / `wwwAutolink` / `validEmailDomain` /
`emailLocalStart` and the link family into `tryInlineLink` /
`tryReferenceLink` / `tryShortcutLink` with a shared `walkRange`
node walker; `scanTag` uses `skipWs` / `nameEnd` scanners;
`splitTableRow` uses `unescapeCodeSpanPipes`; the unicode space
test uses a singleton set + range table; `parseInlineHtml` was
split into `scanHtmlComment` / `scanHtmlCdata` /
`scanHtmlDeclaration` / `scanHtmlPI`; the renderers use an
if-chain `renderInlineNode` plus `splitCheckbox` and
`renderTableCells`; the block matchers share `skipIndent` /
`countRun`; the flanking helpers share `firstCpOf` and
`nodeEdgeCp`. One bug was found and fixed along the way: the
local-part remover concatenated the pending buffer before the
node suffix, but the buffer is the end of the output (gfm-632
email autolinks failed until the order was corrected). Score
stayed **720/720** throughout; `main.ts` run twice gives a
byte-identical `html.json` (4,042,837 bytes).

Stage 2 (restart) fixes (recording 01a1e55e): the
opener-driven emStrong rewrite (Stage C) is done — `processEmphasis`
for `*`/`_` now follows marked's algorithm (`findEmStrongCloser`
with `m`/`f`/`y`/`R`, `bAdj`/`use` parity, leftover-inside wrapper,
closer-excess-outside, failed-opener retry as a shorter run, RDelim
first-alternative skip). `~` (del) stays closer-driven and runs
after `*`/`_` and inside every emphasis span. Three bugs were found
and fixed along the way: the gate's punctuation test also matches
whitespace (so `u`/`h` use space-or-punct); leftover delimiter nodes
must be placed into the node list before the inner recursion so it
can pair them; and leftover flanking must be recomputed from the
inner context (neighbouring nodes), not the masked text. Score went
719 → 653 (during the rewrite) → 664 → 691 → **720/720**.

Stage 1 fixes (recording 01a1e54a): fenced-code
blank lines are dedented like content lines in backtick fences
(doc-13); marked's `#n` emStrong mask pre-pass is implemented
verbatim from the live Lexer rules (doc-09/16/28/35); the
character helpers, entity readers and `escapeHtml`/`cleanUrl` were
rewritten around a shared run scanner and range tables; `main.ts`
now factors out `loadCases`/`renderAll`, tolerates a
`{cases: [...]}` wrapper, validates each render, writes atomically
via temp+rename, and reports the case count and elapsed time.
