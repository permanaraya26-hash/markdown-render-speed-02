// parse.js — dependency-free CommonMark 0.31.2 + GFM 0.29 parser,
// byte-compatible with marked 18.1.3 (default options: GFM on,
// breaks off, pedantic off, async off). No dependencies, no network,
// deterministic, no caching across cases, no input recognition.

/* ------------------------------------------------------------------ */
/* Small character tests                                               */
/* ------------------------------------------------------------------ */

// ASCII punctuation: the four ranges !-/  :-@  [-`  {-~.
function isAsciiPunct(c) {
  if (c >= 33 && c <= 47) return true;
  if (c >= 58 && c <= 64) return true;
  if (c >= 91 && c <= 96) return true;
  return c >= 123 && c <= 126;
}

function isDigit(c) {
  return c >= 48 && c <= 57;
}

function isHex(c) {
  if (c >= 48 && c <= 57) return true;
  if (c >= 65 && c <= 70) return true;
  return c >= 97 && c <= 102;
}

function hexVal(c) {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  return c - 87;
}

// A word character for entity names and identifiers: letters, digits,
// underscore.
function isWordChar(c) {
  if (c >= 48 && c <= 57) return true;
  if (c >= 65 && c <= 90) return true;
  if (c >= 97 && c <= 122) return true;
  return c === 95;
}

/* ------------------------------------------------------------------ */
/* Entities and HTML escaping                                          */
/* ------------------------------------------------------------------ */

// True when the text at s[i] (which must be '&') starts something
// that looks like an entity reference. Named entities are &word;.
// Numeric ones are &# followed by 1-7 decimal digits, or &#x / &#X
// followed by 1-6 hex digits, each closed by ';'.
function looksLikeEntity(s, i) {
  const n = s.length;
  let p = i + 1;
  if (p < n && s.charCodeAt(p) === 35) {
    p++;
    if (p < n && (s.charCodeAt(p) === 120 || s.charCodeAt(p) === 88)) {
      p++;
      let count = 0;
      while (p < n && isHex(s.charCodeAt(p))) { p++; count++; }
      return count >= 1 && count <= 6 && p < n && s.charCodeAt(p) === 59;
    }
    let count = 0;
    while (p < n && isDigit(s.charCodeAt(p))) { p++; count++; }
    return count >= 1 && count <= 7 && p < n && s.charCodeAt(p) === 59;
  }
  let count = 0;
  while (p < n && isWordChar(s.charCodeAt(p))) { p++; count++; }
  return count >= 1 && p < n && s.charCodeAt(p) === 59;
}

// How long a named entity (&word;) starting at i is, or 0 when the
// text there is not one.
function matchNamedEntity(s, i) {
  const n = s.length;
  let p = i + 1;
  let count = 0;
  while (p < n && isWordChar(s.charCodeAt(p))) { p++; count++; }
  if (count >= 1 && p < n && s.charCodeAt(p) === 59) return p + 1 - i;
  return 0;
}

// Decode a numeric entity (&#...; or &#x...;) starting at i.
// Returns {ch, len} or null. A code point of 0, above the Unicode
// maximum, or inside the surrogate range becomes U+FFFD.
function decodeNumericEntity(s, i) {
  const n = s.length;
  if (i + 1 >= n || s.charCodeAt(i + 1) !== 35) return null;
  let p = i + 2;
  let cp = 0;
  if (p < n && (s.charCodeAt(p) === 120 || s.charCodeAt(p) === 88)) {
    p++;
    let count = 0;
    while (p < n && isHex(s.charCodeAt(p))) {
      cp = cp * 16 + hexVal(s.charCodeAt(p));
      p++;
      count++;
    }
    if (count < 1 || count > 6 || p >= n || s.charCodeAt(p) !== 59) return null;
  } else {
    let count = 0;
    while (p < n && isDigit(s.charCodeAt(p))) {
      cp = cp * 10 + (s.charCodeAt(p) - 48);
      p++;
      count++;
    }
    if (count < 1 || count > 7 || p >= n || s.charCodeAt(p) !== 59) return null;
  }
  if (cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) cp = 0xFFFD;
  return { ch: String.fromCodePoint(cp), len: p + 1 - i };
}

// Escape the five HTML special characters. When encode is false, an
// '&' that begins a plausible entity reference is left as-is.
function escapeHtml(s, encode) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 38) {
      if (!encode && looksLikeEntity(s, i)) { out += '&'; continue; }
      out += '&amp;';
      continue;
    }
    if (c === 60) { out += '&lt;'; continue; }
    if (c === 62) { out += '&gt;'; continue; }
    if (c === 34) { out += '&quot;'; continue; }
    if (c === 39) { out += '&#39;'; continue; }
    out += s.charAt(i);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Link destinations, titles and labels                                */
/* ------------------------------------------------------------------ */

// Clean a URL for output: encodeURI, then restore any %25 to a bare
// '%' so a literal percent and an already-encoded %XX both survive.
function cleanUrl(u) {
  try {
    return encodeURI(u).replace(/%25/g, '%');
  } catch (e) {
    return u;
  }
}

// Read a link destination starting at s[i]. Returns {dest, end} or
// null. The destination is backslash-decoded and then cleaned.
function parseLinkDestination(s, i) {
  const n = s.length;
  if (i < n && s.charCodeAt(i) === 60) {
    // The <...> form: it may hold a '<', but no newline, and '\x'
    // escapes are processed.
    let p = i + 1;
    let out = '';
    while (p < n) {
      const c = s.charCodeAt(p);
      if (c === 10) return null;
      if (c === 62) return { dest: cleanUrl(out), end: p + 1 };
      if (c === 92 && p + 1 < n && isAsciiPunct(s.charCodeAt(p + 1))) {
        out += s.charAt(p + 1);
        p += 2;
        continue;
      }
      out += s.charAt(p);
      p++;
    }
    return null;
  }
  let p = i;
  let depth = 0;
  let out = '';
  while (p < n) {
    const c = s.charCodeAt(p);
    if (c === 32 || c === 10) break;
    if (c === 92 && p + 1 < n && isAsciiPunct(s.charCodeAt(p + 1))) {
      out += s.charAt(p + 1);
      p += 2;
      continue;
    }
    if (c === 40) { depth++; out += '('; p++; continue; }
    if (c === 41) {
      if (depth === 0) break;
      depth--;
      out += ')';
      p++;
      continue;
    }
    out += s.charAt(p);
    p++;
  }
  if (p === i) return null;
  return { dest: cleanUrl(out), end: p };
}

// Skip spaces, tabs and single newlines. Returns the new index, or
// -1 when a blank line (two newlines) intervenes.
function skipInlineSpace(s, i) {
  const n = s.length;
  let p = i;
  while (p < n) {
    const c = s.charCodeAt(p);
    if (c === 32 || c === 9) { p++; continue; }
    if (c === 10) {
      if (p + 1 < n && s.charCodeAt(p + 1) === 10) return -1;
      p++;
      continue;
    }
    break;
  }
  return p;
}

// Read a link title starting at s[i] ('"' or '\'' or '(').
// Returns {title, end} or null.
function parseLinkTitle(s, i) {
  const n = s.length;
  if (i >= n) return null;
  const q = s.charCodeAt(i);
  let close;
  if (q === 34) close = 34;
  else if (q === 39) close = 39;
  else if (q === 40) close = 41;
  else return null;
  let p = i + 1;
  let out = '';
  while (p < n) {
    const c = s.charCodeAt(p);
    if (c === close) return { title: out, end: p + 1 };
    if (c === 92 && p + 1 < n && isAsciiPunct(s.charCodeAt(p + 1))) {
      out += s.charAt(p + 1);
      p += 2;
      continue;
    }
    if (c === 10 && p + 1 < n && s.charCodeAt(p + 1) === 10) return null;
    out += s.charAt(p);
    p++;
  }
  return null;
}

// Read the tail of an inline link: s[i] must be '('.
// Returns {dest, title, end} or null.
function parseInlineLinkTail(s, i) {
  const n = s.length;
  let p = skipInlineSpace(s, i + 1);
  if (p === -1) return null;
  // An empty destination: '(' immediately followed by ')'.
  if (p < n && s.charCodeAt(p) === 41) return { dest: '', title: null, end: p + 1 };
  const d = parseLinkDestination(s, p);
  if (!d) return null;
  p = d.end;
  let title = null;
  const k = skipInlineSpace(s, p);
  if (k === -1) return null;
  if (k < n && (s.charCodeAt(k) === 34 || s.charCodeAt(k) === 39 || s.charCodeAt(k) === 40)) {
    const t = parseLinkTitle(s, k);
    if (!t) return null;
    title = t.title;
    const m = skipInlineSpace(s, t.end);
    if (m === -1) return null;
    p = m;
  } else {
    p = k;
  }
  if (p >= n || s.charCodeAt(p) !== 41) return null;
  return { dest: d.dest, title, end: p + 1 };
}

// Find the next backtick run (any length >= 1) at or after `start`,
// but stop (return -1) at a newline: marked's label regex matches a
// code span as run + content-with-no-backticks + run, so the closer
// is the FIRST later backtick run, of any length (the runs need not
// match — `` `` a ` `` closes at the single backtick). A run in a
// later line does not close a span in the label, so the label's ']'
// still closes it (cm-342/525/537).
function findCodeSpanCloseLabel(s, start) {
  const n = s.length;
  let p = start;
  while (p < n) {
    const c = s.charCodeAt(p);
    if (c === 10) return -1;
    if (c === 92) { p += 2; continue; }
    if (c === 96) return p;
    p++;
  }
  return -1;
}

// Read a link label starting at text[i] === '['. Returns {text, end}
// or null. A label may not contain a blank line or an unmatched '['.
function parseLinkLabel(text, i) {
  const n = text.length;
  if (text.charCodeAt(i) !== 91) return null;
  let depth = 0;
  let p = i;
  let start = -1;
  while (p < n) {
    const c = text.charCodeAt(p);
    if (c === 92) { p += 2; continue; }
    if (c === 96) {
      let run = 0;
      while (p + run < n && text.charCodeAt(p + run) === 96) run++;
      // marked's label regex matches a code span as run + content
      // with NO backticks + a run of ANY length (`` `` a ` `` closes
      // at the single backtick). If no later backtick run exists on
      // this line, the label cannot span the run — the link does not
      // form (doc-16/18/20/28; a stray backtick is not literal text
      // in a label). Exception: a run of 2+ backticks immediately
      // before the closing ']' (the ``+(?=]) alternative) still
      // lets the label close.
      const close = findCodeSpanCloseLabel(text, p + run);
      if (close === -1) {
        if (run >= 2 && p + run < n && text.charCodeAt(p + run) === 93) {
          p += run;
          continue;
        }
        return null;
      }
      let closeRun = 0;
      while (close + closeRun < n && text.charCodeAt(close + closeRun) === 96) closeRun++;
      p = close + closeRun;
      continue;
    }
    // An inline tag spans through its '>', so a ']' inside a tag
    // (e.g. in a quoted attribute) does not close the label (cm-524).
    // An autolink <...> likewise spans through its '>', so a ']' inside
    // it does not close the label (cm-526/538).
    if (c === 60) {
      const tagEnd = scanTag(text, p);
      if (tagEnd !== -1) { p = tagEnd; continue; }
      const html = parseInlineHtml(text, p);
      if (html) { p = html.end; continue; }
      const auto = tryAutolink(text, p);
      if (auto) { p = auto.end; continue; }
    }
    if (c === 91) {
      if (depth === 0) start = p + 1;
      depth++;
      p++;
      continue;
    }
    if (c === 93) {
      depth--;
      if (depth === 0) {
        const label = text.slice(start, p);
        // A label may span lines but may not contain a blank line
        // (cm-208: [\nfoo\n] is valid; a blank line inside is not).
        const trimmed = label.replace(/^[ \t\n]+/, '').replace(/[ \t\n]+$/, '');
        if (/\n[ \t]*\n/.test(trimmed)) return null;
        return { text: label, end: p + 1 };
      }
      if (depth < 0) return null;
      p++;
      continue;
    }
    p++;
  }
  return null;
}

// Normalise a link label for reference lookup: trim, collapse internal
// whitespace to single spaces, lowercase.
function normalizeLabel(s) {
  // Unicode case folding: toLowerCase handles most cases, but ß/ẞ
  // fold to 'ss' and the Latin ligatures fold to their expansions
  // (cm-540: [ẞ] matches [SS]).
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
    .replace(/\u00df/g, 'ss')
    .replace(/\ufb00/g, 'ff').replace(/\ufb01/g, 'fi').replace(/\ufb02/g, 'fl')
    .replace(/\ufb03/g, 'ffi').replace(/\ufb04/g, 'ffl')
    .replace(/\ufb05/g, 'st').replace(/\ufb06/g, 'st');
}

// True when s contains an unescaped '[' or ']' (a backslash-escaped
// bracket does not count). Used to reject reference labels with
// nested brackets.
function hasUnescapedBracket(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 92) { i++; continue; }
    if (c === 91 || c === 93) return true;
  }
  return false;
}

// Find the next run of exactly `run` backticks at or after `start`.
// Returns the index of the run, or -1.
function findCodeSpanClose(s, start, run) {
  const n = s.length;
  let p = start;
  while (p < n) {
    if (s.charCodeAt(p) === 96) {
      let r = 0;
      while (p + r < n && s.charCodeAt(p + r) === 96) r++;
      if (r === run) return p;
      p += r;
    } else {
      p++;
    }
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/* HTML tag scanning                                                   */
/* ------------------------------------------------------------------ */

// Block-level HTML tag names (CommonMark spec list).
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body',
  'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir',
  'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header',
  'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem',
  'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'section',
  'source', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'title', 'tr', 'track', 'ul',
]);

// Scan one HTML tag starting at s[i] === '<'. Returns the index just
// past the closing '>' (or '/>'), or -1 when the tag is not
// complete/valid.
function scanTag(s, i) {
  const n = s.length;
  let p = i + 1;
  const closing = p < n && s.charCodeAt(p) === 47;
  if (closing) p++; // '/'
  const nameStart = p;
  // The tag name must start with a letter (cm-618: <33>, <__> are not
  // tags).
  if (p < n) {
    const c0 = s.charCodeAt(p);
    if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return -1;
  }
  while (p < n) {
    const c = s.charCodeAt(p);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45) p++;
    else break;
  }
  if (p === nameStart) return -1;
  // After the tag name, whitespace, '>' or '/' must follow; a ':' or
  // '.' directly after the name (cm-609 <m:abc>, cm-610 <foo.bar.baz>)
  // is not a valid tag.
  if (p < n) {
    const c = s.charCodeAt(p);
    if (c !== 32 && c !== 9 && c !== 10 && c !== 62 && c !== 47) return -1;
  }
  // A closing tag takes no attributes (cm-624: </a href="foo"> is not
  // a tag).
  if (closing) {
    while (p < n && (s.charCodeAt(p) === 32 || s.charCodeAt(p) === 9 || s.charCodeAt(p) === 10)) p++;
    if (p < n && s.charCodeAt(p) === 62) return p + 1;
    return -1;
  }
  for (;;) {
    while (p < n && (s.charCodeAt(p) === 32 || s.charCodeAt(p) === 9 || s.charCodeAt(p) === 10)) p++;
    if (p >= n) return -1;
    const c = s.charCodeAt(p);
    if (c === 62) return p + 1; // '>'
    if (c === 47) {
      // '/' must be immediately followed by '>' (<bar/ > is not a tag)
      if (p + 1 < n && s.charCodeAt(p + 1) === 62) return p + 2;
      return -1;
    }
    const aStart = p;
    while (p < n) {
      const d = s.charCodeAt(p);
      if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122) || (d >= 48 && d <= 57) ||
        d === 45 || d === 95 || d === 58 || d === 46) p++;
      else break;
    }
    if (p === aStart) return -1;
    while (p < n && (s.charCodeAt(p) === 32 || s.charCodeAt(p) === 9)) p++;
    if (p < n && s.charCodeAt(p) === 61) {
      p++;
      while (p < n && (s.charCodeAt(p) === 32 || s.charCodeAt(p) === 9)) p++;
      if (p >= n) return -1;
      const q = s.charCodeAt(p);
      if (q === 34 || q === 39) {
        p++;
        while (p < n && s.charCodeAt(p) !== q) p++;
        if (p >= n) return -1;
        p++;
      } else {
        const vStart = p;
        while (p < n) {
          const d = s.charCodeAt(p);
          // An unquoted value cannot contain whitespace (space, tab,
          // or newline), '"', "'", '=', '<', '>' or '`'.
          if (d === 32 || d === 9 || d === 10 || d === 34 || d === 39 || d === 61 ||
            d === 60 || d === 62 || d === 96) break;
          p++;
        }
        if (p === vStart) return -1;
      }
      // After a value, whitespace, '>' or '/' must follow before the
      // next attribute (cm-622: <a href='bar'title=title> is not a
      // tag).
      if (p < n) {
        const c2 = s.charCodeAt(p);
        if (c2 !== 32 && c2 !== 9 && c2 !== 10 && c2 !== 62 && c2 !== 47) return -1;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Line — one source line with tab-aware offset/column tracking        */
/* ------------------------------------------------------------------ */

class Line {
  constructor(text, hasNewline) {
    this.s = text;
    this.hasNewline = hasNewline;
    this.pos = 0;         // index into s
    this.col = 0;         // column (tabs expand to the next multiple of 4)
    this.partialTab = 0;  // spaces left of a partially-consumed tab
  }

  // Current character code, or -1 at end of line. A partially-consumed
  // tab reads as a space.
  peek() {
    if (this.partialTab > 0) return 32;
    if (this.pos >= this.s.length) return -1;
    return this.s.charCodeAt(this.pos);
  }

  // True when only spaces/tabs remain on the line.
  isBlank() {
    for (let k = this.pos; k < this.s.length; k++) {
      const c = this.s.charCodeAt(k);
      if (c !== 32 && c !== 9) return false;
    }
    return true;
  }

  // Number of leading whitespace columns from the current position.
  indent() {
    let col = this.col;
    let k = this.pos;
    let partial = this.partialTab;
    while (k < this.s.length) {
      const c = this.s.charCodeAt(k);
      if (c === 32) { col++; k++; }
      else if (c === 9) {
        col += partial > 0 ? partial : 4 - (col % 4);
        k++;
        partial = 0;
      } else break;
    }
    return col - this.col;
  }

  // Advance n columns, consuming tabs (partially when needed).
  advance(n) {
    while (n > 0 && this.pos < this.s.length) {
      const c = this.s.charCodeAt(this.pos);
      if (c === 9) {
        const w = this.partialTab > 0 ? this.partialTab : 4 - (this.col % 4);
        if (w <= n) {
          this.pos++;
          this.col += w;
          this.partialTab = 0;
          n -= w;
        } else {
          this.partialTab = w - n;
          this.col += n;
          n = 0;
        }
      } else {
        this.pos++;
        this.col++;
        n--;
      }
    }
  }

  // The remaining text from the current position, with a partially
  // consumed tab expanded to spaces.
  remaining() {
    if (this.partialTab > 0) {
      return ' '.repeat(this.partialTab) + this.s.slice(this.pos + 1);
    }
    return this.s.slice(this.pos);
  }

  // Expand tabs in the leading whitespace of the remaining text to
  // spaces, each tab advancing to the next multiple of 4 columns from
  // the current column. Call after container matching: marked's
  // list/blockquote stripping expands tabs in the leading whitespace
  // it exposes, so a tab a container uncovers becomes spaces in
  // code-block content (a top-level tab, with no container, stays
  // literal). Rewrites the line in place; pos/col are unchanged
  // (the spaces start at the same column the whitespace did).
  // Expand tabs in the leading whitespace (from the current position)
  // to spaces. startCol is the column the whitespace starts at: by
  // default the line's absolute column, but a blockquote marker passes
  // 1 (its own length) so a tab after the marker expands relative to
  // the marker, as marked's J() does when it strips each quote level.
  expandLeadingTabs(startCol) {
    if (this.partialTab === 0 && !this.s.includes('\t', this.pos)) return;
    const rem = this.remaining();
    let col = startCol !== undefined ? startCol : this.col;
    let i = 0;
    let out = '';
    let expanded = false;
    while (i < rem.length) {
      const c = rem.charCodeAt(i);
      if (c === 32) { out += ' '; col++; i++; }
      else if (c === 9) {
        const w = 4 - (col % 4);
        out += ' '.repeat(w);
        col += w;
        i++;
        expanded = true;
      } else break;
    }
    if (!expanded) return;
    out += rem.slice(i);
    this.s = this.s.slice(0, this.pos) + out;
    this.partialTab = 0;
  }

  save() { return [this.pos, this.col, this.partialTab]; }
  restore(st) { this.pos = st[0]; this.col = st[1]; this.partialTab = st[2]; }

  // Move to the end of the line.
  skipToEnd() {
    this.pos = this.s.length;
    this.partialTab = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Block parsing (CommonMark reference algorithm)                      */
/* ------------------------------------------------------------------ */

function newBlock(type, parent) {
  const b = {
    t: type, parent, children: [],
    literal: '',      // paragraph / heading / code / html text
    level: 0,         // heading level
    fenced: false,    // code block
    fenceChar: '',
    fenceLen: 0,
    fenceIndent: 0,
    info: '',
    closed: false,    // fenced code / html block ended properly
    htmlType: 0,      // html block type 1-7
    htmlTag: '',      // html block type 1: opening element name
    htmlEndedBlank: false,
    bullet: '',       // list: bullet char
    delim: '',        // list: '.' or ')'
    start: 1,         // list: start number
    firstIndent: 0,   // list: indent of the first item's marker
    tight: true,      // list
    markerWidth: 0,   // item
    markerIndent: 0,  // item: marker's indent relative to the container
    contentIndent: 0, // item
    align: null,      // table: array of 'left'|'center'|'right'|null
    headerCells: null,
    rows: null,
    setextLevel: 0,   // paragraph -> setext heading (1 or 2)
    _prevLazyIndent: -1, // indent of the last lazy line added (-1: none)
    _prevLazyDeep: false, // the last lazy line had the extra 4-strip
    _lastLineBlank: false,
    _blankBetween: false,
  };
  if (parent) parent.children.push(b);
  return b;
}

// Determine the HTML block type (1-7) for a string starting with '<'.
// Returns 0 when it is not an HTML block start.
function htmlBlockType(s) {
  if (s.length < 2) return 0;
  if (s.startsWith('<!--')) return 2;
  if (s.startsWith('<?')) return 3;
  if (s.startsWith('<![CDATA[')) return 5;
  if (s.charCodeAt(1) === 33) {
    const c2 = s.charCodeAt(2);
    if ((c2 >= 65 && c2 <= 90) || (c2 >= 97 && c2 <= 122)) return 4;
    return 0;
  }
  let i = 1;
  let closing = false;
  if (s.charCodeAt(i) === 47) { closing = true; i++; }
  const nameStart = i;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45) i++;
    else break;
  }
  if (i === nameStart) return 0;
  const name = s.slice(nameStart, i).toLowerCase();
  const after = i < s.length ? s.charCodeAt(i) : -1;
  if (!closing && (name === 'pre' || name === 'script' || name === 'style' || name === 'textarea')) {
    if (after === -1 || after === 32 || after === 9 || after === 62 || after === 47) return 1;
    return 0;
  }
  if (BLOCK_TAGS.has(name)) {
    if (after === -1 || after === 32 || after === 9 || after === 62 || after === 47) return 6;
    return 0;
  }
  // type 7: a complete open or closing tag alone on the line
  const end = scanTag(s, 0);
  if (end === -1) return 0;
  let p = end;
  while (p < s.length && (s.charCodeAt(p) === 32 || s.charCodeAt(p) === 9)) p++;
  if (p === s.length) return 7;
  return 0;
}

// Match a list item marker at the line's current position.
// Returns {marker, num, delim, markerWidth, spacesAfter, contentIndent,
// indent} or null. `indent` is the leading whitespace before the marker.
function matchListItem(line) {
  const save = line.save();
  const indent = line.indent();
  if (indent > 3) { line.restore(save); return null; }
  line.advance(indent);
  const c = line.peek();
  let marker, num, delim;
  let markerWidth;
  if (c === 45 || c === 43 || c === 42) {
    marker = 'bullet';
    delim = String.fromCharCode(c);
    num = 0;
    markerWidth = 1;
  } else if (isDigit(c)) {
    let p = line.pos;
    let digits = 0;
    while (p < line.s.length && isDigit(line.s.charCodeAt(p)) && digits < 10) { p++; digits++; }
    if (digits === 0 || digits > 9) { line.restore(save); return null; }
    const d = line.s.charCodeAt(p);
    if (d !== 46 && d !== 41) { line.restore(save); return null; }
    num = parseInt(line.s.slice(line.pos, p), 10);
    marker = 'ordered';
    delim = String.fromCharCode(d);
    markerWidth = digits + 1;
  } else {
    line.restore(save);
    return null;
  }
  // whitespace after the marker
  line.advance(markerWidth);
  let spacesAfter = 0;
  let col = line.col;
  while (line.pos < line.s.length) {
    const ch = line.s.charCodeAt(line.pos);
    if (ch === 32) { spacesAfter++; col++; line.pos++; line.col++; }
    else if (ch === 9) {
      const w = line.partialTab > 0 ? line.partialTab : 4 - (col % 4);
      spacesAfter += w;
      col += w;
      line.pos++;
      line.col += w;
      line.partialTab = 0;
    } else break;
  }
  const blank = line.isBlank();
  // a marker must be followed by whitespace (or end the line)
  if (spacesAfter === 0 && !blank) { line.restore(save); return null; }
  let contentIndent;
  if (blank) contentIndent = markerWidth + 1;
  else if (spacesAfter >= 1 && spacesAfter <= 4) contentIndent = markerWidth + spacesAfter;
  else contentIndent = markerWidth + 1;
  line.restore(save);
  return { marker, num, delim, markerWidth, spacesAfter, contentIndent, indent, blank };
}

// Match an ATX heading. Returns the level (1-6) or 0.
function matchAtx(s) {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) === 35) i++;
  if (i === 0 || i > 6) return 0;
  if (i < s.length && s.charCodeAt(i) !== 32 && s.charCodeAt(i) !== 9) return 0;
  return i;
}

// Match a setext heading underline. Returns 1 or 2, or 0.
// The underline must have indent < 4 (columns) and contain only the
// run character ('=' or '-') plus trailing whitespace (no internal
// spaces: '= =' and '--- -' are not setext underlines).
function matchSetext(s) {
  let i = 0;
  let col = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 32) { col++; i++; }
    else if (c === 9) { col += 4 - (col % 4); i++; }
    else break;
  }
  if (col >= 4) return 0;
  if (i >= s.length) return 0;
  const c = s.charCodeAt(i);
  if (c !== 61 && c !== 45) return 0;
  while (i < s.length && s.charCodeAt(i) === c) i++;
  while (i < s.length) {
    const d = s.charCodeAt(i);
    if (d !== 32 && d !== 9) return 0;
    i++;
  }
  return c === 61 ? 1 : 2;
}

// Match a setext-like underline on a LAZY continuation line: a run of
// '=' or '-' with only trailing whitespace. Unlike matchSetext, the
// indent is not limited (a lazy underline keeps its leading whitespace
// subject to the padding rule in addLineToLeaf). Returns
// {level, run, lead, leadWidth} or null. `lead` is the leading
// whitespace text; `leadWidth` its column width.
function matchSetextRun(s) {
  let i = 0;
  let col = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 32) { col++; i++; }
    else if (c === 9) { col += 4 - (col % 4); i++; }
    else break;
  }
  if (i >= s.length) return null;
  const c = s.charCodeAt(i);
  if (c !== 61 && c !== 45) return null;
  const runStart = i;
  while (i < s.length && s.charCodeAt(i) === c) i++;
  const run = s.slice(runStart, i);
  while (i < s.length) {
    const d = s.charCodeAt(i);
    if (d !== 32 && d !== 9) return null;
    i++;
  }
  return { level: c === 61 ? 1 : 2, run, lead: s.slice(0, runStart), leadWidth: col };
}

// Match a thematic break. Returns true/false.
function matchThematicBreak(s) {
  let i = 0;
  let c = -1;
  let count = 0;
  while (i < s.length) {
    const d = s.charCodeAt(i);
    if (d === 32 || d === 9) { i++; continue; }
    if (c === -1) {
      if (d !== 45 && d !== 42 && d !== 95) return false;
      c = d;
    }
    if (d !== c) return false;
    count++;
    i++;
  }
  return count >= 3;
}

// Match a fenced code block start. Returns {char, len, info} or null.
// Backslash escapes in the info string are processed.
function matchFence(s) {
  if (s.length < 3) return null;
  const c = s.charCodeAt(0);
  if (c !== 96 && c !== 126) return null;
  let i = 0;
  while (i < s.length && s.charCodeAt(i) === c) i++;
  if (i < 3) return null;
  let info = s.slice(i).trim();
  if (c === 96 && info.includes('`')) return null;
  if (info.includes('\\')) {
    let out = '';
    for (let k = 0; k < info.length; k++) {
      if (info.charCodeAt(k) === 92 && k + 1 < info.length && isAsciiPunct(info.charCodeAt(k + 1))) {
        out += info.charAt(k + 1);
        k++;
      } else {
        out += info.charAt(k);
      }
    }
    info = out;
  }
  return { char: String.fromCharCode(c), len: i, info };
}

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

class Parser {
  constructor() {
    this.doc = newBlock('document', null);
    this.tip = this.doc;
    this.refs = new Map();
    this.lastLineBlank = false;
    this.line = null;
    this.pendingHtml = null; // html block (type 2-5) awaiting its end line
    this.lazy = false;       // the current line is a lazy continuation
    this.lazyUnmatched = null; // unmatched containers for a lazy line
    this.lazyIndent = 0;     // the lazy line's indent after phase 1
    this.lineBlank = false;  // the current line was blank before phase 1
  }

  parse(src) {
    src = src.replace(/\r\n?/g, '\n');
    const endsNL = src.length > 0 && src.endsWith('\n');
    const raw = src.split('\n');
    if (endsNL) raw.pop();
    for (let i = 0; i < raw.length; i++) {
      const line = new Line(raw[i], i < raw.length - 1 || endsNL);
      this.incorporateLine(line);
    }
    while (this.tip !== this.doc) this.finalize(this.tip);
    return this.doc;
  }

  // Add a child block, tracking blank lines for list looseness.
  addChild(type, parent) {
    const b = newBlock(type, parent);
    // A new block child after a blank line (for this item) makes the
    // list loose; parent._lastLineBlank holds the previous line's
    // blankness for this item.
    if (parent.t === 'item' && parent.children.length > 1 && parent._lastLineBlank) {
      parent._blankBetween = true;
    }
    return b;
  }

  // --- phase 1: descend into open containers -----------------------
  // Try to match the line against an open container block.
  // Returns true when it matches (and advances the line).
  matchContainer(blk) {
    const line = this.line;
    if (blk.t === 'blockquote') {
      // A blank line matches a blockquote only when the open leaf is
      // an html block (which spans blank lines inside the quote); a
      // blank line ends the blockquote (and a fenced code block
      // inside it) even when the fence has content — the fence's
      // content is only lines the quote actually contains, so a
      // marker-less blank line is not code (doc-17: an empty fence
      // after a marker-less blank line; probe 4). An indented code
      // block does NOT keep the quote open across a blank line.
      if (line.isBlank()) {
        return this.tip.t === 'html_block';
      }
      const save = line.save();
      const ind = line.indent();
      if (ind > 3) { line.restore(save); return false; }
      line.advance(ind);
      if (line.peek() === 62) {
        line.advance(1);
        // Expand tabs in the whitespace after the '>' marker relative
        // to the marker (column 1), before consuming the marker's
        // single trailing space: a tab there expands as marked's J()
        // expands it when stripping each quote level, so nested quotes
        // do not over-expand it (a tab after '> > ' becomes 2 spaces,
        // not 4).
        line.expandLeadingTabs(1);
        if (line.peek() === 32) line.advance(1);
        else if (line.peek() === 9) line.advance(1);
        return true;
      }
      line.restore(save);
      return false;
    }
    if (blk.t === 'list') return true;
    if (blk.t === 'item') {
      // A blank line matches an item only when the item already has
      // content; a blank line after an empty item ends the item
      // (cm-280: '-\n\n  foo' leaves an empty item and a top-level
      // paragraph).
      if (line.isBlank()) return blk.children.length > 0;
      // The item's content starts at markerIndent + contentIndent
      // columns past the item's parent content; a line must reach that
      // column to match (an indented marker's content is further in).
      const cs = blk.markerIndent + blk.contentIndent;
      if (line.indent() >= cs) {
        line.advance(cs);
        return true;
      }
      return false;
    }
    return true;
  }

  // Is the line (at its current position) a closing fence for the
  // given fenced code block? Mirrors the check in addLineToLeaf.
  isClosingFence(line, tip) {
    if (line.isBlank()) return false;
    const ind = line.indent();
    if (ind > 3) return false;
    const s = line.remaining().slice(ind);
    const c = s.charCodeAt(0);
    if (c !== tip.fenceChar.charCodeAt(0)) return false;
    let i = 0;
    while (i < s.length && s.charCodeAt(i) === c) i++;
    if (i < tip.fenceLen) return false;
    let j = i;
    while (j < s.length && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) j++;
    return j === s.length;
  }

  // Does the line start a block that may interrupt a paragraph?
  startsInterruptingBlock() {
    const line = this.line;
    const s = line.remaining();
    const ind = line.indent();
    if (ind > 3) return false;
    const t = s.slice(ind);
    if (matchAtx(t)) return true;
    if (matchFence(t)) return true;
    if (t.charCodeAt(0) === 60) {
      const ht = htmlBlockType(t);
      if (ht >= 1 && ht <= 6) return true;
    }
    if (matchThematicBreak(t)) return true;
    if (t.charCodeAt(0) === 62) return true;
    if (matchListItem(line)) return true;
    return false;
  }

  incorporateLine(line) {
    this.line = line;
    this.lazy = false;
    this.lazyUnmatched = null;
    this.lazyIndent = 0;
    // Whether the line was blank before any container matched (a
    // '> ' line is not blank even though nothing may remain after the
    // '>' marker is consumed).
    this.lineBlank = line.isBlank();
    // Build the open chain from the tip up to (not incl.) the document.
    const chain = [];
    let b = this.tip;
    while (b !== this.doc) { chain.unshift(b); b = b.parent; }

    // --- phase 1: descend ---
    let unmatchedFrom = -1;
    let container = this.doc;
    // Items matched on this line, with whether the line was blank for
    // each (used to maintain each item's _lastLineBlank for looseness).
    // A line is blank for an item when, after the item consumes its
    // content indent, nothing remains; a blockquote marker line
    // ('  >') is NOT blank for the item even though nothing remains
    // after the blockquote consumes the '>'.
    const matchedItemBlanks = [];
    for (let idx = 0; idx < chain.length; idx++) {
      const blk = chain[idx];
      if (blk.t === 'blockquote' || blk.t === 'list' || blk.t === 'item') {
        if (this.matchContainer(blk)) {
          container = blk;
          if (blk.t === 'item') {
            matchedItemBlanks.push([blk, line.isBlank() || line.remaining().length === 0]);
          }
          continue;
        }
        // A fenced code block absorbs a line that does not match its
        // list item (marked keeps the block open: a content line at
        // ANY indent is still code — even at column 0, e.g. doc-02
        // line 40 'function f(a, b) {' stays in the css fence). The
        // absorb is narrow: the fence must already hold a non-blank
        // content line (an empty fence stays empty, doc-17/38; a
        // blank line after the opener does not count), the fence must
        // sit directly in the failing item (a fence inside a
        // item fails, cm-237, and a line without the '>' marker is
        // outside the blockquote), and the line must not start a new
        // block (list item, heading, blockquote, fence, html, hr). Only a real closing fence, or a blank line
        // before it, lets the normal close run.
        if (!this.lineBlank && !this.lastLineBlank && blk.t === 'item' &&
            this.tip.t === 'code_block' && this.tip.fenced &&
            /\S/.test(this.tip.literal) &&
            this.tip.parent === blk &&
            !this.isClosingFence(line, this.tip) &&
            !this.startsInterruptingBlock()) {
          break;
        }
        unmatchedFrom = idx;
        break;
      }
      // leaf block (the tip): phase 1 ends here
      container = blk;
      break;
    }

    // A container exposed a tab in the line's leading whitespace:
    // expand it to spaces (marked's list/blockquote stripping does
    // this before the content is re-lexed). Only when a container
    // actually consumed indent (col > 0); a top-level tab stays
    // literal.
    if (line.col > 0) line.expandLeadingTabs();

    // Lazy continuation: a paragraph may keep a line even when a
    // container above it failed to match. `blank` is the pre-phase-1
    // blankness: a '> ' line is not blank (it carries a space of
    // paragraph content).
    const blank = this.lineBlank;
    if (unmatchedFrom !== -1 && !blank && this.tip.t === 'paragraph' &&
        !this.lastLineBlank && !this.startsInterruptingBlock() &&
        line.remaining().length > 0) {
      this.lazy = true;
      // the unmatched containers (outermost to innermost), excluding
      // the leaf paragraph itself
      this.lazyUnmatched = chain.slice(unmatchedFrom, chain.length - 1);
      // the line's indent after the matched containers consumed theirs
      this.lazyIndent = line.indent();
      unmatchedFrom = -1;
    }

    // --- phase 1b: close unmatched blocks ---
    if (unmatchedFrom !== -1) {
      // close from the tip down to (and incl.) chain[unmatchedFrom]
      for (let idx = chain.length - 1; idx >= unmatchedFrom; idx--) {
        if (chain[idx] === this.pendingHtml) this.pendingHtml = null;
        // An html block closed by a container mismatch loses its
        // trailing newline (cm-175: <div> in a list item).
        if (chain[idx].t === 'html_block') chain[idx].htmlEndedBlank = true;
        // An item closed by a blank line ends with a blank line
        // (cm-315: an empty item followed by a blank line makes the
        // list loose).
        if (chain[idx].t === 'item' && blank) chain[idx]._lastLineBlank = true;
        this.finalize(chain[idx]);
      }
      this.tip = chain[unmatchedFrom].parent;
      container = this.tip;
    }

    // Effective blankness: the line is blank for the containers when
    // it was blank before matching, or when nothing remains after the
    // containers matched (a bare '>' line). A '> ' line still carries
    // a space of content, so it is not blank. This drives list
    // looseness (a '>>' line between two paragraphs makes the list
    // loose, cm-259) and html-block trailing-newline handling.
    const effBlank = blank || line.remaining().length === 0;

    // A pending html block (it ended on an earlier line) is finalized
    // when the next line arrives: a blank line strips its trailing
    // newline, a non-blank line keeps it.
    if (this.pendingHtml) {
      const h = this.pendingHtml;
      this.pendingHtml = null;
      if (effBlank) {
        // marked's type 1-5 html regex ends at </tag> + rest-of-line +
        // newlines: a truly empty following line is consumed as a
        // second newline and stripped by ge(), but a spaces-only line
        // stops the newline run, so the single trailing newline is
        // kept (doc-24: </pre> followed by a '   ' line keeps '\n').
        if (line.remaining().length === 0) {
          if (h.literal.endsWith('\n')) h.literal = h.literal.slice(0, -1);
          h.htmlEndedBlank = true;
        }
      }
      this.finalize(h);
    }

    // --- phase 2: open new blocks ---
    const consumed = this.openNewBlocks(effBlank);

    // --- phase 3: add the line to the tip leaf ---
    if (!consumed) {
      this.addLineToLeaf(line);
    }
    this.lastLineBlank = effBlank;
    // Maintain each matched item's _lastLineBlank (the last line
    // processed while it was open) for list looseness.
    for (const [item, b] of matchedItemBlanks) item._lastLineBlank = b;
  }

  // --- phase 2: open new blocks -------------------------------------
  // Returns true when the line was consumed (no phase 3 needed).
  openNewBlocks(blank) {
    const line = this.line;
    let tip = this.tip;

    // A lazy continuation line never opens a new block (it cannot start
    // an interrupting block by construction); phase 3 adds it to the
    // paragraph with the lazy content rules.
    if (this.lazy) return false;

    // A blank line closes a pending html block's trailing newline and
    // marks html blocks that end at a blank line.
    if (blank) {
      // A blank line does not open anything new; the tip stays.
      // (htmlEndedBlank for types 6/7 is set in addLineToLeaf, which
      // finalizes them; types 1-5 continue through blank lines, so
      // they must NOT be marked here.)
      return false;
    }

    // A code or html block tip continues with this line (phase 3 adds
    // it); no new block is opened here. But an indented code block
    // continues only on a non-blank line with indent >= 4 (relative to
    // its container); a line with less indent ends the code block and
    // starts a new block.
    if (tip.t === 'code_block' && !tip.fenced) {
      if (line.indent() < 4) {
        this.finalize(tip);
        tip = this.tip;
        // fall through to open a new block for this line
      } else {
        return false;
      }
    }
    if (tip.t === 'code_block' || tip.t === 'html_block') return false;

    // Setext heading: the tip is a paragraph and the line is an underline.
    // (A lazy line is handled in addLineToLeaf, never here.)
    // Link reference definitions are extracted from the paragraph
    // first (cm-215: [foo]: /url is a def, bar is the heading; cm-216:
    // a paragraph that is only a def has no heading text, so the
    // underline stays literal). A table candidate is NOT a setext
    // heading: a '==='/'---' line after a table header+delimiter is
    // a table body row (marked's table regex absorbs it, doc-26), so
    // the line falls through and joins the paragraph instead.
    if (tip.t === 'paragraph') {
      const lvl = matchSetext(line.remaining());
      if (lvl && !isTableCandidate(tip.literal)) {
        const rest = this.extractDefinitions(tip.literal);
        const headingText = rest.replace(/\n$/, '').replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
        if (headingText.length) {
          tip.t = 'heading';
          tip.level = lvl;
          tip.literal = headingText;
          this.finalize(tip);
          return true;
        }
        // The paragraph held only definitions: keep it a paragraph
        // (the underline line is added as text below).
        tip.literal = '';
      }
    }

    // If the tip is a list, only a new list item may follow it. A new
    // item is a sibling only when its indent is at most the first
    // item's indent + 3; deeper items are not siblings (they become a
    // lazy paragraph line or indented code, handled below after the
    // list is closed).
    if (tip.t === 'list') {
      const m = matchListItem(line);
      // The marker's indent relative to the container (no indent
      // advance has run yet here, so m.indent is already relative).
      if (m) m.markerIndent = m.indent;
      if (m && this.sameListType(tip, m) && m.markerIndent <= tip.firstIndent + 3) {
        // a thematic break line is not a list item
        if (!matchThematicBreak(line.remaining())) {
          this.addListItem(tip, m);
          // the item's content is opened by the recursive call
          return this.openNewBlocks(blank);
        }
      }
      this.finalize(tip);
      tip = this.tip;
    }

    // Save the line state: the indent advance below is only for block
    // start detection; a paragraph continuation must keep its leading
    // spaces, so the fall-through restores it.
    const save = line.save();
    const ind = line.indent();
    if (ind <= 3) line.advance(ind);
    // with more than 3 spaces of indent no block start can match here;
    // the line is indented code (or a paragraph continuation)
    const s = ind <= 3 ? line.remaining() : '';

    // ATX heading
    const atx = matchAtx(s);
    if (atx) {
      this.closeParagraph();
      tip = this.tip;
      const h = this.addChild('heading', tip);
      h.level = atx;
      let text = s.slice(atx);
      text = text.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
      // closing sequence of #'s
      const cm = text.match(/^(.*?)[ \t]+#+[ \t]*$/);
      if (cm) text = cm[1];
      else {
        const cm2 = text.match(/^(#+)[ \t]*$/);
        if (cm2) text = '';
      }
      h.literal = text;
      this.tip = h;
      this.finalize(h);
      return true;
    }

    // Fenced code
    const fence = matchFence(s);
    if (fence) {
      this.closeParagraph();
      tip = this.tip;
      const c = this.addChild('code_block', tip);
      c.fenced = true;
      c.fenceChar = fence.char;
      c.fenceLen = fence.len;
      c.fenceIndent = ind;
      c.info = fence.info;
      this.tip = c;
      line.skipToEnd();
      return true;
    }

    // HTML block. A type 7 block cannot interrupt a paragraph (only
    // types 1-6 can); a type 7 line inside a paragraph stays text.
    if (s.charCodeAt(0) === 60) {
      const ht = htmlBlockType(s);
      const canStart = tip.t === 'paragraph' ? (ht >= 1 && ht <= 6) : (ht >= 1);
      if (canStart) {
        this.closeParagraph();
        tip = this.tip;
        const h = this.addChild('html_block', tip);
        h.htmlType = ht;
        if (ht === 1) {
          const nm = s.slice(1).match(/^[A-Za-z]+/);
          h.htmlTag = nm ? nm[0].toLowerCase() : '';
        }
        // The first line keeps its leading spaces (the indent advance
        // above is only for block start detection).
        line.restore(save);
        const firstText = line.remaining();
        h.literal = firstText + (line.hasNewline ? '\n' : '');
        this.tip = h;
        if (this.htmlBlockEnds(h, firstText)) this.pendingHtml = h;
        line.skipToEnd();
        return true;
      }
    }

    // Thematic break
    if (matchThematicBreak(s)) {
      this.closeParagraph();
      tip = this.tip;
      const tb = this.addChild('thematic_break', tip);
      this.tip = tb;
      this.finalize(tb);
      return true;
    }

    // Blockquote
    if (s.charCodeAt(0) === 62) {
      this.closeParagraph();
      tip = this.tip;
      const q = this.addChild('blockquote', tip);
      this.tip = q;
      line.advance(1);
      if (line.peek() === 32) line.advance(1);
      else if (line.peek() === 9) line.advance(1);
      return this.openNewBlocks(blank);
    }

    // List
    const m = matchListItem(line);
    if (m) {
      // The indent advance above already consumed `ind` columns, so
      // the marker's indent relative to the container is ind + m.indent.
      m.markerIndent = ind + m.indent;
      // an empty item cannot interrupt a paragraph
      if (tip.t === 'paragraph' && m.blank) {
        // fall through to paragraph handling
      } else if (tip.t === 'paragraph' && m.marker === 'ordered' && m.num !== 1 &&
                 tip.parent.t !== 'item') {
        // an ordered list interrupts a paragraph only when it starts
        // at 1 -- except inside a list item, where any number may
        // start a nested list (the paragraph's parent is the item)
      } else {
        this.closeParagraph();
        tip = this.tip;
        this.addList(m);
        // the item's content is opened by the recursive call
        return this.openNewBlocks(blank);
      }
    }

    // Indented code
    if (ind >= 4 && tip.t !== 'paragraph') {
      const c = this.addChild('code_block', tip);
      c.fenced = false;
      line.advance(4);
      c.literal = line.remaining() + (line.hasNewline ? '\n' : '');
      this.tip = c;
      line.skipToEnd();
      return true;
    }

    // Paragraph (or continue the current one). Restore the line so the
    // paragraph content keeps its leading spaces.
    line.restore(save);
    if (tip.t !== 'paragraph') {
      // A line with no content (only whitespace after the containers)
      // does not start a paragraph (cm-279: an empty list item line
      // adds no paragraph; its content comes on a later line).
      if (!line.remaining().trim()) return false;
      const p = this.addChild('paragraph', tip);
      this.tip = p;
    }
    return false;
  }

  // Close the tip paragraph (a new block that interrupts it starts).
  closeParagraph() {
    if (this.tip.t === 'paragraph') this.finalize(this.tip);
  }

  sameListType(list, m) {
    if (m.marker === 'bullet') return list.bullet === m.delim;
    return list.delim === m.delim;
  }

  addList(m) {
    const list = this.addChild('list', this.tip);
    list.firstIndent = m.markerIndent;
    if (m.marker === 'bullet') list.bullet = m.delim;
    else { list.delim = m.delim; list.start = m.num; }
    this.addListItem(list, m);
  }

  addListItem(list, m) {
    const item = newBlock('item', list);
    item.markerWidth = m.markerWidth;
    item.markerIndent = m.markerIndent;
    item.contentIndent = m.contentIndent;
    this.tip = item;
    const line = this.line;
    line.advance(m.indent + m.contentIndent);
  }

  // --- phase 3: add the line to the tip leaf ------------------------
  addLineToLeaf(line) {
    const tip = this.tip;
    const blank = line.isBlank();
    if (tip.t === 'paragraph') {
      // A line is blank for the paragraph when it was blank before any
      // container matched, or when nothing remains after the containers
      // (a bare '>' line). A '> ' line leaves a space of content.
      if (this.lineBlank || line.remaining().length === 0) {
        // A whitespace-only line inside a table-candidate paragraph is
        // a table row of empty cells ONLY when it is spaces followed by
        // exactly one tab (marked's table body regex treats the tab as
        // the row's content character); spaces-only, tab+space, and
        // multi-tab lines end the paragraph (and the table). A truly
        // empty line also ends it.
        if (this.lineBlank && /^ *\t$/.test(line.remaining()) && isTableCandidate(tip.literal)) {
          tip.literal += line.remaining();
          if (line.hasNewline) tip.literal += '\n';
          tip._prevLazyIndent = -1;
          tip._prevLazyDeep = false;
          return;
        }
        this.finalize(tip);
        return;
      }
      if (this.lazy) {
        this.addLazyLine(tip, line);
        return;
      }
      // A matched paragraph continuation inside a list item loses 4
      // columns when its indent (after the containers) is >= 4.
      if (line.indent() >= 4 && this.paragraphInListItem(tip)) {
        line.advance(4);
      }
      tip.literal += line.remaining();
      if (line.hasNewline) tip.literal += '\n';
      tip._prevLazyIndent = -1;
      tip._prevLazyDeep = false;
      return;
    }
    if (tip.t === 'code_block') {
      if (tip.fenced) {
        if (!blank) {
          const ind = line.indent();
          if (ind <= 3) {
            const s = line.remaining().slice(ind);
            const c = s.charCodeAt(0);
            if (c === tip.fenceChar.charCodeAt(0)) {
              let i = 0;
              while (i < s.length && s.charCodeAt(i) === c) i++;
              if (i >= tip.fenceLen) {
                let j = i;
                while (j < s.length && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) j++;
                if (j === s.length) {
                  tip.closed = true;
                  this.finalize(tip);
                  return;
                }
              }
            }
          }
        }
        if (blank) {
          // A whitespace-only line inside a backtick fence is code
          // content, not a paragraph break: marked strips up to
          // fenceIndent columns from it exactly like a content line
          // (a tab partially consumed by the dedent is dropped
          // whole). Tilde fences keep blank lines verbatim.
          if (tip.fenceChar === '`') {
            const rm = Math.min(line.indent(), tip.fenceIndent);
            const wasPartial = line.partialTab;
            line.advance(rm);
            if (wasPartial === 0 && line.partialTab > 0) {
              line.col += line.partialTab;
              line.pos++;
              line.partialTab = 0;
            }
          }
          tip.literal += line.remaining();
          if (line.hasNewline) tip.literal += '\n';
          return;
        }
        // content line: remove up to fenceIndent columns of indent.
        // marked's indent compensation (Dt) only applies to backtick
        // fences: its indentCodeCompensation regex is /^(\s+)(?:```)/,
        // so a tilde fence keeps its content lines' leading spaces
        // verbatim (doc-22: ~~~typescript in a blockquote keeps 3
        // spaces; doc-29: ~~~objective-c keeps 2 spaces).
        // A tab partially consumed by this removal is dropped whole
        // (marked's dedent counts a tab as one character, so it never
        // leaves a partial tab behind).
        const rm = tip.fenceChar === '`' ? Math.min(line.indent(), tip.fenceIndent) : 0;
        const wasPartial = line.partialTab;
        line.advance(rm);
        if (wasPartial === 0 && line.partialTab > 0) {
          line.col += line.partialTab;
          line.pos++;
          line.partialTab = 0;
        }
        tip.literal += line.remaining();
        if (line.hasNewline) tip.literal += '\n';
        return;
      }
      // indented code
      if (blank) {
        // a whitespace-only line contributes (spaces - 4) when it has
        // >= 4 columns of whitespace, else nothing (just the newline)
        const w = line.indent();
        if (w >= 4) tip.literal += ' '.repeat(w - 4);
        if (line.hasNewline) tip.literal += '\n';
        return;
      }
      line.advance(Math.min(line.indent(), 4));
      tip.literal += line.remaining();
      if (line.hasNewline) tip.literal += '\n';
      return;
    }
    if (tip.t === 'html_block') {
      if (blank) {
        // Type 1 (pre/script/style/textarea) continues through blank
        // lines until its end tag; types 6/7 end at a blank line.
        if (tip.htmlType === 6 || tip.htmlType === 7) {
          tip.htmlEndedBlank = true;
          this.finalize(tip);
        } else {
          if (line.hasNewline) tip.literal += '\n';
        }
        return;
      }
      const text = line.remaining();
      tip.literal += text;
      if (line.hasNewline) tip.literal += '\n';
      if (this.htmlBlockEnds(tip, text)) {
        this.pendingHtml = tip;
      }
      return;
    }
    // tip is a container or the document: a (blank) line adds nothing.
  }

  // Is this paragraph inside a list item (directly or through a
  // blockquote)? Used for the 4-column strip on matched continuations.
  paragraphInListItem(tip) {
    let b = tip.parent;
    while (b) {
      if (b.t === 'item') return true;
      b = b.parent;
    }
    return false;
  }

  // Is this paragraph inside a blockquote? Used for the lazy setext
  // underline padding rule.
  paragraphInBlockquote(tip) {
    let b = tip.parent;
    while (b) {
      if (b.t === 'blockquote') return true;
      b = b.parent;
    }
    return false;
  }

  // Add a lazy continuation line to a paragraph, applying the lazy
  // content rules (per-container strips, the extra 4-strip, and the
  // lazy setext underline padding).
  addLazyLine(tip, line) {
    const unmatched = this.lazyUnmatched || [];
    // A lazy setext underline: a run of '=' or '-' with only trailing
    // whitespace. It stays paragraph text (never a heading), with the
    // leading whitespace padded to 4 columns when the paragraph is in
    // a blockquote and the previous line was lazy with indent < 4;
    // otherwise just the run.
    const su = matchSetextRun(line.remaining());
    if (su) {
      let text;
      if (this.paragraphInBlockquote(tip) &&
          tip._prevLazyIndent >= 0 && tip._prevLazyIndent < 4) {
        text = su.leadWidth < 4
          ? ' '.repeat(4 - su.leadWidth) + su.lead + su.run
          : su.lead + su.run;
      } else {
        text = su.run;
      }
      tip.literal += text;
      if (line.hasNewline) tip.literal += '\n';
      tip._prevLazyIndent = this.lazyIndent;
      tip._prevLazyDeep = false;
      return;
    }
    // Normal lazy line: strip the unmatched containers' indents.
    // A 4-column strip is applied at most once (the "indented code"
    // strip): by the first blockquote that qualifies, or, if the
    // innermost unmatched container is a list item, after all the
    // containers when the remaining indent is still >= 4.
    let stripped4 = false;
    let extraStrip = false;
    for (const blk of unmatched) {
      if (blk.t === 'item') {
        const cs = blk.markerIndent + blk.contentIndent;
        if (line.indent() >= cs) line.advance(cs);
      } else if (blk.t === 'blockquote') {
        if (!stripped4 && line.indent() >= 4) {
          line.advance(4);
          stripped4 = true;
        }
      }
    }
    const innermost = unmatched.length ? unmatched[unmatched.length - 1] : null;
    if (!stripped4 && innermost && innermost.t === 'item' && line.indent() >= 4) {
      line.advance(4);
      stripped4 = true;
      extraStrip = true;
    }
    tip.literal += line.remaining();
    if (line.hasNewline) tip.literal += '\n';
    tip._prevLazyIndent = this.lazyIndent;
    tip._prevLazyDeep = extraStrip;
  }

  // Does the given line end this html block?
  htmlBlockEnds(tip, text) {
    const t = tip.htmlType;
    if (t === 1) {
      // closing tag for the opening element, case-insensitive
      const lower = text.toLowerCase();
      const tag = tip.htmlTag;
      let idx = lower.indexOf('</' + tag);
      while (idx !== -1) {
        let j = idx + 2 + tag.length;
        while (j < lower.length && (lower.charCodeAt(j) === 32 || lower.charCodeAt(j) === 9)) j++;
        if (j < lower.length && lower.charCodeAt(j) === 62) return true;
        idx = lower.indexOf('</' + tag, idx + 1);
      }
      return false;
    }
    if (t === 2) return text.includes('-->') || text.includes('<!-->') || text.includes('<!--->');
    if (t === 3) return text.includes('?>');
    if (t === 4) return text.includes('>');
    if (t === 5) return text.includes(']]>');
    return false;
  }

  // --- finalize ------------------------------------------------------
  finalize(blk) {
    if (blk === this.pendingHtml) this.pendingHtml = null;
    // pop the tip up to the block's parent
    while (this.tip !== blk.parent && this.tip !== this.doc) {
      this.tip = this.tip.parent;
    }
    if (this.tip === blk) this.tip = blk.parent;
    switch (blk.t) {
      case 'paragraph': {
        // strip the trailing newline
        if (blk.literal.endsWith('\n')) blk.literal = blk.literal.slice(0, -1);
        // extract link reference definitions
        blk.literal = this.extractDefinitions(blk.literal);
        // table detection
        this.tryTable(blk);
        // a paragraph that held only definitions (or nothing) vanishes
        if (blk.t === 'paragraph' && !blk.literal.trim()) {
          const parent = blk.parent;
          if (parent) {
            const idx = parent.children.indexOf(blk);
            if (idx !== -1) parent.children.splice(idx, 1);
          }
        }
        break;
      }
      case 'code_block': {
        // Strip trailing blank lines. An indented code block loses all
        // of them; a fenced code block loses exactly one trailing empty
        // line (```\nb\n\n\n``` -> `b\n\n`, ```\nfoo\n\n``` -> `foo\n`).
        const hadNL = blk.literal.endsWith('\n');
        let lines = blk.literal.split('\n');
        if (hadNL) lines.pop();
        if (blk.fenced) {
          if (lines.length && lines[lines.length - 1] === '') lines.pop();
        } else {
          while (lines.length && lines[lines.length - 1] === '') lines.pop();
        }
        blk.literal = lines.join('\n');
        if (lines.length && hadNL) blk.literal += '\n';
        break;
      }
      case 'html_block': {
        if (blk.htmlEndedBlank && blk.literal.endsWith('\n')) {
          blk.literal = blk.literal.slice(0, -1);
        }
        break;
      }
      case 'item': {
        // _lastLineBlank is maintained during phase 1 (the last line
        // processed while this item was open); do not overwrite it.
        break;
      }
      case 'list': {
        // loose when any item contains two block children separated by
        // a blank line, or any non-last item ends with a blank line
        let loose = false;
        for (const item of blk.children) {
          if (item._blankBetween) { loose = true; break; }
        }
        if (!loose) {
          for (let i = 0; i < blk.children.length - 1; i++) {
            if (blk.children[i]._lastLineBlank) { loose = true; break; }
          }
        }
        blk.tight = !loose;
        break;
      }
      default:
        break;
    }
  }

  // Extract link reference definitions from the start of a paragraph's
  // text. Returns the remaining text.
  extractDefinitions(text) {
    let pos = 0;
    const n = text.length;
    while (pos < n) {
      const def = this.parseDefinition(text, pos);
      if (!def) break;
      const key = normalizeLabel(def.label);
      if (key && !this.refs.has(key)) {
        this.refs.set(key, { dest: def.dest, title: def.title });
      }
      pos = def.end;
      if (pos < n && text.charCodeAt(pos) === 10) pos++;
    }
    return text.slice(pos);
  }

  // Parse one link reference definition starting at text[pos].
  // Returns {label, dest, title, end} or null.
  parseDefinition(text, pos) {
    const n = text.length;
    let i = pos;
    // up to 3 spaces of indent
    let ind = 0;
    while (i < n && text.charCodeAt(i) === 32 && ind < 3) { i++; ind++; }
    if (i >= n || text.charCodeAt(i) !== 91) return null;
    const label = parseLinkLabel(text, i);
    if (!label) return null;
    // A reference label may not contain unescaped '[' or ']'
    // (cm-547/548/590: [ref[bar]], [[foo]] are not defs).
    if (hasUnescapedBracket(label.text)) return null;
    const normLabel = normalizeLabel(label.text);
    if (!normLabel || normLabel.length > 999) return null;
    i = label.end;
    if (i >= n || text.charCodeAt(i) !== 58) return null; // ':'
    i++;
    // skip spaces/tabs/newlines (one line max, no blank line)
    let j = skipInlineSpace(text, i);
    if (j === -1) return null;
    const d = parseLinkDestination(text, j);
    if (!d) return null;
    const destEnd = d.end;
    // Where the destination line ends (spaces/tabs only, no newline).
    let p = destEnd;
    while (p < n && (text.charCodeAt(p) === 32 || text.charCodeAt(p) === 9)) p++;
    const destLineEnds = p >= n || text.charCodeAt(p) === 10;
    // Try a title: it must be separated from the destination by
    // whitespace (it may be on the next line, cm-217), and must be
    // followed by the end of the line (cm-210: a title followed by
    // junk does not count, backtrack to a destination-only def).
    const k = skipInlineSpace(text, destEnd);
    if (k !== -1 && k > destEnd && k < n) {
      const qc = text.charCodeAt(k);
      if (qc === 34 || qc === 39 || qc === 40) {
        const t = parseLinkTitle(text, k);
        if (t) {
          let m = t.end;
          while (m < n && (text.charCodeAt(m) === 32 || text.charCodeAt(m) === 9)) m++;
          if (m >= n || text.charCodeAt(m) === 10) {
            return { label: label.text, dest: d.dest, title: t.title, end: m };
          }
        }
        // The title attempt failed: backtrack to a destination-only
        // definition when the destination line ends cleanly.
        if (destLineEnds) {
          return { label: label.text, dest: d.dest, title: null, end: p };
        }
        return null;
      }
    }
    // No title: the definition is valid only when the destination
    // line ends (a title opener with no preceding whitespace, e.g.
    // [foo]: <bar>(baz), is not a definition, cm-201).
    if (k !== -1 && k === destEnd && k < n) {
      const qc = text.charCodeAt(k);
      if (qc === 34 || qc === 39 || qc === 40) return null;
    }
    if (destLineEnds) {
      return { label: label.text, dest: d.dest, title: null, end: p };
    }
    // The destination is followed by junk on its line and no title
    // was found: not a definition.
    return null;
  }

  // Table detection: convert a paragraph into a table when its lines
  // form a header row, a delimiter row and (optionally) body rows.
  tryTable(blk) {
    const lines = blk.literal.split('\n');
    if (lines.length < 2) return;
    // A table row may have at most 3 columns of indent; a line with
    // indent >= 4 is not a table row (cm-087: `Foo\n    ---` is a
    // paragraph, not a table).
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      let col = 0;
      let k = 0;
      while (k < lines[i].length) {
        const c = lines[i].charCodeAt(k);
        if (c === 32) { col++; k++; }
        else if (c === 9) { col += 4 - (col % 4); k++; }
        else break;
      }
      if (col >= 4) return;
    }
    const headerCells = splitTableRow(lines[0]);
    if (headerCells === null) return;
    const delimCells = splitTableRow(lines[1]);
    if (delimCells === null) return;
    if (headerCells.length !== delimCells.length) return;
    const align = [];
    for (const d of delimCells) {
      const t = d.trim();
      if (!/^:?-+:?$/.test(t)) return;
      if (t.startsWith(':') && t.endsWith(':')) align.push('center');
      else if (t.endsWith(':')) align.push('right');
      else if (t.startsWith(':')) align.push('left');
      else align.push(null);
    }
    // body rows must have the same cell count (extra cells are dropped,
    // missing cells are padded) — but a body row that is not a table row
    // at all keeps the paragraph a paragraph. A whitespace-only line is
    // a row of empty cells (only a truly empty line is skipped, which
    // is the trailing split artifact).
    const rows = [];
    for (let i = 2; i < lines.length; i++) {
      if (lines[i].length === 0) continue;
      const cells = splitTableRow(lines[i]);
      if (cells === null) return;
      while (cells.length < headerCells.length) cells.push('');
      rows.push(cells.slice(0, headerCells.length));
    }
    blk.t = 'table';
    blk.align = align;
    blk.headerCells = headerCells;
    blk.rows = rows;
    blk.literal = '';
  }
}

// True when a paragraph's literal (so far) begins with a valid table
// header + delimiter row. A whitespace-only line inside such a paragraph
// is a table row of empty cells, not a paragraph ender (a tab-only line
// between table rows is a row; a truly empty line still ends the table).
// Is a paragraph's literal a table? It needs at least two lines
// whose cell counts match, with the second line a delimiter row.
function isTableCandidate(literal) {
  const lines = literal.split('\n');
  if (lines.length < 2) return false;
  const headerCells = splitTableRow(lines[0]);
  if (headerCells === null) return false;
  const delimCells = splitTableRow(lines[1]);
  if (delimCells === null) return false;
  if (headerCells.length !== delimCells.length) return false;
  for (const d of delimCells) {
    if (!/^:?-+:?$/.test(d.trim())) return false;
  }
  return true;
}

// Split a table row into cells. Returns null when the row is not a valid
// table row. A '|' inside a code span or escaped as '\|' is literal.
function splitTableRow(line) {
  let cells = [];
  let cur = '';
  let i = 0;
  const n = line.length;
  let hasPipe = false;
  while (i < n) {
    const c = line.charCodeAt(i);
    if (c === 92 && i + 1 < n && line.charCodeAt(i + 1) === 124) {
      cur += '|';
      i += 2;
      continue;
    }
    if (c === 96) {
      let run = 0;
      while (i + run < n && line.charCodeAt(i + run) === 96) run++;
      const close = findCodeSpanClose(line, i + run, run);
      if (close !== -1) {
        // A '\|' inside a code span becomes '|' in the cell text
        // (gfm-200); a '\\' stays a backslash.
        let span = line.slice(i, close + run);
        if (span.includes('\\|')) {
          let out = '';
          for (let k = 0; k < span.length; k++) {
            if (span.charCodeAt(k) === 92 && k + 1 < span.length) {
              const nx = span.charCodeAt(k + 1);
              if (nx === 124) { out += '|'; k++; continue; }
              if (nx === 92) { out += '\\\\'; k++; continue; }
            }
            out += span.charAt(k);
          }
          span = out;
        }
        cur += span;
        i = close + run;
        continue;
      }
      cur += line.charAt(i);
      i++;
      continue;
    }
    if (c === 124) {
      hasPipe = true;
      cells.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += line.charAt(i);
    i++;
  }
  cells.push(cur);
  // drop empty leading/trailing cells from outer pipes
  if (cells.length > 1 && cells[0].trim() === '') cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === '') cells.pop();
  if (!hasPipe && cells.length === 1) return cells;
  return cells;
}

/* ------------------------------------------------------------------ */
/* Inline parsing                                                      */
/*                                                                     */
/* A paragraph/heading/table-cell's text is scanned left to right into */
/* a doubly-linked list of nodes. Emphasis is resolved afterwards with */
/* the CommonMark delimiter-stack algorithm.                           */
/*                                                                     */
/* Node shapes (all have .next/.prev):                                 */
/*   text  {t:'text', s}   — escaped with encode=false at render      */
/*   raw   {t:'raw', s}    — emitted as-is (named entities, decoded   */
/*                           numeric entities, already-escaped chars) */
/*   delim {t:'delim', ch, len, canOpen, canClose, dPrev, dNext}      */
/*   code  {t:'code', s}   — code span content, escaped at render     */
/*   html  {t:'html', s}   — raw HTML tag/comment, emitted as-is      */
/*   br    {t:'br'}        — hard break                               */
/*   soft  {t:'soft'}      — soft break (rendered as '\n')           */
/*   em/strong/del {t, first, last} — wrapper over child nodes        */
/*   link  {t:'link', href, title, first, last}                       */
/*   image {t:'image', src, alt, title}                               */
/* ------------------------------------------------------------------ */

const ASCII_PUNCT = new Set();
for (const c of '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~') ASCII_PUNCT.add(c.charCodeAt(0));

const UNICODE_PUNCT_RE = /[\p{P}\p{S}]/u;

// The code point just before index i in s (handles a surrogate pair),
// or -1 at the start.
function codePointBefore(s, i) {
  if (i <= 0) return -1;
  const c = s.charCodeAt(i - 1);
  if (c >= 0xDC00 && c <= 0xDFFF && i >= 2) {
    const hi = s.charCodeAt(i - 2);
    if (hi >= 0xD800 && hi <= 0xDBFF) return (hi - 0xD800) * 0x400 + (c - 0xDC00) + 0x10000;
  }
  return c;
}

// Is this code point a Unicode space (for delimiter flanking)?
function isUnicodeSpaceCp(cp) {
  return cp === 32 || cp === 9 || cp === 10 || cp === 13 || cp === 11 || cp === 12 ||
    cp === 0xA0 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200A) ||
    cp === 0x2028 || cp === 0x2029 || cp === 0x202F || cp === 0x205F || cp === 0x3000;
}

// Is this code point Unicode punctuation (for delimiter flanking)?
// ASCII punctuation is checked against the ASCII set; anything else
// uses the Unicode P/S categories.
function isUnicodePunctCp(cp) {
  if (cp < 0) return false;
  if (cp < 128) return ASCII_PUNCT.has(cp);
  return UNICODE_PUNCT_RE.test(String.fromCodePoint(cp));
}

// The inline lexer's inLink state (marked's Lexer.state.inLink): true
// while inside an unclosed <a ...> tag. Extended (bare) autolinks are
// only formed when it is false; <...> autolinks and [text](url) links
// still form. Set by an inline open tag starting '<a ' (tag name 'a'
// followed by a space, i.e. with attributes), cleared by an inline
// closing tag starting '</a'. Persists across blocks for the whole
// document; reset at the start of each parse(). An <a> tag that forms
// an HTML block (e.g. alone on a line) never reaches the inline lexer,
// so it does not touch this flag.
let inLink = false;

// Inline HTML tag/comment/processing-instruction/declaration/CDATA.
// Returns {text, end} (end = index just past the tag) or null.
function parseInlineHtml(s, i) {
  const n = s.length;
  if (s.charCodeAt(i + 1) === 33) {
    if (s.startsWith('<!--', i)) {
      // <!--> and <!---> are complete comments that end immediately
      // (cm-626).
      if (s.startsWith('<!-->', i)) return { text: s.slice(i, i + 5), end: i + 5 };
      if (s.startsWith('<!--->', i)) return { text: s.slice(i, i + 6), end: i + 6 };
      const end = s.indexOf('-->', i + 4);
      if (end === -1) return null;
      return { text: s.slice(i, end + 3), end: end + 3 };
    }
    if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      if (end === -1) return null;
      return { text: s.slice(i, end + 3), end: end + 3 };
    }
    // declaration <!A ...>
    let p = i + 2;
    while (p < n && s.charCodeAt(p) !== 62) p++;
    if (p >= n) return null;
    return { text: s.slice(i, p + 1), end: p + 1 };
  }
  if (s.charCodeAt(i + 1) === 63) {
    // processing instruction <? ... ?>
    const end = s.indexOf('?>', i + 2);
    if (end === -1) return null;
    return { text: s.slice(i, end + 2), end: end + 2 };
  }
  const end = scanTag(s, i);
  if (end === -1) return null;
  // Update the inLink state (marked's tag tokenizer): an inline open
  // tag starting '<a ' (name 'a' + space) sets it; an inline closing
  // tag that is exactly '</a>' clears it. Other tags leave it alone.
  // (A bare '<a>' has no space after the name, so it does not set it;
  // '</abbr>' is not '</a>', so it does not clear it.)
  if (s.charCodeAt(i + 1) !== 47) {
    const c1 = s.charCodeAt(i + 1);
    if ((c1 === 97 || c1 === 65) && s.charCodeAt(i + 2) === 32) inLink = true;
  } else if (s.slice(i, i + 4).toLowerCase() === '</a>') {
    inLink = false;
  }
  return { text: s.slice(i, end), end };
}

// Parse one inline string into a node list. Returns the sentinel head node
// (head.next is the first real node). refs is the link reference map.
// Bare extended autolinks (www. / scheme / email) form only when the
// module-level inLink flag is false (set while inside a link label or an
// unclosed <a> tag); <...> autolinks always form.
// ------------------------------------------------------------------
// The emStrong mask (marked 18.1.3's `#n` hook). Before emStrong/del
// read a paragraph, marked masks links, code spans and HTML in a
// COPY of the text (all replacements length-preserving, so indices
// still line up): a delimiter whose first character the mask replaced
// is literal text, not an emphasis delimiter. The three rule regexes
// below are marked's own, taken verbatim from its live Lexer rules.
// ------------------------------------------------------------------
const MASK_BLOCK_SKIP = /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)|(?<!`)()(?<b>`+)[^`]+\k<b>(?!`)|<(?! )[^<>]*?>/g;
const MASK_ANY_PUNCT = /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\([\p{P}\p{S}])/gu;
const MASK_REFLINK_SEARCH = /!?\[((?:[^\[\]\\`]*(?:\[(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?)\]\[((?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999})\]|!?\[((?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999})\](?:\[\])?(?!\()/g;
const MASK_LINK = /^!?\[((?:\[(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?)\]\([ \t\n]*(<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\)))(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)))?[ \t\n]*\)/;

// Does `text` contain a link (marked's Lexer.linkInText)? Used by the
// mask's reference-link step: a `[label][ref]` is only masked when
// its label names a defined reference.
function linkInTextMask(text, refs) {
  if (!text.includes('[')) return false;
  for (const m of text.matchAll(new RegExp(MASK_BLOCK_SKIP.source, 'g'))) {
    if (MASK_LINK.test(m[0]) && text.charAt(m.index - 1) !== '!') return true;
  }
  for (const m of text.matchAll(new RegExp(MASK_REFLINK_SEARCH.source, 'g'))) {
    const s = m[0], r = s.lastIndexOf('[');
    if (!(s.charAt(0) === '!' || !refs.has(normalizeLabel(s.slice(r + 1, -1)))) &&
        !(r > 1 && linkInTextMask(s.slice(1, r - 1), refs))) return true;
  }
  return false;
}

// The masked copy of a paragraph: reference links whose label is a
// defined reference become `[aaa...]` (recursing into a nested
// reference in the label's text), code spans keep their backtick
// fences but lose inner backticks to `+`, escaped punctuation becomes
// `+`s, and inline links / code spans / HTML tags become `[aaa...]`.
// Every replacement keeps its length, so a masked position still
// names the same character of the original.
function emStrongMask(s, refs) {
  let t = s;
  if (refs && refs.size > 0 && t.includes('[')) {
    const replaceRef = (m) => {
      const o = m.lastIndexOf('[');
      if (!refs.has(normalizeLabel(m.slice(o + 1, -1)))) return m;
      if (o > 1 && m.charAt(0) !== '!') {
        const inner = m.slice(1, o - 1);
        if (linkInTextMask(inner, refs)) {
          return '[' + inner.replace(new RegExp(MASK_REFLINK_SEARCH.source, 'g'), replaceRef) +
            '][' + 'a'.repeat(m.length - o - 2) + ']';
        }
      }
      return '[' + 'a'.repeat(m.length - 2) + ']';
    };
    t = t.replace(new RegExp(MASK_REFLINK_SEARCH.source, 'g'), replaceRef);
  }
  // Backticks inside a code span become `+` (fences kept); an escaped
  // punctuation pair becomes `++`. A bare run of backticks is left
  // alone. The replace callback takes (match, backtickRun, escapedPunct).
  t = t.replace(new RegExp(MASK_ANY_PUNCT.source, 'gu'), (m, g1, g2) => {
    if (g2) return '+'.repeat(m.length);
    if (g1) return g1 + m.slice(g1.length, -g1.length).replace(/`/g, '+') + g1;
    return m;
  });
  // An inline link, a code span or an HTML tag becomes `[aaa...]`.
  // blockSkip's second numbered group is always the empty `()`, so
  // the offset it would add is always 0.
  t = t.replace(new RegExp(MASK_BLOCK_SKIP.source, 'g'), (m) => '[' + 'a'.repeat(m.length - 2) + ']');
  return t;
}

// Parse inline markdown in `s` into a node list (with a dummy head).
// `refs` is the link-reference map. Returns the head node; the list
// runs head.next ... tail. Delimiter nodes are linked into a second
// chain (dNext/dPrev) for emphasis processing.
function parseInlineNodes(s, refs) {
  const n = s.length;
  const head = { t: 'head', next: null, prev: null };
  const dHead = { t: 'dhead', dNext: null, dPrev: null };
  let last = head;
  let dLast = dHead;
  let pending = '';
  let pendingRaw = false; // true when pending holds raw (unescaped) text

  function flushPending() {
    if (pending.length) {
      const nd = { t: pendingRaw ? 'raw' : 'text', s: pending, next: null, prev: last };
      last.next = nd;
      last = nd;
      pending = '';
    }
    pendingRaw = false;
  }
  function pushText(str) {
    if (pendingRaw) flushPending();
    pending += str;
  }
  function pushRaw(str) {
    if (!pendingRaw) flushPending();
    pendingRaw = true;
    pending += str;
  }
  function pushNode(nd) {
    flushPending();
    nd.prev = last;
    nd.next = null;
    last.next = nd;
    last = nd;
  }
  function pushDelim(ch, len, canOpen, canClose, pos) {
    flushPending();
    const nd = { t: 'delim', ch, len, canOpen, canClose, pos, next: null, prev: last, dNext: null, dPrev: dLast };
    last.next = nd;
    last = nd;
    dLast.dNext = nd;
    dLast = nd;
  }

  // Remove `localText` from the end of the pending output (the buffer
  // plus the already-emitted text/delimiter nodes). The local part of
  // an email may span delimiter nodes (a '_' in a.b-c_d@a.b flushes
  // the buffer), so the buffer alone is not enough. Raw text/nodes
  // (backslash escapes and entities) never count: an escaped char
  // (cm-606: the '+' in <foo\+@bar.example.com>) is not part of an
  // email address. Verifies first so a mismatch leaves the output
  // untouched.
  function stripLocalPart(localText) {
    // Phase 1: verify the pending output ends with localText, counting
    // only plain text and delimiter nodes (not raw/escaped text).
    let collected = pendingRaw ? '' : pending;
    let nd = last;
    while (collected.length < localText.length && nd && nd !== head) {
      if (nd.t === 'text') collected = nd.s + collected;
      else if (nd.t === 'delim') collected = nd.ch.repeat(nd.len) + collected;
      nd = nd.prev;
    }
    if (!collected.endsWith(localText)) return false;
    // Phase 2: remove it (verified to match).
    let remaining = localText;
    if (pending.length && !pendingRaw) {
      const take = Math.min(pending.length, remaining.length);
      pending = pending.slice(0, pending.length - take);
      if (!pending.length) pendingRaw = false;
      remaining = remaining.slice(0, remaining.length - take);
      if (!remaining.length) return true;
    }
    while (remaining.length) {
      const nd2 = last;
      if (!nd2 || nd2 === head) return false;
      if (nd2.t === 'text') {
        const take = Math.min(nd2.s.length, remaining.length);
        nd2.s = nd2.s.slice(0, nd2.s.length - take);
        remaining = remaining.slice(0, remaining.length - take);
        if (!nd2.s.length) {
          last = nd2.prev;
          last.next = null;
        }
        if (!remaining.length) return true;
      } else if (nd2.t === 'delim') {
        const chCode = nd2.ch.charCodeAt(0);
        let take = 0;
        while (take < nd2.len && take < remaining.length &&
               remaining.charCodeAt(remaining.length - 1 - take) === chCode) {
          take++;
        }
        if (take === 0) return false;
        nd2.len -= take;
        remaining = remaining.slice(0, remaining.length - take);
        if (nd2.len === 0) {
          last = nd2.prev;
          last.next = null;
          if (nd2.dPrev) nd2.dPrev.dNext = nd2.dNext;
          if (nd2.dNext) nd2.dNext.dPrev = nd2.dPrev;
          if (dLast === nd2) dLast = nd2.dPrev;
        }
        if (!remaining.length) return true;
      } else {
        return false;
      }
    }
    return true;
  }

  // End position (the ']') of a failed link label: when a '[' opens a
  // label that parseLinkLabel cannot span (e.g. it holds a code span
  // whose content contains a backtick, doc-16/18/20/28) and a ']('
  // follows, marked's emStrong mask hides the '*'/'_'/'~' delimiters
  // inside that label, so no emphasis forms there — but code spans
  // still parse. The mask is cleared once the scan passes the ']'.
  let failedLabelEnd = -1;

  // The masked copy of this paragraph (marked's `#n`): links, code
  // spans and HTML are hidden from emStrong/del. Only computed when
  // the text can hold a delimiter at all.
  const masked = (s.includes('*') || s.includes('_') || s.includes('~')) ? emStrongMask(s, refs) : null;

  let i = 0;
  while (i < n) {
    const c = s.charCodeAt(i);

    // ---- newline: soft or hard break -------------------------------
    if (c === 10) {
      let spaces = 0;
      if (!pendingRaw) {
        let k = pending.length;
        while (k > 0 && pending.charCodeAt(k - 1) === 32) { k--; spaces++; }
        if (spaces >= 2) pending = pending.slice(0, pending.length - spaces);
      }
      const hard = spaces >= 2;
      if (hard) pushNode({ t: 'br' });
      else pushNode({ t: 'soft' });
      i++;
      // After a hard break, the next line's leading spaces/tabs are
      // stripped (cm-636/637); a soft break keeps them.
      if (hard) {
        while (i < n && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++;
      }
      continue;
    }

    // ---- backslash -------------------------------------------------
    if (c === 92) {
      if (i + 1 < n) {
        const d = s.charCodeAt(i + 1);
        if (d === 10) {
          pushNode({ t: 'br' });
          i += 2;
          while (i < n && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++;
          continue;
        }
        // an escaped punctuation char is emitted already-escaped, so
        // it can never be mistaken for an entity or markup
        if (isAsciiPunct(d)) { pushRaw(escapeHtml(s.charAt(i + 1), true)); i += 2; continue; }
      }
      pushText('\\');
      i++;
      continue;
    }

    // ---- code span -------------------------------------------------
    if (c === 96) {
      let run = 1;
      while (i + run < n && s.charCodeAt(i + run) === 96) run++;
      const close = findCodeSpanClose(s, i + run, run);
      if (close !== -1) {
        let content = s.slice(i + run, close);
        content = content.replace(/\n/g, ' ');
        if (content.length >= 2 && content.charCodeAt(0) === 32 &&
            content.charCodeAt(content.length - 1) === 32 && /[^ ]/.test(content)) {
          content = content.slice(1, -1);
        }
        pushNode({ t: 'code', s: content });
        i = close + run;
        continue;
      }
      pushText('`'.repeat(run));
      i += run;
      continue;
    }

    // ---- entity ----------------------------------------------------
    if (c === 38) {
      const dec = decodeNumericEntity(s, i);
      if (dec) { pushRaw(escapeHtml(dec.ch, true)); i += dec.len; continue; }
      const ent = matchNamedEntity(s, i);
      if (ent) { pushRaw(s.slice(i, i + ent)); i += ent; continue; }
      pushText('&');
      i++;
      continue;
    }

    // ---- < : autolink or inline HTML -------------------------------
    if (c === 60) {
      const auto = tryAutolink(s, i);
      if (auto) {
        pushNode(makeAutolinkNode(auto.text, auto.href));
        i = auto.end;
        continue;
      }
      const tag = parseInlineHtml(s, i);
      if (tag) {
        pushNode({ t: 'html', s: tag.text });
        i = tag.end;
        continue;
      }
      pushText('<');
      i++;
      continue;
    }

    // ---- [ : link or image -----------------------------------------
    if (c === 91) {
      const res = tryLink(s, i, refs, pending, pendingRaw);
      if (res) {
        if (res.isImage) pending = res.buf; // the '!' was consumed from the buffer
        pushNode(res.node);
        i = res.end;
        continue;
      }
      // No link: if the label itself cannot be spanned (parseLinkLabel
      // returns null) and a '](' follows, this is a failed link
      // attempt — marked's emStrong mask hides the emphasis
      // delimiters inside the label (doc-16/18/20/28). Find the ']'
      // that the '(' belongs to and mask up to it.
      if (!parseLinkLabel(s, i)) {
        let p = i + 1;
        while (p < n && s.charCodeAt(p) !== 10 && s.charCodeAt(p) !== 93) p++;
        if (p < n && s.charCodeAt(p) === 93 && p + 1 < n && s.charCodeAt(p + 1) === 40) {
          failedLabelEnd = p;
        }
      }
      pushText('[');
      i++;
      continue;
    }

    // ---- * _ ~ : delimiter runs ------------------------------------
    if (c === 42 || c === 95 || c === 126) {
      let run = 1;
      while (i + run < n && s.charCodeAt(i + run) === c) run++;
      // The mask replaced this run's first character (it sits inside
      // a link label, a code span or an HTML tag): it is literal
      // text, never a delimiter.
      if (masked && masked[i] !== s[i]) {
        pushText(String.fromCharCode(c).repeat(run));
        i += run;
        continue;
      }
      // Inside a failed link label (see above) the delimiters are
      // literal text: marked's emStrong mask hides them there.
      if (failedLabelEnd !== -1 && i < failedLabelEnd) {
        pushText(String.fromCharCode(c).repeat(run));
        i += run;
        continue;
      }
      if (c === 126 && run >= 3) { pushText('~'.repeat(run)); i += run; continue; }
      // the start/end of the string count as whitespace for flanking
      const before = i > 0 ? codePointBefore(s, i) : 10;
      const after = i + run < n ? s.codePointAt(i + run) : 10;
      const beforeWS = isUnicodeSpaceCp(before);
      const afterWS = isUnicodeSpaceCp(after);
      const beforePunct = isUnicodePunctCp(before);
      const afterPunct = isUnicodePunctCp(after);
      const leftFlanking = !afterWS && (!afterPunct || beforeWS || beforePunct);
      const rightFlanking = !beforeWS && (!beforePunct || afterWS || afterPunct);
      let canOpen, canClose;
      if (c === 95) {
        canOpen = leftFlanking && (!rightFlanking || beforePunct);
        canClose = rightFlanking && (!leftFlanking || afterPunct);
      } else {
        canOpen = leftFlanking;
        canClose = rightFlanking;
      }
      pushDelim(String.fromCharCode(c), run, canOpen, canClose, i);
      i += run;
      continue;
    }

    // ---- extended autolinks (www / scheme / email) -----------------
    // Only when not inside a link (inLink): a bare URL/email inside
    // link label text stays literal, while <...> autolinks still form.
    if (!inLink && c === 119 && s.startsWith('www.', i) && canStartExtended(s, i)) {
      const ext = tryExtendedAutolink(s, i, false);
      if (ext) {
        pushNode(makeAutolinkNode(ext.text, ext.href));
        i = ext.end;
        continue;
      }
    }
    if (!inLink && c === 58) {
      // scheme autolink: the buffer must end with a valid scheme
      const sc = matchSchemeSuffix(pending, pendingRaw, s, i);
      if (sc !== -1) {
        const ext = tryExtendedAutolink(s, sc, true);
        if (ext) {
          pending = pending.slice(0, pending.length - (i - sc));
          pushNode(makeAutolinkNode(ext.text, ext.href));
          i = ext.end;
          continue;
        }
      }
    }
    if (!inLink && c === 64) {
      // A trailing '_' run after the domain is an emphasis closer
      // (not a domain char) only when an unmatched '_' opener is
      // pending in the delimiter chain.
      let trimUnd = false;
      for (let d = dLast; d && d !== dHead; d = d.dPrev) {
        if (d.t === 'delim' && d.ch === '_' && d.len > 0 && d.canOpen) { trimUnd = true; break; }
      }
      const em = tryExtendedEmail(s, i, trimUnd);
      if (em) {
        // the local part must be plain text at the end of the pending
        // output (it may span delimiter nodes, e.g. the '_' in
        // a.b-c_d@a.b)
        const localText = s.slice(em.start, i);
        if (stripLocalPart(localText)) {
          pushNode(makeAutolinkNode(em.text, em.href));
          i = em.end;
          continue;
        }
      }
    }

    // ---- ordinary character ----------------------------------------
    pushText(s.charAt(i));
    i++;
  }
  flushPending();
  processEmphasis(head, dHead, s, masked, refs);
  return head;
}

// The last node of a list (null when the list is empty).
function nodeTail(head) {
  let nd = head;
  while (nd.next) nd = nd.next;
  return nd === head ? null : nd;
}

// A link node whose text is plain (used for autolinks: the URL/email is
// shown literally, never re-parsed for inline markup). Marked with
// autolink so a link whose text contains an autolink is still a link
// (only a nested inline/reference link rejects it).
function makeAutolinkNode(text, href) {
  const t = { t: 'text', s: text, next: null, prev: null };
  return { t: 'link', href, title: null, first: t, last: t, next: null, prev: null, autolink: true };
}

// The char before position i must not be a letter, digit or '.' for a
// 'www.' extended autolink to start there.
function canStartExtended(s, i) {
  if (i === 0) return true;
  const c = s.charCodeAt(i - 1);
  return !((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 46);
}

// Autolink <scheme:...> or <email>. Returns {text, href, end} or null.
function tryAutolink(s, i) {
  const n = s.length;
  let p = i + 1;
  while (p < n) {
    const c = s.charCodeAt(p);
    if (c === 32 || c === 10 || c === 60 || c === 62) break;
    p++;
  }
  if (p >= n || s.charCodeAt(p) !== 62) return null;
  const inner = s.slice(i + 1, p);
  if (!inner) return null;
  // scheme: [A-Za-z][A-Za-z0-9+.-]{1,31}: followed by a non-empty rest
  // (cm-598 <a+b+c:d>, cm-601 <localhost:5001/foo>; no '@' or ':/'
  // is required).
  const m = inner.match(/^([A-Za-z][A-Za-z0-9+.-]{1,31}):/);
  if (m) {
    if (inner.length > m[0].length) {
      return { text: inner, href: cleanUrl(inner), end: p + 1 };
    }
    return null;
  }
  // email: must be a valid email address (cm-606: a backslash in the
  // address makes it literal, not a link).
  if (/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(inner)) {
    return { text: inner, href: cleanUrl('mailto:' + inner), end: p + 1 };
  }
  return null;
}

// Extended autolink starting at position i. For 'www.' the href gets an
// 'http://' prefix and the domain must contain a dot; for a scheme the
// href is the text itself and the part after ':' must be non-empty.
// Returns {text, href, end} or null. Not formed while inLink (inside
// an unclosed <a> tag or a link label).
function tryExtendedAutolink(s, i, isScheme) {
  if (inLink) return null;
  const n = s.length;
  let p = i;
  while (p < n) {
    const c = s.charCodeAt(p);
    // stop at whitespace, '<' or '>' (cm-598/601: the '>' ends it)
    if (c === 32 || c === 10 || c === 60 || c === 62) break;
    p++;
  }
  const end = trimAutolinkEnd(s, i, p);
  const text = s.slice(i, end);
  if (!text) return null;
  if (isScheme) {
    const m = text.match(/^([A-Za-z][A-Za-z0-9+.-]{1,31}):(.*)$/);
    if (!m) return null;
    const scheme = m[1];
    const rest = m[2];
    if (!rest) return null;
    // Extended scheme autolinks are restricted (marked's GFM rules):
    // http/https/ftp (case-insensitive) require '://'; mailto/xmpp
    // (lowercase only) take an email, mailto with no path, xmpp with
    // at most one path segment. Any other scheme is not a link
    // (Warning:**, foo:bar, tel: are literal).
    const lower = scheme.toLowerCase();
    if (lower === 'http' || lower === 'https' || lower === 'ftp') {
      if (!rest.startsWith('//') || rest === '//') return null;
      return { text, href: cleanUrl(text), end };
    }
    if (scheme === 'mailto' || scheme === 'xmpp') {
      if (rest.startsWith('//')) return null;
      // The domain ending is judged on the raw (untrimmed) text: a
      // domain ending in '-' or '_' is not a link at all (gfm-633),
      // even though trimAutolinkEnd would strip the '_' and leave a
      // valid-looking domain.
      const rawText = s.slice(i, p);
      const rawM = rawText.match(/^([A-Za-z][A-Za-z0-9+.-]{1,31}):(.*)$/);
      const rawRest = rawM ? rawM[2] : '';
      const rawSlash = rawRest.indexOf('/');
      const rawEmail = rawSlash === -1 ? rawRest : rawRest.slice(0, rawSlash);
      const rawAt = rawEmail.indexOf('@');
      if (rawAt > 0) {
        const rawDomain = rawEmail.slice(rawAt + 1);
        if (rawDomain) {
          const rawLast = rawDomain.charCodeAt(rawDomain.length - 1);
          if (rawLast === 45 || rawLast === 95) return null;
        }
      }
      const slashIdx = rest.indexOf('/');
      const emailPart = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
      const atIdx = emailPart.indexOf('@');
      if (atIdx <= 0) return null;
      const domain = emailPart.slice(atIdx + 1);
      if (!domain || !domain.includes('.')) return null;
      const dLast = domain.charCodeAt(domain.length - 1);
      if (dLast === 45 || dLast === 95) return null;
      if (scheme === 'mailto') {
        // mailto takes no path: the link is just the email
        const newText = text.slice(0, scheme.length + 1 + emailPart.length);
        return { text: newText, href: cleanUrl(newText), end: i + newText.length };
      }
      // xmpp: at most one path segment
      if (slashIdx !== -1) {
        let segEnd = rest.indexOf('/', slashIdx + 1);
        if (segEnd === -1) segEnd = rest.length;
        if (segEnd === slashIdx + 1) {
          const newText = text.slice(0, scheme.length + 1 + slashIdx);
          return { text: newText, href: cleanUrl(newText), end: i + newText.length };
        }
        const newText = text.slice(0, scheme.length + 1 + segEnd);
        return { text: newText, href: cleanUrl(newText), end: i + newText.length };
      }
      return { text, href: cleanUrl(text), end };
    }
    return null;
  }
  if (text.length < 5) return null;
  // must contain a dot in the domain part. The domain is the leading
  // run of domain chars; anything after it (e.g. a trailing '\' in
  // www.flux.com\) belongs to the URL tail, which marked's www regex
  // ([^\s<]*) accepts, so it must not fail domain validation.
  const slash = text.indexOf('/');
  const rawDomain = slash === -1 ? text : text.slice(0, slash);
  const dm = rawDomain.match(/^[A-Za-z0-9._-]+/);
  const domain = dm ? dm[0] : '';
  if (!domain.includes('.')) return null;
  // a label char must follow 'www.' (www.\foo is not a link)
  if (!/^www\.[A-Za-z0-9_-]/.test(domain)) return null;
  return { text, href: cleanUrl('http://' + text), end };
}

// Does the text buffer end with a valid scheme (2-32 chars, starting
// with a letter)? Returns the scheme's start index in the source, or -1.
function matchSchemeSuffix(buf, bufRaw, s, i) {
  if (bufRaw || !buf.length) return -1;
  let k = buf.length;
  while (k > 0) {
    const c = buf.charCodeAt(k - 1);
    if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
      c === 43 || c === 45 || c === 46)) break;
    k--;
  }
  const len = buf.length - k;
  if (len < 2 || len > 32) return -1;
  const first = buf.charCodeAt(k);
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) return -1;
  const start = i - len;
  if (!canStartExtended(s, start)) return -1;
  return start;
}

// marked's _backpedal, applied repeatedly until stable: the
// autolink is the longest prefix of the candidate that segments
// into safe-char runs, balanced (...) pairs, a bare '&', or a run
// of punctuation that is NOT at the end. So a '(' is kept only as
// part of a balanced pair (an unmatched '(' ends the link,
// doc-08/22/36: 'http://x.io)](http://y.io' stops at the '('),
// a trailing ')' is kept only when it closes a '(' pair (a
// trailing ')' after an unmatched earlier ')' is dropped only if
// it has no '(' to close — the count is positional, not total),
// and a trailing '&xxx;' entity is excluded whole (gfm-627).
const BACKPEDAL = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;
function trimAutolinkEnd(s, start, end) {
  let text = s.slice(start, end);
  let prev;
  do {
    prev = text;
    const m = BACKPEDAL.exec(text);
    text = m ? m[0] : '';
  } while (text !== prev);
  return start + text.length;
}
function isAlnum(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isEmailLocalChar(c) {
  // GFM email local part: [A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
    c === 46 || c === 33 || c === 35 || c === 36 || c === 37 || c === 38 ||
    c === 39 || c === 42 || c === 43 || c === 47 || c === 61 || c === 63 ||
    c === 94 || c === 95 || c === 96 || c === 123 || c === 124 || c === 125 ||
    c === 126 || c === 45;
}

// Extended email autolink triggered at the '@' at position i.
// Returns {text, href, end} or null. Not formed while inLink.
function tryExtendedEmail(s, i, trimTrailingUnderscore) {
  if (inLink) return null;
  const n = s.length;
  // scan back for the local part; stop at a '_' that is an emphasis
  // opener: part of a '__' run, or at a boundary (preceded by a
  // non-email char / start of string, e.g. '_a@b.c_' -> local 'a').
  // A '_' between email chars stays part of the address (a.b-c_d@a.b).
  let start = i;
  while (start > 0 && isEmailLocalChar(s.charCodeAt(start - 1))) {
    if (s.charCodeAt(start - 1) === 95) {
      const before = start - 2 >= 0 ? s.charCodeAt(start - 2) : -1;
      if (before === 95 || !isEmailLocalChar(before)) break;
    }
    start--;
  }
  if (start === i) return null; // empty local part
  // local part must not start or end with '.'
  if (s.charCodeAt(start) === 46 || s.charCodeAt(i - 1) === 46) return null;
  // scan forward for the domain
  let p = i + 1;
  while (p < n) {
    const c = s.charCodeAt(p);
    if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 46 || c === 95)) break;
    p++;
  }
  let end = p;
  // A domain ending in '-' or '_' is not a link at all (gfm-632);
  // a trailing '.' is trimmed and the address links.
  // Exception: when the caller confirms a trailing '_' run is an
  // emphasis closer (an unmatched '_' opener is pending), trim the
  // run and link (e.g. __a@b.c__).
  let lastCh = s.charCodeAt(end - 1);
  if (lastCh === 45) return null;
  if (lastCh === 95) {
    if (trimTrailingUnderscore) {
      while (end > i + 1 && s.charCodeAt(end - 1) === 95) end--;
    } else {
      return null;
    }
  }
  while (end > i + 1 && s.charCodeAt(end - 1) === 46) end--;
  let domain = s.slice(i + 1, end);
  if (!domain.includes('.')) return null;
  const labels = domain.split('.');
  for (const lab of labels) {
    if (!lab) return null;
    if (!/^[A-Za-z0-9-]+$/.test(lab)) return null;
  }
  const last = labels[labels.length - 1];
  if (!/^[A-Za-z0-9]/.test(last) || !/[A-Za-z0-9]$/.test(last)) return null;
  const text = s.slice(start, end);
  return { text, href: cleanUrl('mailto:' + text), end, start };
}

// Try to parse a link or image starting at '[' at position i.
// buf is the current text buffer (so a trailing '!' can be consumed).
// Returns {node, end, isImage, buf} or null.
function tryLink(s, i, refs, buf, bufRaw) {
  let isImage = false;
  let baseBuf = buf;
  // An escaped '!' (added to the buffer raw) does not start an image
  // (cm-593: \![foo] is a link, not an image).
  if (!bufRaw && buf.length && buf.charCodeAt(buf.length - 1) === 33) {
    isImage = true;
    baseBuf = buf.slice(0, -1);
  }
  const label = parseLinkLabel(s, i);
  if (!label) return null;
  const after = label.end;
  const n = s.length;

  // inline link: '(' immediately after ']'
  if (after < n && s.charCodeAt(after) === 40) {
    const inl = parseInlineLinkTail(s, after);
    if (inl) {
      return finishLink(s, i, label, inl.dest, inl.title, inl.end, refs, isImage, baseBuf);
    }
  }
  // reference link: '[' label ']'
  if (after < n && s.charCodeAt(after) === 91) {
    const lab2 = parseLinkLabel(s, after);
    // The link text may contain balanced brackets (cm-528, cm-531);
    // only the reference label itself may not (cm-547/548).
    if (lab2 && !hasUnescapedBracket(lab2.text)) {
      const key = lab2.text ? normalizeLabel(lab2.text) : normalizeLabel(label.text);
      const ref = refs.get(key);
      if (ref) {
        return finishLink(s, i, label, ref.dest, ref.title, lab2.end, refs, isImage, baseBuf);
      }
    }
  }
  // shortcut reference: only when the label is not followed by '('
  // or '[' (cm-571: [foo][bar] must not fall back to a shortcut for
  // [foo], and [foo](bar must not either). But when '(' is followed
  // by a ')' (the inline link is closed but invalid, cm-568), the
  // shortcut is tried.
  const followedByOpen = after < n && (s.charCodeAt(after) === 40 || s.charCodeAt(after) === 91);
  const parenClosed = after < n && s.charCodeAt(after) === 40 && s.indexOf(')', after) !== -1;
  if (!followedByOpen || parenClosed) {
    if (!hasUnescapedBracket(label.text)) {
      const key = normalizeLabel(label.text);
      const ref = refs.get(key);
      if (ref) {
        return finishLink(s, i, label, ref.dest, ref.title, after, refs, isImage, baseBuf);
      }
    }
  }
  return null;
}

// Build the link/image node from a parsed label + destination.
// Returns {node, end, isImage, buf} or null (when the label contains a link).
function finishLink(s, i, label, dest, title, end, refs, isImage, baseBuf) {
  // Parse the label with inLink set (marked's link() sets it while
  // tokenizing the label text, so bare extended autolinks do not form
  // there), then restore it: <a> tags inside the label must not leak
  // their inLink change into the surrounding text.
  const savedInLink = inLink;
  inLink = true;
  const inner = parseInlineNodes(label.text, refs);
  inLink = savedInLink;
  if (!isImage && containsLink(inner)) return null;
  if (isImage) {
    const alt = plainText(inner);
    const node = { t: 'image', src: dest, alt, title, next: null, prev: null };
    return { node, end, isImage: true, buf: baseBuf };
  }
  const node = { t: 'link', href: dest, title, first: inner.next, last: nodeTail(inner), next: null, prev: null };
  return { node, end, isImage: false, buf: baseBuf };
}

// True when a node list holds a (non-autolink) link, at any depth.
function containsLink(head) {
  let nd = head.next;
  while (nd) {
    if (nd.t === 'link' && !nd.autolink) return true;
    if (nd.t === 'em' || nd.t === 'strong' || nd.t === 'del') {
      if (containsLinkRange(nd.first, nd.last)) return true;
    }
    nd = nd.next;
  }
  return false;
}

function containsLinkRange(first, last) {
  let nd = first;
  while (nd) {
    if (nd.t === 'link' && !nd.autolink) return true;
    if (nd.t === 'em' || nd.t === 'strong' || nd.t === 'del') {
      if (containsLinkRange(nd.first, nd.last)) return true;
    }
    if (nd === last) break;
    nd = nd.next;
  }
  return false;
}

// Plain text of a node list (for image alt text).
function plainText(head) {
  let out = '';
  let nd = head.next;
  while (nd) {
    out += plainTextNode(nd);
    nd = nd.next;
  }
  return out;
}

// Plain text of one node (for image alt text).
function plainTextNode(nd) {
  switch (nd.t) {
    case 'text': return nd.s;
    case 'raw': return nd.s;
    case 'code': return nd.s;
    case 'html': return nd.s;
    case 'br': return ' ';
    case 'soft': return ' ';
    case 'delim': return nd.ch.repeat(nd.len);
    case 'em': case 'strong': case 'del': {
      let out = '';
      let c = nd.first;
      while (c) {
        out += plainTextNode(c);
        if (c === nd.last) break;
        c = c.next;
      }
      return out;
    }
    case 'link': {
      let out = '';
      let c = nd.first;
      while (c) {
        out += plainTextNode(c);
        if (c === nd.last) break;
        c = c.next;
      }
      return out;
    }
    case 'image': return nd.alt;
    default: return '';
  }
}

/* ------------------------------------------------------------------ */
/* Emphasis processing (delimiter-stack algorithm)                     */
/* ------------------------------------------------------------------ */

// Resolve emphasis/strong/strikethrough in the node list using the
// CommonMark delimiter-stack algorithm. Delimiters left unmatched stay
// as literal text.

const RDELIM_AST = /^[^_*]*?__[^_*]*?\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\*)(?!~)[\p{P}\p{S}](\*+)(?=[\s]|$)|(?:[^\s\p{P}\p{S}]|~)(\*+)(?!\*)(?=(?!~)[\s\p{P}\p{S}]|$)|(?!\*)(?!~)[\s\p{P}\p{S}](\*+)(?=(?:[^\s\p{P}\p{S}]|~))|[\s](\*+)(?!\*)(?=(?!~)[\p{P}\p{S}])|(?!\*)(?!~)[\p{P}\p{S}](\*+)(?!\*)(?=(?!~)[\p{P}\p{S}])|(?:[^\s\p{P}\p{S}]|~)(\*+)(?=(?:[^\s\p{P}\p{S}]|~))/gu;
const RDELIM_UND = /^[^_*]*?\*\*[^_*]*?_[^_*]*?(?=\*\*)|[^_]+(?=[^_])|(?!_)[\p{P}\p{S}](_+)(?=[\s]|$)|[^\s\p{P}\p{S}](_+)(?!_)(?=[\s\p{P}\p{S}]|$)|(?!_)[\s\p{P}\p{S}](_+)(?=[^\s\p{P}\p{S}])|[\s](_+)(?!_)(?=[\p{P}\p{S}])|(?!_)[\p{P}\p{S}](_+)(?!_)(?=[\p{P}\p{S}])/gu;

/* ------------------------------------------------------------------ */
/* Emphasis resolution — opener-driven, following marked 18.1.3.       */
/*                                                                    */
/* marked's emStrong is opener-driven: each `*`/`_` opener scans    */
/* forward for its closer with m/f accounting and the rule of 3, and  */
/* the leftover opener/closer lengths land INSIDE the wrapper, where  */
/* the inner text is re-parsed (so `***foo***` is <em><strong>).     */
/* The closer scan runs marked's own RDelim regexes over the masked  */
/* text, so the skip alternatives (a `*` inside `__...__`, and vice  */
/* versa) behave exactly like marked. When a multi-char opener run   */
/* cannot match as a whole, the scan retries it one char shorter,    */
/* mirroring marked's text tokenizer consuming the first char.        */
/* `~` (del) keeps the older closer-driven pass.                       */
/* ------------------------------------------------------------------ */

// Flanking of a delimiter run from its neighbouring code points
// (CommonMark rules; -1 counts as whitespace, i.e. a list boundary).
function delimFlanking(ch, beforeCp, afterCp) {
  const beforeWS = beforeCp === -1 || isUnicodeSpaceCp(beforeCp);
  const afterWS = afterCp === -1 || isUnicodeSpaceCp(afterCp);
  const beforePunct = beforeCp !== -1 && isUnicodePunctCp(beforeCp);
  const afterPunct = afterCp !== -1 && isUnicodePunctCp(afterCp);
  const leftFlanking = !afterWS && (!afterPunct || beforeWS || beforePunct);
  const rightFlanking = !beforeWS && (!beforePunct || afterWS || afterPunct);
  let canOpen, canClose;
  if (ch === '_') {
    canOpen = leftFlanking && (!rightFlanking || beforePunct);
    canClose = rightFlanking && (!leftFlanking || afterPunct);
  } else {
    canOpen = leftFlanking;
    canClose = rightFlanking;
  }
  return { canOpen, canClose };
}

// The last index of a `*`/`_` run whose char before is not whitespace
// (marked's `fe`, run on the masked text). The closer scan never
// looks past this index.
function lastPossibleCloser(masked) {
  const res = { '*': -1, '_': -1 };
  const n = masked.length;
  for (let s = 0; s < n; s++) {
    const r = masked[s];
    if (r !== '*' && r !== '_') continue;
    const o = s === 0 ? '\n' : masked[s - 1];
    let i = s + 1;
    for (; i < n && masked[i] === r;) i++;
    if (o !== ' ' && o !== '\t' && o !== '\n' && o !== '\r' && o !== '\f') {
      res[r] = s;
    }
    s = i - 1;
  }
  return res;
}

// Scan forward from opener `op` for its closer (marked's emStrong
// scan, running the RDelim regexes over the masked text). `s` is the
// paragraph text, `masked` its masked copy. Returns
// {closer, bAdj, use, j} or null, where `j` is how many chars of the
// opener run were left literal before the matching (shorter) opener.
function findEmStrongCloser(op, s, masked) {
  const ch = op.ch;
  const k = op.len;
  const pos = op.pos;
  const chCp = ch.charCodeAt(0);
  // Run start: walk back over the same char in the masked text.
  let runStart = pos;
  while (runStart > 0 && masked.charCodeAt(runStart - 1) === chCp) runStart--;
  // Char before the run (masked text), or -1.
  const pCp = runStart > 0 ? codePointBefore(masked, runStart) : -1;
  const pStr = pCp === -1 ? '' : String.fromCodePoint(pCp);
  const h = pCp !== -1 && (isUnicodeSpaceCp(pCp) || isUnicodePunctCp(pCp));
  // Char before the opener: the last char of the previous plain-text
  // node, or '' when the previous token was not plain text.
  let nStr = '';
  if (op.prev && op.prev.t === 'text' && op.prev.s.length) {
    const pv = op.prev.s;
    nStr = String.fromCodePoint(codePointBefore(pv, pv.length));
  }
  const o0 = nStr !== '' && nStr === ch;
  // Punctuation after the opener run (original text, excluding '~').
  const afterCp = (pos + k < s.length) ? s.codePointAt(pos + k) : -1;
  const d = (afterCp !== -1 && afterCp !== 126 && isUnicodePunctCp(afterCp)) ? String.fromCodePoint(afterCp) : '';
  const nCp = nStr === '' ? -1 : nStr.codePointAt(0);
  // n / u for the full run (j = 0): when the opener sits inside a
  // run, n is the char before the run and u is h.
  const n0 = runStart < pos ? pStr : nStr;
  const u0 = runStart < pos ? h : (nCp !== -1 && nCp !== 42 && nCp !== 95 && (isUnicodeSpaceCp(nCp) || isUnicodePunctCp(nCp)));
  const y = (pos - runStart) + k;
  const R = pCp !== -1 && !isUnicodeSpaceCp(pCp) && (d !== '' || (ch === '*' && !h));
  // Collect the RDelim matches on the masked text after the run.
  // The scan start (just past the run) and the bound are the same
  // for every retry, so the matches are collected once.
  const v = lastPossibleCloser(masked)[ch];
  const Q = pos + k;
  if (v < Q) return null;
  const scanText = masked.slice(Q);
  const ee = v - Q;
  const re = new RegExp(ch === '*' ? RDELIM_AST.source : RDELIM_UND.source, 'gu');
  const rawMatches = [];
  let mm2;
  re.lastIndex = 0;
  while ((mm2 = re.exec(scanText)) !== null && !(mm2.index > ee)) {
    const g = mm2[1] || mm2[2] || mm2[3] || mm2[4] || mm2[5] || mm2[6];
    if (!g) continue; // skip alternative: consumes text, no run
    const b = [...g].length;
    let cls;
    if (mm2[3] || mm2[4]) cls = 'open';
    else if (mm2[5] || mm2[6]) cls = 'both';
    else cls = 'close';
    const te = [...mm2[0]][0].length;
    rawMatches.push({ cls, b, runPos: Q + mm2.index + te });
  }
  // Keep only the matches that name a delimiter node in the chain
  // (a run the inline parser kept as a delimiter, with the same
  // length). The chain is walked once from the opener onward.
  const byPos = new Map();
  let nd = op.dNext;
  while (nd) {
    if (nd.ch === ch && !byPos.has(nd.pos)) byPos.set(nd.pos, nd);
    nd = nd.dNext;
  }
  const matches = [];
  for (const cand of rawMatches) {
    const node = byPos.get(cand.runPos);
    if (node && node.len === cand.b) matches.push({ cls: cand.cls, b: cand.b, node });
  }
  // Try the opener run, then shorter runs (a failed opener retries
  // one char shorter, the leading char having become literal text).
  // y and R are the same for every retry; only the length, o, n and
  // u change.
  for (let j = 0; j < k; j++) {
    const kj = k - j;
    const oj = j === 0 ? o0 : true;
    const nj = j === 0 ? n0 : pStr;
    const uj = j === 0 ? u0 : h;
    const njCp = nj === '' ? -1 : nj.codePointAt(0);
    // The `_` gate (per retry).
    if (ch === '_' && afterCp !== -1 && !isUnicodeSpaceCp(afterCp) && njCp !== -1 && isWordChar(njCp)) continue;
    // Enter matching only when there is no punct after the opener, or
    // no char before it, or a punct char before it.
    if (d !== '' && nj !== '' && !uj) continue;
    let m = kj, f = 0;
    let broke = false;
    for (const cand of matches) {
      const b = cand.b;
      if (cand.cls === 'open') {
        m += b;
        continue;
      }
      const both = cand.cls === 'both';
      if (both && oj) { broke = true; break; }
      if ((both || R) && y % 3 !== 0 && (y + b) % 3 === 0) {
        f += b;
        continue;
      }
      m -= b;
      if (m <= 0) {
        const bAdj = Math.min(b, b + m + f);
        const use = (Math.min(kj, bAdj) % 2 === 1) ? 1 : 2;
        return { closer: cand.node, bAdj, use, j };
      }
    }
    void broke;
  }
  return null;
}

// Wrap opener `op` with closer `cl` (using bAdj of its run, `use`
// delimiters) into an em/strong node. `j` chars of the opener run
// stay literal text before the wrapper. The inner text is the source
// slice between the used delimiters, re-parsed from scratch (marked
// re-parses the inner text, so leftover delimiters land inside and
// form nested spans). The excess closer (b - bAdj) stays outside as
// a delimiter node after the wrapper. Returns the delimiter node to
// resume the outer scan from (the excess closer, or the next
// delimiter after the closer), or null.
function wrapEmStrong(op, cl, bAdj, use, j, head, dHead, s, masked, refs) {
  const ch = op.ch;
  const type = use === 1 ? 'em' : 'strong';
  const b = cl.len;
  const excessCl = b - bAdj;
  const afterCloser = cl.next;
  const beforeOpener = op.prev;
  const prevBeforeOpener = op.dPrev;
  const nextAfterCloser = cl.dNext;
  const effPos = op.pos + j;
  // Re-parse the inner text from scratch: the source slice between
  // the used delimiters. Leftover opener/closer lengths are inside
  // this slice, so they form nested spans when re-parsed.
  const innerText = s.slice(effPos + use, cl.pos + bAdj - use);
  let wrapFirst = null, wrapLast = null;
  if (innerText.length) {
    const innerHead = parseInlineNodes(innerText, refs);
    wrapFirst = innerHead.next;
    if (wrapFirst) {
      wrapLast = wrapFirst;
      while (wrapLast.next) wrapLast = wrapLast.next;
    }
  }
  const wrap = { t: type, ch, first: wrapFirst, last: wrapLast, next: null, prev: null };
  // Excess closer: a delimiter node after the wrapper, in the outer
  // list. Its char before is the delimiter itself; its char after is
  // the char after the original run.
  let excessNode = null;
  if (excessCl > 0) {
    const afterCp = (cl.pos + b < s.length) ? s.codePointAt(cl.pos + b) : -1;
    const f2 = delimFlanking(ch, ch.charCodeAt(0), afterCp);
    excessNode = { t: 'delim', ch, len: excessCl, canOpen: f2.canOpen, canClose: f2.canClose, pos: cl.pos + bAdj, next: null, prev: null, dNext: null, dPrev: null };
  }
  // Splice the wrapper (and the literal prefix and excess node) into
  // the outer list.
  if (j > 0) {
    const lit = { t: 'text', s: ch.repeat(j), next: wrap, prev: beforeOpener };
    wrap.prev = lit;
    if (beforeOpener === head) { head.next = lit; } else { beforeOpener.next = lit; }
  } else {
    wrap.prev = beforeOpener;
    if (beforeOpener === head) { head.next = wrap; } else { beforeOpener.next = wrap; }
  }
  if (excessNode) {
    wrap.next = excessNode;
    excessNode.prev = wrap;
    excessNode.next = afterCloser;
    if (afterCloser) afterCloser.prev = excessNode;
  } else {
    wrap.next = afterCloser;
    if (afterCloser) afterCloser.prev = wrap;
  }
  // Fix the outer delimiter chain: the opener, the closer and every
  // delimiter between them leave it; the excess node (if any) takes
  // the closer's place.
  if (excessNode) {
    excessNode.dPrev = prevBeforeOpener;
    excessNode.dNext = nextAfterCloser;
    if (prevBeforeOpener) prevBeforeOpener.dNext = excessNode;
    if (nextAfterCloser) nextAfterCloser.dPrev = excessNode;
  } else {
    if (prevBeforeOpener) prevBeforeOpener.dNext = nextAfterCloser;
    if (nextAfterCloser) nextAfterCloser.dPrev = prevBeforeOpener;
  }
  return excessNode || nextAfterCloser;
}

// Opener-driven `*`/`_` pass (marked's emStrong). Walks the delimiter
// chain in order; each opener scans forward for its closer.
function processStarUnderscore(head, dHead, s, masked, refs) {
  let op = dHead.dNext;
  while (op) {
    if (op.ch === '~' || !op.canOpen) { op = op.dNext; continue; }
    const m = findEmStrongCloser(op, s, masked);
    if (!m) { op = op.dNext; continue; }
    op = wrapEmStrong(op, m.closer, m.bAdj, m.use, m.j, head, dHead, s, masked, refs);
  }
}

// Closer-driven `~` pass (del), kept from the earlier implementation:
// a `~` closer looks back for a `~` opener with the odd-match rule.
// The inner text is re-parsed from scratch (marked re-parses a del's
// inner text, so a `**` inside a del forms a strong even when the
// outer context hides its closer). Leftover lengths stay outside as
// delimiter nodes.
function processTildes(head, dHead, s, masked, refs) {
  let closer = dHead.dNext;
  while (closer) {
    if (closer.ch !== '~' || !closer.canClose) { closer = closer.dNext; continue; }
    let opener = closer.dPrev;
    let found = null;
    while (opener && opener !== dHead) {
      if (opener.ch === '~' && opener.canOpen) {
        const eitherBoth = (opener.canOpen && opener.canClose) ||
          (closer.canOpen && closer.canClose);
        if (eitherBoth && (opener.len + closer.len) % 3 === 0 &&
            (opener.len % 3 !== 0 || closer.len % 3 !== 0)) {
          opener = opener.dPrev;
          continue;
        }
        found = opener;
        break;
      }
      opener = opener.dPrev;
    }
    if (!found) { closer = closer.dNext; continue; }
    const use = (found.len >= 2 && closer.len >= 2) ? 2 : 1;
    // Re-parse the inner text from scratch: the source slice between
    // the two runs. (Marked re-parses a del's inner text.)
    const innerText = s.slice(found.pos + found.len, closer.pos);
    let wrapFirst = null, wrapLast = null;
    if (innerText.length) {
      const innerHead = parseInlineNodes(innerText, refs);
      wrapFirst = innerHead.next;
      if (wrapFirst) {
        wrapLast = wrapFirst;
        while (wrapLast.next) wrapLast = wrapLast.next;
      }
    }
    const wrap = { t: 'del', ch: '~', first: wrapFirst, last: wrapLast, next: null, prev: null };
    found.len -= use;
    closer.len -= use;
    if (closer.len > 0) closer.pos += use;
    // Remove the delimiters strictly between the opener and closer
    // from the delimiter chain: they are now inside the del span.
    let d = found.dNext;
    while (d && d !== closer) {
      const nxt = d.dNext;
      if (d.dPrev) d.dPrev.dNext = d.dNext;
      if (d.dNext) d.dNext.dPrev = d.dPrev;
      d = nxt;
    }
    const nextCloser = closer.dNext;
    if (found.len > 0) {
      wrap.prev = found;
      found.next = wrap;
    } else {
      wrap.prev = found.prev;
      found.prev.next = wrap;
      if (found.dPrev) found.dPrev.dNext = found.dNext;
      if (found.dNext) found.dNext.dPrev = found.dPrev;
    }
    if (closer.len > 0) {
      wrap.next = closer;
      closer.prev = wrap;
    } else {
      wrap.next = closer.next;
      if (closer.next) closer.next.prev = wrap;
      if (closer.dPrev) closer.dPrev.dNext = closer.dNext;
      if (closer.dNext) closer.dNext.dPrev = closer.dPrev;
    }
    closer = closer.len > 0 ? closer : nextCloser;
  }
}

// Entry point: resolve emphasis in the node list starting at
// head.next, whose delimiter chain starts at dHead.
function processEmphasis(head, dHead, s, masked, refs) {
  processStarUnderscore(head, dHead, s, masked, refs);
  processTildes(head, dHead, s, masked, refs);
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

// Render an inline node list (starting after `head`) to HTML.
function renderInlineNodes(head, refs) {
  let out = '';
  let nd = head.next;
  while (nd) {
    out += renderInlineNode(nd, refs);
    nd = nd.next;
  }
  return out;
}

// Render the inline nodes from `first` through `last` (inclusive).
function renderInlineRange(first, last, refs) {
  let out = '';
  let nd = first;
  while (nd) {
    out += renderInlineNode(nd, refs);
    if (nd === last) break;
    nd = nd.next;
  }
  return out;
}

// Render one inline node to HTML.
function renderInlineNode(nd, refs) {
  switch (nd.t) {
    case 'text': return escapeHtml(nd.s, false);
    case 'raw': return nd.s;
    case 'delim': return nd.ch.repeat(nd.len);
    case 'code': return '<code>' + escapeHtml(nd.s, true) + '</code>';
    case 'html': return nd.s;
    case 'br': return '<br>';
    case 'soft': return '\n';
    case 'em': return '<em>' + renderInlineRange(nd.first, nd.last, refs) + '</em>';
    case 'strong': return '<strong>' + renderInlineRange(nd.first, nd.last, refs) + '</strong>';
    case 'del': return '<del>' + renderInlineRange(nd.first, nd.last, refs) + '</del>';
    case 'link': {
      let out = '<a href="' + escapeHtml(nd.href, false) + '"';
      if (nd.title !== null && nd.title !== undefined) {
        out += ' title="' + escapeHtml(nd.title, false) + '"';
      }
      out += '>' + renderInlineRange(nd.first, nd.last, refs) + '</a>';
      return out;
    }
    case 'image': {
      let out = '<img src="' + escapeHtml(nd.src, false) + '" alt="' + escapeHtml(nd.alt, false) + '"';
      if (nd.title !== null && nd.title !== undefined) {
        out += ' title="' + escapeHtml(nd.title, false) + '"';
      }
      return out + '>';
    }
    default: return '';
  }
}

// Parse inline text and render it to HTML.
function renderInline(text, refs) {
  if (!text) return '';
  const head = parseInlineNodes(text, refs);
  return renderInlineNodes(head, refs);
}

// Render one table cell (header or body) to HTML.
function renderTableCell(cell, align, tag, refs) {
  return '<' + tag + (align ? ' align="' + align + '"' : '') + '>' +
    renderInline(cell.trim(), refs) + '</' + tag + '>\n';
}

// Render a block. `tight` is true when the block sits inside a tight
// list item (paragraphs then render without <p> tags).
function renderBlock(blk, refs, tight) {
  switch (blk.t) {
    case 'document': {
      let out = '';
      for (const c of blk.children) out += renderBlock(c, refs, false);
      return out;
    }
    case 'paragraph': {
      let text = blk.literal;
      let checkbox = '';
      if (blk.inItem) {
        // A task list item: '[ ]' or '[x]' followed by whitespace and
        // non-empty text. The output is the checkbox plus exactly one
        // space, however many spaces followed it (gfm-279/280).
        const m = text.match(/^\[([ xX])\][ \t]+/);
        if (m) {
          const rest = text.slice(m[0].length);
          if (rest.trim().length) {
            checkbox = (m[1] === ' '
              ? '<input disabled="" type="checkbox">'
              : '<input checked="" disabled="" type="checkbox">') + ' ';
            text = rest;
          }
        }
      }
      const inner = checkbox + renderInline(text, refs);
      return tight ? inner : '<p>' + inner + '</p>\n';
    }
    case 'heading': {
      return '<h' + blk.level + '>' + renderInline(blk.literal, refs) + '</h' + blk.level + '>\n';
    }
    case 'code_block': {
      let out = '<pre><code';
      if (blk.fenced && blk.info) {
        const lang = blk.info.split(/[ \t]/)[0];
        if (lang) out += ' class="language-' + escapeHtml(lang, false) + '"';
      }
      return out + '>' + escapeHtml(blk.literal, true) + '</code></pre>\n';
    }
    case 'html_block': {
      return blk.literal;
    }
    case 'blockquote': {
      // The tight flag applies only to paragraphs that are direct
      // children of a list item; a blockquote's children always render
      // with their own block tags (cm-292/293/321).
      let out = '<blockquote>\n';
      for (const c of blk.children) out += renderBlock(c, refs, false);
      return out + '</blockquote>\n';
    }
    case 'list': {
      let out;
      if (blk.bullet) out = '<ul>\n';
      else {
        out = '<ol';
        if (blk.start !== 1) out += ' start="' + blk.start + '"';
        out += '>\n';
      }
      for (const item of blk.children) out += renderItem(item, refs, blk.tight);
      return out + (blk.bullet ? '</ul>\n' : '</ol>\n');
    }
    case 'thematic_break': {
      return '<hr>\n';
    }
    case 'table': {
      let out = '<table>\n<thead>\n<tr>\n';
      for (let i = 0; i < blk.headerCells.length; i++) {
        out += renderTableCell(blk.headerCells[i], blk.align[i], 'th', refs);
      }
      out += '</tr>\n</thead>\n';
      if (blk.rows.length) {
        out += '<tbody>';
        for (const row of blk.rows) {
          out += '<tr>\n';
          for (let i = 0; i < row.length; i++) {
            out += renderTableCell(row[i], blk.align[i], 'td', refs);
          }
          out += '</tr>\n';
        }
        out += '</tbody>';
      }
      return out + '</table>\n';
    }
    default:
      return '';
  }
}

// Render a list item: its children, with paragraphs flagged so a task
// checkbox is recognised.
function renderItem(item, refs, tight) {
  let out = '<li>';
  for (const child of item.children) {
    if (child.t === 'paragraph') child.inItem = true;
    out += renderBlock(child, refs, tight);
  }
  return out + '</li>\n';
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

// Render markdown to HTML, byte-compatible with marked 18.1.3
// (default options). A fresh parser is built for every call; no state
// is carried between calls.
export function parse(markdown) {
  inLink = false;
  const parser = new Parser();
  const doc = parser.parse(markdown);
  return renderBlock(doc, parser.refs, false);
}