#!/usr/bin/env python3
"""
Добавляет подключение ИИ-помощника (chatbot.css + chatbot.js) на все
HTML-страницы зеркала СКГУ. Идемпотентно: повторный запуск ничего не меняет.

Запуск:  python3 chatbot/tools/inject.py
Откат:   python3 chatbot/tools/inject.py --remove
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # .../Sites/ku-frontend

TREES = [
    "ku.edu.kz",
    "apply.ku.edu.kz",
    "astra.ku.edu.kz",
    "dormitories.ku.edu.kz",
    "mba.ku.edu.kz",
    "is.ku.edu.kz",
]

SKIP_FILES = re.compile(r"(^login|^gtm|^analytics|^robots|favicon)", re.IGNORECASE)

EXCLUDE_DIRS = {"assets", "static", "img", "images", "files", "node_modules", "src",
                "slide", "fls", "new_galleries", "font", "fonts", "icons", "media"}

MARK = "chatbot/chatbot.js"


def snippet(depth: int) -> str:
    prefix = "./" + "../" * depth
    return (
        f'\n<!-- ИИ-помощник СКГУ -->\n'
        f'<link rel="stylesheet" href="{prefix}chatbot/chatbot.css">\n'
        f'<script src="{prefix}chatbot/chatbot.js" defer></script>\n'
    )


def process(remove: bool):
    added = removed = skipped = already = 0
    for tree in TREES:
        root = ROOT / tree
        if not root.is_dir():
            continue
        for p in sorted(root.rglob("*.html")):
            if any(part in EXCLUDE_DIRS or part.startswith("cdn") or part.endswith(".net")
                   or part.endswith(".com") or part.endswith(".pe")
                   for part in p.relative_to(root).parts[:-1]):
                continue
            if SKIP_FILES.search(p.name):
                continue
            try:
                html = p.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            has = MARK in html
            if remove:
                if not has:
                    continue
                html = re.sub(
                    r"\n<!-- ИИ-помощник СКГУ -->\n"
                    r'<link rel="stylesheet" href="[^"]*chatbot/chatbot\.css">\n'
                    r'<script src="[^"]*chatbot/chatbot\.js" defer></script>\n',
                    "",
                    html,
                    count=1,
                )
                p.write_text(html, encoding="utf-8")
                removed += 1
                continue
            if has:
                already += 1
                continue
            if "</body>" not in html.lower():
                skipped += 1
                continue
            # глубина относительно корня дерева (для относительного пути)
            depth = len(p.relative_to(root).parent.parts)
            pos = html.rfind("</body>")
            html = html[:pos] + snippet(depth) + html[pos:]
            p.write_text(html, encoding="utf-8")
            added += 1

    if remove:
        print(f"удалено: {removed}")
    else:
        print(f"добавлено: {added}, уже было: {already}, пропущено (нет </body>): {skipped}")


if __name__ == "__main__":
    process(remove="--remove" in sys.argv[1:])
