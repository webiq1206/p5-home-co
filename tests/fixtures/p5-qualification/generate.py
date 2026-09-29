"""Generate synthetic, paired native PDF / raster PDF / PNG / text QA inputs.

All formats carry the same scope. Geometry is diagrammatic, not permit-ready.
Run from any directory with reportlab, Pillow and pdftoppm installed.
"""
from pathlib import Path
import json
import subprocess
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.colors import HexColor
from PIL import Image, ImageOps, ImageDraw

root = Path(__file__).resolve().parent
out = root / "fixtures"
out.mkdir(exist_ok=True)
cases = json.loads((root / "cases.json").read_text())
style = ParagraphStyle("scope", fontName="Helvetica", fontSize=10.5, leading=15, textColor=HexColor("#162c3a"))
thumbs = []
for case in cases:
    stem = out / case["id"]
    stem.with_suffix(".txt").write_text(case["title"] + "\n\n" + case["scope"] + "\n")
    c = canvas.Canvas(str(stem.with_suffix(".pdf")), pagesize=letter)
    c.setTitle(case["title"] + " - synthetic QA")
    c.setFillColor(HexColor("#112f41"))
    c.rect(0, 714, 612, 78, fill=1, stroke=0)
    c.setFillColor(HexColor("#ffffff"))
    c.setFont("Helvetica-Bold", 16)
    c.drawString(40, 755, "P5 ESTIMATOR | SYNTHETIC QA")
    c.setFont("Helvetica", 10)
    c.drawString(40, 733, case["title"])
    p = Paragraph(case["scope"], style)
    w, h = p.wrap(532, 570)
    assert h < 440, (case["id"], h)
    p.drawOn(c, 40, 690-h)
    c.setFillColor(HexColor("#162c3a"))
    c.setFont("Helvetica-Bold", 10)
    c.drawString(40, 210, "SCOPE SKETCH / QUANTITY REFERENCE")
    c.setFont("Helvetica", 9)
    if case["id"] in ("new-home", "adu", "bathroom"):
        dims={"new-home":(50,40,"2000 SF conditioned"),"adu":(20,30,"600 SF conditioned"),"bathroom":(6,10,"60 SF bathroom")}
        width,height,label=dims[case["id"]]
        scale=min(170/width,115/height)
        x,y=90,60
        c.rect(x,y,width*scale,height*scale)
        c.drawCentredString(x+width*scale/2,y-14,f"{width} ft")
        c.drawString(x+width*scale+8,y+height*scale/2,f"{height} ft")
        c.drawCentredString(x+width*scale/2,y+height*scale/2,label)
        if case["id"]=="new-home":
            c.rect(330,65,77,70)
            c.drawString(325,146,"GARAGE 20 x 22 ft = 440 SF")
            c.drawString(325,49,"PORCH 8 x 10 ft = 80 SF")
            c.drawString(325,34,"Both additional to living area")
    else:
        refs={
          "kitchen":["18 LF base + 12 LF wall + 0 LF tall cabinets", "45 SF quartz | 30 SF backsplash", "Existing floor and appliances remain"],
          "whole-home":["1600 SF LVP + 80 SF tile + 120 SF untouched = 1800 SF", "4000 SF wall paint | 1800 SF ceiling paint", "12 doors | 550 LF baseboard"],
          "cabinet-only":["12 LF base + 8 LF wall + 0 LF tall", "Supply ONLY | owner collects and installs", "No installation, countertop or trade work"],
          "handyman":["3 owner-supplied passage lever sets", "Replace handles only, not doors", "Test operation and clean up"],
          "re10":["2 GFCI receptacles | 1 PVC P-trap", "1 drywall hole: 12 in x 12 in = 1 SF", "Spot prime only; no whole-room paint"]}
        for i, line in enumerate(refs[case["id"]]):
            c.drawString(48, 182-i*23, line)
    c.setFont("Helvetica", 8)
    c.drawString(40, 18, "Synthetic test input. Not for bidding, permitting, construction, or a real transaction. Sketch not to scale.")
    c.save()
    subprocess.run(["pdftoppm","-r","150","-singlefile","-png",str(stem.with_suffix('.pdf')),str(stem)],check=True)
    image=Image.open(stem.with_suffix(".png")).convert("RGB")
    image.save(str(stem)+".scan.pdf","PDF",resolution=150.0)
    thumb=ImageOps.contain(image,(306,396))
    thumbs.append(thumb)
sheet=Image.new("RGB",(306*4,396*2),"white")
for i,thumb in enumerate(thumbs): sheet.paste(thumb,((i%4)*306,(i//4)*396))
sheet.save(out/"contact-sheet.png")
print(f"Generated {len(cases)} paired cases: text, native PDF, PNG and raster PDF.")
