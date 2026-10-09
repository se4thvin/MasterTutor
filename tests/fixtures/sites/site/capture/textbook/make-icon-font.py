"""Builds icons.ttf: a test ligature-icon font (like Material Icons). Lower-case letters and "_" are
plain boxes 0.6 em wide; each icon name below is a `liga` substitution to one 1 em glyph. Run:
python3 make-icon-font.py (needs fontTools)."""
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

ICONS = ["assignment", "expand_more", "expand_less", "menu", "help", "thumb_up", "thumb_down"]
letters = [chr(c) for c in range(ord("a"), ord("z") + 1)]


def box(width):
    pen = TTGlyphPen(None)
    pen.moveTo((50, 0)); pen.lineTo((50, 700)); pen.lineTo((width - 50, 700)); pen.lineTo((width - 50, 0))
    pen.closePath()
    return pen.glyph()


names = [".notdef", "underscore"] + letters + [f"icon_{i}" for i in range(len(ICONS))]
fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder(names)
fb.setupCharacterMap({ord("_"): "underscore", **{ord(c): c for c in letters}})
glyphs = {name: box(1000 if name.startswith("icon_") else 600) for name in names}
fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics({name: (1000 if name.startswith("icon_") else 600, 50) for name in names})
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupNameTable({"familyName": "Fixture Glyphs", "styleName": "Regular"})
fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
fb.setupPost()
rules = "\n".join(
    f"  sub {' '.join('underscore' if ch == '_' else ch for ch in word)} by icon_{i};"
    for i, word in enumerate(ICONS)
)
addOpenTypeFeaturesFromString(fb.font, f"feature liga {{\n{rules}\n}} liga;\n")
fb.save("icons.ttf")
print("icons.ttf written")
