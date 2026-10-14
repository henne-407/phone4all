"""Farbthemen: Material-3-Farbrollen aus einer Grundfarbe ableiten.

Das Standardthema „Violett“ nutzt die exakte M3-Baseline-Palette aus
colors-light.css/colors-dark.css; alle anderen werden aus einem Farbton
(Hue) erzeugt. „System“ übernimmt die Akzentfarbe von GNOME/libadwaita.
"""

import colorsys
import os

from gi.repository import Adw

CSS_DIR = os.path.dirname(__file__)

# (Schlüssel, Name, Farbton in Grad oder None, Sättigungsfaktor)
THEMES = [
    ("violet", "Violett", None, 1.0),
    ("blue", "Blau", 215, 1.0),
    ("teal", "Türkis", 182, 0.9),
    ("green", "Grün", 135, 0.8),
    ("mustard", "Senf", 45, 0.9),
    ("orange", "Orange", 24, 1.0),
    ("coral", "Koralle", 4, 0.9),
    ("pink", "Pink", 325, 0.9),
    ("graphite", "Graphit", 220, 0.08),
    ("system", "Systemakzent", None, 1.0),
]
SCHEMES = [("system", "Wie das System", Adw.ColorScheme.DEFAULT),
           ("light", "Hell", Adw.ColorScheme.FORCE_LIGHT),
           ("dark", "Dunkel", Adw.ColorScheme.FORCE_DARK)]


def _hex(h, s, l):
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360, max(0.0, min(1.0, l)), max(0.0, min(1.0, s)))
    return "#{:02x}{:02x}{:02x}".format(round(r * 255), round(g * 255), round(b * 255))


def _luminance(hex_color):
    def chan(c):
        c = int(hex_color[c:c + 2], 16) / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * chan(1) + 0.7152 * chan(3) + 0.0722 * chan(5)


def contrast(a, b):
    la, lb = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def _readable(hue, s, l, against, step):
    """Helligkeit schrittweise anpassen, bis Text darauf gut lesbar ist (WCAG AA, 4,5:1)."""
    color = _hex(hue, s, l)
    while contrast(color, against) < 4.5 and 0.05 < l < 0.95:
        l += step
        color = _hex(hue, s, l)
    return color


def _roles(hue, sat, dark):
    """Tonwerte grob nach M3: Akzente kräftig, Flächen nur leicht eingefärbt."""
    def c(s, l):
        return _hex(hue, s * sat, l)

    def n(s, l):  # neutrale Flächen
        return _hex(hue, min(s, 0.25) * max(sat, 0.3), l)

    if dark:
        on_primary = c(0.6, 0.20)
        return {
            "primary": _readable(hue, 0.75 * sat, 0.80, on_primary, 0.02), "on-primary": on_primary,
            "primary-container": c(0.45, 0.30), "on-primary-container": c(0.8, 0.90),
            "secondary-container": n(0.18, 0.28), "on-secondary-container": n(0.25, 0.88),
            "tertiary-container": _hex(hue + 60, 0.3 * sat, 0.28),
            "surface": n(0.12, 0.07), "surface-container-low": n(0.10, 0.10),
            "surface-container": n(0.10, 0.12), "surface-container-high": n(0.09, 0.16),
            "surface-container-highest": n(0.08, 0.20),
            "on-surface": n(0.10, 0.90), "on-surface-variant": n(0.10, 0.80),
            "outline": n(0.06, 0.58), "outline-variant": n(0.08, 0.29),
        }
    return {
        "primary": _readable(hue, 0.50 * sat, 0.40, "#ffffff", -0.02), "on-primary": "#ffffff",
        "primary-container": c(0.85, 0.90), "on-primary-container": c(0.7, 0.14),
        "secondary-container": n(0.40, 0.88), "on-secondary-container": n(0.35, 0.12),
        "tertiary-container": _hex(hue + 60, 0.6 * sat, 0.88),
        "surface": n(0.60, 0.985), "surface-container-low": n(0.35, 0.96),
        "surface-container": n(0.30, 0.94), "surface-container-high": n(0.22, 0.92),
        "surface-container-highest": n(0.18, 0.89),
        "on-surface": n(0.10, 0.12), "on-surface-variant": n(0.08, 0.30),
        "outline": n(0.05, 0.48), "outline-variant": n(0.12, 0.80),
    }


# Signalfarben sind themenunabhängig, brauchen im Dunkelmodus aber hellere Töne
DARK_SIGNAL = {
    "error": "#f2b8b5", "call": "#9ad5a3", "call-container": "#005322",
    "on-call-container": "#b6f2be", "hangup": "#ffb4ab", "on-hangup": "#690005",
}


def _system_hue():
    rgba = Adw.StyleManager.get_default().get_accent_color_rgba()
    h, _l, s = colorsys.rgb_to_hls(rgba.red, rgba.green, rgba.blue)
    return h * 360, 1.0 if s > 0.15 else 0.1


def palette_css(theme, dark):
    """CSS mit den --md-*-Variablen für das gewählte Thema (ergänzt colors-light.css)."""
    if theme == "violet" or theme not in {k for k, *_ in THEMES}:
        if not dark:
            return ""  # colors-light.css enthält die Baseline-Palette bereits
        with open(os.path.join(CSS_DIR, "colors-dark.css")) as f:
            return f.read()
    if theme == "system":
        hue, sat = _system_hue()
    else:
        _key, _name, hue, sat = next(t for t in THEMES if t[0] == theme)
    roles = _roles(hue, sat, dark)
    if dark:
        roles.update(DARK_SIGNAL)
    lines = [f"  --md-{name}: {value};" for name, value in roles.items()]
    return ":root {\n" + "\n".join(lines) + "\n}\n"


def swatch(theme):
    """Vorschaufarbe für die Themenauswahl."""
    if theme == "violet":
        return "#6750a4"
    if theme == "system":
        hue, sat = _system_hue()
        return _hex(hue, 0.5 * sat, 0.45)
    _key, _name, hue, sat = next(t for t in THEMES if t[0] == theme)
    return _hex(hue, 0.5 * sat, 0.42)
