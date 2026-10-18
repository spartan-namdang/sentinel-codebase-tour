#!/usr/bin/env python3
"""Check deck/index.html against the deck rules.

Hard rules (exit code 1 when broken):
  - at most 40 slides, all on one horizontal line (no nested sections)
  - every slide has speaker notes in two parts: <h4>Dàn ý</h4> followed by a
    list, then <h4>Full note</h4> followed by paragraphs
  - no hard-coded colours and no style="..." in the slides (tokens live in css/deck.css)
  - animated diagrams: every data-along points at a path that exists, element
    ids are unique, and every fragment with data-scene has a matching scene group

Reported, not fatal:
  - main-text lines per slide and words per line ("main text" is <li> and <p>
    in the slide body; titles, tables, code, diagrams, example sheets and notes are not counted)

Layout (overflow, code wider than its box, content reaching the footer) needs a
browser: open the deck and run Deck.audit() in the console. It must return [].

Usage:  python3 tools/check_slides.py          (run from the repo root)
"""
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DECK = ROOT / "deck" / "index.html"

MAX_SLIDES = 40
SOFT_LINES = 8
SOFT_WORDS = 14

SKIP_TAGS = {"table", "pre", "svg", "aside", "header", "figure", "footer"}
SKIP_CLASSES = {"eyebrow", "chips", "chip", "cover-meta", "card-kicker", "part-num", "prompt", "brand", "ex-modal"}
LINE_TAGS = {"li", "p"}
VOID = {"img", "br", "hr", "meta", "link", "input", "use", "path", "rect", "circle"}


class Deck(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.slides = []
        self.stack = []
        self.cur = None
        self.depth = 0
        self.nested = 0
        self.line = None
        self.in_notes = False
        self.note_tag = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        classes = set((a.get("class") or "").split())
        if tag == "section":
            self.depth += 1
            if self.depth > 1:
                self.nested += 1
            self.cur = {"lines": [], "eyebrow": "", "title": "", "notes": [], "frag_scenes": set(), "scenes": set()}
            self.slides.append(self.cur)
        if self.cur is None or tag in VOID:
            return
        if tag == "aside" and "notes" in classes:
            self.in_notes = True
        if self.in_notes and tag in ("h4", "ul", "ol", "p"):
            self.cur["notes"].append([tag, ""])
        if "fragment" in classes and a.get("data-scene"):
            self.cur["frag_scenes"].add(a["data-scene"])
        if tag == "g" and a.get("data-scene"):
            self.cur["scenes"].add(a["data-scene"])
        parent_skip = self.stack[-1][1] if self.stack else False
        skip = parent_skip or tag in SKIP_TAGS or bool(classes & SKIP_CLASSES)
        is_line = (not skip) and tag in LINE_TAGS and self.line is None
        if is_line:
            self.line = []
        capture = None
        if tag == "p" and "eyebrow" in classes:
            capture = "eyebrow"
        elif tag in ("h1", "h2"):
            capture = "title"
        self.stack.append((tag, skip, is_line, capture))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if tag == "section":
            self.depth -= 1
            self.cur = None
            self.stack = []
            self.line = None
            return
        if tag == "aside":
            self.in_notes = False
        while self.stack:
            t, _skip, is_line, _cap = self.stack.pop()
            if is_line and self.line is not None:
                text = " ".join("".join(self.line).split())
                if text:
                    self.cur["lines"].append(text)
                self.line = None
            if t == tag:
                break

    def handle_data(self, data):
        if self.cur is None or not self.stack:
            return
        if self.in_notes and self.cur["notes"]:
            self.cur["notes"][-1][1] += data
        for _t, _s, _l, cap in reversed(self.stack):
            if cap:
                self.cur[cap] += data
                break
        if self.line is not None and not self.stack[-1][1]:
            self.line.append(data)


def words(text):
    return [w for w in re.split(r"\s+", text) if re.search(r"\w", w)]


def notes_ok(notes):
    """Dàn ý heading, then a list; Full note heading, then at least one paragraph."""
    kinds = [k for k, _ in notes]
    heads = [(i, " ".join(t.split())) for i, (k, t) in enumerate(notes) if k == "h4"]
    if [h for _, h in heads] != ["Dàn ý", "Full note"]:
        return "headings must be exactly 'Dàn ý' then 'Full note'"
    outline_at, full_at = heads[0][0], heads[1][0]
    if not any(k in ("ul", "ol") for k in kinds[outline_at + 1:full_at]):
        return "'Dàn ý' has no list"
    if "p" not in kinds[full_at + 1:]:
        return "'Full note' has no paragraph"
    return None


def main():
    html = DECK.read_text(encoding="utf-8")
    deck = Deck()
    deck.feed(html)
    slides = deck.slides
    hard = []

    print(f"Slides: {len(slides)} (limit {MAX_SLIDES})")
    if len(slides) > MAX_SLIDES:
        hard.append(f"{len(slides)} slides, limit is {MAX_SLIDES}")
    if deck.nested:
        hard.append(f"{deck.nested} nested (vertical) section(s)")

    print("\n  #  lines  max-words  slide")
    for i, s in enumerate(slides, 1):
        counts = [len(words(l)) for l in s["lines"]]
        n, mw = len(counts), max(counts, default=0)
        label = " ".join((s["eyebrow"] or s["title"]).split())[:58]
        flag = ""
        if n > SOFT_LINES:
            flag += "  < many lines"
        if mw > SOFT_WORDS:
            flag += "  < long line"
        print(f"{i:3}  {n:5}  {mw:9}  {label}{flag}")
        problem = notes_ok(s["notes"]) if s["notes"] else "no speaker notes"
        if problem:
            hard.append(f"slide {i} ({label}): {problem}")
        missing = s["frag_scenes"] - s["scenes"]
        if missing:
            hard.append(f"slide {i} ({label}): fragment scene(s) without a <g data-scene>: {sorted(missing)}")

    # animated diagrams: ids unique, every data-along target exists
    ids = re.findall(r'\sid="([^"]+)"', html)
    dupes = sorted({x for x in ids if ids.count(x) > 1})
    if dupes:
        hard.append(f"duplicate ids: {dupes}")
    targets = set(re.findall(r'data-along="#([^"]+)"', html))
    dangling = sorted(targets - set(ids))
    if dangling:
        hard.append(f"data-along points at missing paths: {dangling}")
    print(f"\nAnimated paths referenced: {len(targets)}   ids: {len(ids)}")

    # hard-coded colours and inline styles in the slides (notes, code and comments excluded)
    body = html.split('<div class="reveal">', 1)[-1]
    body = re.sub(r"<aside.*?</aside>|<pre.*?</pre>|<!--.*?-->", "", body, flags=re.S)
    colours = re.findall(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(", re.sub(r'href="#[^"]*"|data-along="#[^"]*"', "", body))
    inline = re.findall(r'style="[^"]*"', body)
    if colours:
        hard.append(f"hard-coded colours in slides: {sorted(set(colours))}")
    if inline:
        hard.append(f"inline styles in slides: {len(inline)}")
    print(f"Hard-coded colours in slides: {len(colours)}   inline styles: {len(inline)}")

    if hard:
        print("\nFAILED:")
        for h in hard:
            print("  - " + h)
        return 1
    print("\nOK  (layout: run Deck.audit() in the browser, it must return [])")
    return 0


if __name__ == "__main__":
    sys.exit(main())
