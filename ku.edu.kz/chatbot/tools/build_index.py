#!/usr/bin/env python3
"""
Индексатор сайта СКГУ (ku.edu.kz) для ИИ-помощника.

Обходит локальное зеркало страниц, вытаскивает из каждой страницы:
  - оригинальный URL (из HTTrack-комментария "Mirrored from ..."),
  - заголовок,
  - видимый текст,
и собирает поисковый индекс (BM25) в chatbot/data/index.json.

Запуск:  python3 chatbot/tools/build_index.py
"""
import json
import math
import re
import sys
import time
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # .../Sites/ku-frontend
OUT = Path(__file__).resolve().parent.parent / "data"
OUT.mkdir(parents=True, exist_ok=True)

TREES = [
    "ku.edu.kz",
    "apply.ku.edu.kz",
    "astra.ku.edu.kz",
    "dormitories.ku.edu.kz",
    "mba.ku.edu.kz",
    "is.ku.edu.kz",
]

SKIP_DIRS = {
    "assets", "static", "img", "images", "files", "node_modules", "src",
    "slide", "fls", "new_galleries", "_libs", "theme", "rss", "atom",
    "font", "fonts", "video", "icons", "media", "data",
}
SKIP_NAME = re.compile(
    r"(^login|^gtm|^analytics|^robots|\.htm$|favicon|404|error)",
    re.IGNORECASE,
)
MIRROR_MARK = re.compile(r"<!--\s*Mirrored from ([^\s>]+) by HTTrack", re.IGNORECASE)
SUFFIX = re.compile(r"([0-9a-f]{4,})(?=\.html?($|\?|#))", re.IGNORECASE)

ALLOWED_HOST = re.compile(r"(^|\.|//)(apply\.|astra\.|dormitories\.|mba\.|is\.)?(ku\.edu\.kz)([:/]|$)",
                          re.IGNORECASE)

MIN_TEXT_LEN = 150

STOP = set("""
a an the and or of to in on at for with by from as is are was were be been being it its this
that these those не ни и но или же ли что чтобы как это этот эта эти указанных указанного
которые который которое при о у к из от до по за на с без а также http https www com kz html
page view index ru list detail id s b i p div span class href title
""".split())

SUF = ("иями", "ями", "ями", "мов", "ова", "ует", "али", "ами", "ого", "его", "ому", "ему",
       "ыми", "ими", "ому", "ать", "ять", "еть", "уть", "ными", "кий", "кая", "ое", "ее",
       "ые", "ий", "ая", "ую", "юю", "ом", "ем", "ах", "ях", "ов", "ев", "ой", "ей",
       "ам", "ям", "ум", "ым", "их", "ых", "ую", "ий", "ья", "ье", "ию", "ея",
       "тся", "ться", "еть", "ит", "ат", "ят", "ют", "ет", "ла", "ло", "ли", "ны", "на",
       "ть", "ся", "ой", "ий", "ая", "ое", "ые", "ом", "ем", "um", "ер", "es", "ed")


def stem(w: str) -> str:
    """Лёгкая нормализация словоформы (для склейки форм одного слова)."""
    if len(w) <= 4:
        return w
    changed = True
    while changed and len(w) > 4:
        changed = False
        for s in SUF:
            if w.endswith(s) and len(w) - len(s) >= 3:
                w = w[: -len(s)]
                changed = True
                break
    return w[: len(w)][:7] if len(w) > 7 else w


TOKEN_RE = re.compile(r"[0-9a-zA-Zа-яА-ЯёЁ]{3,}", re.UNICODE)


def tokenize(text, for_index=False):
    out = []
    for raw in TOKEN_RE.findall(text.lower()):
        if raw in STOP:
            continue
        s = stem(raw)
        if not s:
            continue
        out.append(s)
    return out


class TextExtract(HTMLParser):
    """Достаёт <title> и видимый текст (без хедера/футера/скриптов)."""

    # теги, содержимое которых не считаем полезным текстом
    SKIP_TAGS = {"script", "style", "noscript", "svg", "head", "iframe", "button",
                 "select", "option", "form", "nav", "header", "footer", "aside", "label"}
    # void-элементы никогда не закрываются — их нельзя считать в соосность
    VOID_TAGS = {"input", "br", "img", "link", "meta", "hr", "source", "wbr",
                 "embed", "track", "area", "base", "col", "param"}
    BLOCKS = {"p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6",
              "td", "th", "br", "section", "article", "ul", "table", "blockquote", "figcaption"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.in_title = False
        self.title = ""
        self.title_buf = []
        self.h1 = ""
        self.in_h1 = False
        self.buf = []

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
            self.title_buf = []
        elif tag == "h1":
            self.in_h1 = True
            self.h1_buf = []
        if tag in self.SKIP_TAGS:
            self.skip += 1
        elif tag in self.BLOCKS and not self.skip:
            self.buf.append("\n")

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
            self.title = re.sub(r"\s+", " ", " ".join(self.title_buf)).strip()
        elif tag == "h1":
            self.in_h1 = False
            if not self.h1:
                self.h1 = re.sub(r"\s+", " ", " ".join(getattr(self, "h1_buf", []))).strip()
        elif tag in self.SKIP_TAGS and self.skip:
            self.skip -= 1
        if tag in self.BLOCKS and not self.skip:
            self.buf.append("\n")

    def handle_data(self, data):
        if self.in_title:
            self.title_buf.append(data)
        if self.in_h1:
            self.h1_buf.append(data)
        if self.skip:
            return
        t = data.strip()
        if not t:
            return
        self.buf.append(t + " ")

    def text(self):
        lines = []
        for line in "".join(self.buf).split("\n"):
            line = re.sub(r"\s+", " ", line).strip()
            if line and len(line) > 1:
                lines.append(line)
        dedup = []
        for l in lines:
            if not dedup or dedup[-1] != l:
                dedup.append(l)
        return "\n".join(dedup)


def clean_text(text):
    """Убирает строку-подпись зеркала и служебный мусор."""
    text = re.sub(r"Powered by \[?\[CKEditor\]?\]?.*", "", text)
    text = re.sub(r"SC_estty3WdtxpKq2WJ4TQGiX4k[^ ]*", "", text)
    return text


def chunk_page(text, url, title):
    """Режет текст на чанки ~1200 символов с небольшим перекрытием."""
    sents = re.split(r"(?<=[.!?;])\s+|\n", text)
    chunks, cur = [], ""
    for s in sents:
        s = s.strip()
        if not s:
            continue
        if len(s) > 900:  # очень длинный "параграф" — режем целиком
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.append(s[:900])
            continue
        if len(cur) + len(s) + 1 > 1200:
            chunks.append(cur.strip())
            tail = cur[-250:]
            cut = tail.find(" ")
            cur = (tail[cut + 1:] if cut > 0 else tail) + " "
        cur += s + " "
    if cur.strip():
        chunks.append(cur.strip())
    return chunks


def accept_page(path: Path, relfile: str):
    parts = [p for p in relfile.split("/")[:-1]]
    if any(p in SKIP_DIRS or p.startswith("cdn") or p.endswith(".net")
           or p.endswith(".com") or p.endswith(".pe") for p in parts):
        return None
    if SKIP_NAME.search(Path(relfile).name):
        return None
    return True


def main():
    t0 = time.time()
    pages_data = []
    raw_fail = 0

    for tree in TREES:
        root = ROOT / tree
        if not root.exists():
            print(f"  [пропуск] нет каталога {tree}")
            continue
        for p in sorted(root.rglob("*.html")):
            rel = f"{tree}/{p.relative_to(root).as_posix()}"
            if accept_page(p, rel) is None:
                continue
            try:
                html = p.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                raw_fail += 1
                continue
            m = MIRROR_MARK.search(html[:4000])
            canonical = None
            if m:
                u = m.group(1)
                if ALLOWED_HOST.search(u):
                    canonical = u
                else:
                    continue  # страница с чужого домена — не источник
            ex = TextExtract()
            try:
                ex.feed(html)
            except Exception:
                continue
            title = (ex.title or ex.h1 or "").strip()
            text = clean_text(ex.text())
            if len(text) < MIN_TEXT_LEN:
                continue
            if canonical is None:
                canonical = SUFFIX.sub("", f"ku.edu.kz/{rel}")
                if canonical.endswith("index.html"):
                    canonical = canonical[: -len("index.html")]
                elif canonical.endswith(".html"):
                    canonical = canonical[: -5]
            lines = [l.strip() for l in text.split("\n") if l.strip()]
            pages_data.append({"rel": rel, "c": canonical, "h": title[:140], "lines": lines})

    print(f"страниц принято: {len(pages_data)} (ошибок чтения: {raw_fail})")
    if not pages_data:
        sys.exit("нет страниц — индекс не построен")

    # --- удаляем boilerplate: строки, встречающиеся на >=30% страниц ---
    from collections import Counter
    df = Counter()
    for pg in pages_data:
        df.update(set(pg["lines"]))
    threshold = len(pages_data) * 0.3
    for pg in pages_data:
        pg["lines"] = [l for l in pg["lines"]
                       if not (df[l] >= threshold and len(l) >= 4)]
        pg["text"] = "\n".join(pg["lines"])

    # --- чанки и postings ---
    chunks = []          # [{u, t}]
    postings = {}        # tok -> [[cid, tf], ...]
    title_toks = []      # по страницам: set токенов
    doc_len = []

    for pi, pg in enumerate(pages_data):
        title_toks.append(set(tokenize(pg["h"])))
        for ch in chunk_page(pg["text"], pg["c"], pg["h"]):
            toks = tokenize(ch)
            if not toks:
                continue
            tf = {}
            for t in toks:
                tf[t] = tf.get(t, 0) + 1
            cid = len(chunks)
            chunks.append({"u": pi, "t": ch})
            for tok, tfv in tf.items():
                postings.setdefault(tok, []).append([cid, tfv])
            doc_len.append(sum(tf.values()))

    n = len(chunks)
    avdl = (sum(doc_len) / len(doc_len)) if doc_len else 200.0

    pages_json = [{"p": pg["rel"], "c": pg["c"], "h": pg["h"], "tk": sorted(t)}
                  for pg, t in zip(pages_data, title_toks)]

    index = {
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "n_pages": len(pages_data),
        "n_chunks": n,
        "avdl": round(avdl, 1),
        "k1": 1.4, "b": 0.7,
        "pages": pages_json,
        "chunks": chunks,
        "postings": postings,
    }
    out_file = OUT / "index.json"
    out_file.write_text(json.dumps(index, ensure_ascii=False,
                                   separators=(",", ":")), encoding="utf-8")
    size_mb = out_file.stat().st_size / 1e6
    print(f"чанко: {n}, токенов в индексе: {len(postings)}, "
          f"средняя длина: {avdl:0.0f}")
    print(f"готово: {out_file} ({size_mb:.1f} МБ) за {time.time()-t0:0.1f} с")


if __name__ == "__main__":
    main()
