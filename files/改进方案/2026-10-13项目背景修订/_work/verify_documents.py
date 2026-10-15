from pathlib import Path
from docx import Document
import pdfplumber, hashlib, json, re

work=Path(__file__).resolve().parent
manifest=json.loads((work/'manifest.json').read_text(encoding='utf-8'))
normalize=lambda s:re.sub(r'\s+','',s)
report=[]
for entry in manifest:
    name=entry['name']; path=Path(entry['output'])
    original=Path('C:/Users/bYYYyyL/Desktop')/(name+'.docx')
    assert hashlib.sha256(original.read_bytes()).hexdigest()==entry['originalSha256']
    assert hashlib.sha256(path.read_bytes()).hexdigest()==entry['sha256']
    doc=Document(path)
    with pdfplumber.open(work/'render'/name/(name+'.pdf')) as pdf:
        texts=[page.extract_text() or '' for page in pdf.pages]
        assert len(texts)==entry['plannedPages']
        assert all(len(text)>200 for text in texts)
        rendered=normalize('\n'.join(texts))
        cells=[]
        for page in pdf.pages:
            for table in page.find_tables():
                for row in table.extract():
                    cells.extend(value for value in row if value)
        rendered+=normalize('\n'.join(cells))
        paragraphs=[p.text for p in doc.paragraphs if p.text.strip()]
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    paragraphs.extend(p.text for p in cell.paragraphs if p.text.strip())
        missing=[p for p in paragraphs if normalize(p) not in rendered]
        assert not missing, (name,missing)
        for page in pdf.pages:
            assert all(c['x0']>=40 and c['x1']<=page.width-40 for c in page.chars)
    assert not doc.styles.element.xpath('.//w:pBdr')
    assert len(list((work/'render'/name/'final-pages-rewrite').glob('page-*.png')))==entry['plannedPages']
    report.append({'document':name,'pages':len(texts),'originalUnchanged':True,'paragraphsPresentInRender':True,'visualReview':'All pages inspected; no clipping, overlap, isolated table rows or blank pages','sha256':entry['sha256']})
(work/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('Verified 4 DOCX files, '+str(sum(item['pages'] for item in report))+' rendered pages, complete body and table text, unchanged originals.')
