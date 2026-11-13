#!/usr/bin/env python3
"""tokens.json -> tokens.css (CSS custom properties) + tailwind.preset.cjs.

    python3 build_tokens.py            # writes both next to tokens.json

Single source of truth: never edit tokens.css or tailwind.preset.cjs by hand.
"""
import json
import pathlib

HERE = pathlib.Path(__file__).parent
T = json.loads((HERE / "tokens.json").read_text(encoding="utf-8"))
P = "--r"  # prefix (rename with the brand if needed)


def px(v):
    return f"{v}px" if isinstance(v, (int, float)) and v != 0 else str(v)


def css():
    lines = ["/* GENERATED from tokens.json by build_tokens.py: do not edit */", ":root {"]
    for k, v in T["color"].items():
        lines.append(f"  {P}-color-{k}: {v};")
    for k, v in T["font"].items():
        lines.append(f"  {P}-font-{k}: {v};")
    for k, v in T["type"].items():
        lines.append(f"  {P}-text-{k}-size: {v['size']}px;")
        lines.append(f"  {P}-text-{k}-line: {v['line']}px;")
        lines.append(f"  {P}-text-{k}-weight: {v['weight']};")
    for i, v in enumerate(T["space"]):
        lines.append(f"  {P}-space-{i}: {px(v)};")
    for k, v in T["radius"].items():
        lines.append(f"  {P}-radius-{k}: {px(v)};")
    for k, v in T["shadow"].items():
        lines.append(f"  {P}-shadow-{k}: {v};")
    for k, v in T["motion"].items():
        lines.append(f"  {P}-motion-{k}: {v};")
    for k, v in T["layout"].items():
        if k.startswith("bp-") or k == "grid-columns":
            lines.append(f"  {P}-{k}: {v};")
        else:
            lines.append(f"  {P}-{k}: {px(v)};")
    for k, v in T["z"].items():
        lines.append(f"  {P}-z-{k}: {v};")
    lines.append("}")
    lines.append("@media (prefers-reduced-motion: reduce) {")
    lines.append(f"  :root {{ {P}-motion-fast: 0ms; {P}-motion-base: 0ms; }}")
    lines.append("}")
    return "\n".join(lines) + "\n"


def tailwind():
    colors = {k: f"var({P}-color-{k})" for k in T["color"]}
    font_size = {k: [f"var({P}-text-{k}-size)", {"lineHeight": f"var({P}-text-{k}-line)",
                                                 "fontWeight": f"var({P}-text-{k}-weight)"}]
                 for k in T["type"]}
    spacing = {str(i): f"var({P}-space-{i})" for i in range(len(T["space"]))}
    preset = {
        "theme": {
            "colors": {"transparent": "transparent", "current": "currentColor", **colors},
            "fontFamily": {k: [f"var({P}-font-{k})"] for k in T["font"]},
            "fontSize": font_size,
            "spacing": spacing,
            "borderRadius": {**{k: f"var({P}-radius-{k})" for k in T["radius"]}, "none": "0"},
            "boxShadow": {**{k: f"var({P}-shadow-{k})" for k in T["shadow"]}, "none": "none"},
            "screens": {k[3:]: f"{T['layout'][k]}px" for k in T["layout"] if k.startswith("bp-")},
            "zIndex": {k: f"var({P}-z-{k})" for k in T["z"]},
            "extend": {
                "transitionDuration": {"fast": f"var({P}-motion-fast)", "base": f"var({P}-motion-base)"},
                "transitionTimingFunction": {"rpx": f"var({P}-motion-ease)"},
            },
        }
    }
    body = json.dumps(preset, indent=2)
    return ("// GENERATED from tokens.json by build_tokens.py: do not edit\n"
            "// Usage (Fase 2 builder): tailwind.config.js -> presets: [require('./tailwind.preset.cjs')]\n"
            f"module.exports = {body};\n")


(HERE / "tokens.css").write_text(css(), encoding="utf-8")
(HERE / "tailwind.preset.cjs").write_text(tailwind(), encoding="utf-8")
print("wrote tokens.css, tailwind.preset.cjs")
