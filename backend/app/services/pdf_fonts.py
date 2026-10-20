from pathlib import Path
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont


def apply_fonts(styles):
    name="OncoBriefSans"
    if name not in pdfmetrics.getRegisteredFontNames():
        path=Path(__file__).resolve().parents[2]/"assets"/"fonts"/"OncoBriefSans.ttf"
        pdfmetrics.registerFont(TTFont(name,str(path),shapable=True))
        pdfmetrics.registerFontFamily(name,normal=name,bold=name,italic=name,boldItalic=name)
    for style in styles.byName.values():
        style.fontName=name
        style.shaping=1
    return styles
