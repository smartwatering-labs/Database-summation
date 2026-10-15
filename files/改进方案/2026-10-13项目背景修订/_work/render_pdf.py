from pathlib import Path
import sys
sys.stdout.reconfigure(encoding='utf-8')
import pypdfium2 as pdfium
import pdfplumber
from PIL import Image, ImageDraw
import json

root=Path(__file__).resolve().parent/'render'
summary=[]
for name in ('硬件1','硬件2','网页1','网页2'):
    out=root/name
    image_dir=out/'final-pages-rewrite'
    image_dir.mkdir(exist_ok=True)
    pdf=pdfium.PdfDocument(str(out/(name+'.pdf')))
    for i in range(len(pdf)):
        page=pdf[i]; bitmap=page.render(scale=1.65)
        im=bitmap.to_pil(); im.save(image_dir/f'page-{i+1}.png')
        page.close()
    pdf.close()
    with pdfplumber.open(out/(name+'.pdf')) as doc:
        for i,page in enumerate(doc.pages):
            text=page.extract_text() or ''
            body=[c for c in page.chars if c['top']<page.height-40]
            summary.append({'document':name,'page':i+1,'characters':len(text),'first':text.splitlines()[:2],'last':text.splitlines()[-3:],'bottom':max((c['bottom'] for c in body),default=0)})
            print(name,i+1,len(text),text.splitlines()[:1])
    images=sorted(image_dir.glob('page-*.png'),key=lambda p:int(p.stem.split('-')[-1]))
    for pair in range(0,len(images),2):
        canvas=Image.new('RGB',(1400,1020),'#d8d8d8')
        for slot,path in enumerate(images[pair:pair+2]):
            with Image.open(path) as im:
                im.thumbnail((680,970)); canvas.paste(im,(10+slot*700,35))
        canvas.save(image_dir/f'review-{pair//2+1}.png')
(root/'page_summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
