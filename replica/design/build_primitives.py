#!/usr/bin/env python3
"""primitives.src.html -> primitives.html (self-contained: CSS, Lucide icons, IBM Plex fonts inlined).

    python3 build_tokens.py && python3 build_primitives.py
Needs vendor/node_modules: @fontsource/ibm-plex-sans, @fontsource/ibm-plex-mono, lucide-static
"""
import base64
import json
import pathlib
import re

HERE = pathlib.Path(__file__).parent
NM = HERE / "vendor" / "node_modules"


def font_face(family, path, weight):
    b64 = base64.b64encode(path.read_bytes()).decode()
    return (f"@font-face{{font-family:'{family}';font-style:normal;font-display:swap;font-weight:{weight};"
            f"src:url(data:font/woff2;base64,{b64}) format('woff2');}}")


fonts = [font_face("IBM Plex Sans", NM / f"@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-{w}-normal.woff2", w)
         for w in (400, 500, 600, 700)]
fonts.append(font_face("IBM Plex Mono", NM / "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2", 400))


def icon(m):
    svg = (NM / "lucide-static/icons" / f"{m.group(1)}.svg").read_text()
    svg = re.sub(r"<!--.*?-->", "", svg, flags=re.S).strip()
    svg = re.sub(r'\sclass="[^"]*"', "", svg)
    return svg.replace("<svg", '<svg class="r-icon" aria-hidden="true" focusable="false"', 1)


tokens = json.loads((HERE / "tokens.json").read_text())
swatches = "".join(
    f'<div class="g-sw"><i style="background:var(--r-color-{k})"></i><span><b>{k}</b><br>{v}</span></div>'
    for k, v in tokens["color"].items())

html = (HERE / "primitives.src.html").read_text()
html = html.replace("/*{{fonts}}*/", "\n".join(fonts))
html = html.replace("/*{{tokens.css}}*/", (HERE / "tokens.css").read_text())
html = html.replace("/*{{components.css}}*/", (HERE / "components.css").read_text())
html = html.replace("{{swatches}}", swatches)
html = re.sub(r"\{\{icon:([a-z0-9-]+)\}\}", icon, html)
assert "{{" not in html, "unresolved placeholder"
(HERE / "primitives.html").write_text(html, encoding="utf-8")
print(f"wrote primitives.html ({len(html)//1024} KB)")
