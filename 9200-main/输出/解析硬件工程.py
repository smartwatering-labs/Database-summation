"""从归档 EPRO 生成可追溯的器件及 PCB 网络清单；只读源工程。"""
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / '浇水项目/100-现今背景资料/120-浇水机器硬件/10-01版本'
SOURCE = BASE / '源文件/ProPrj_浇水6代-v2_2026-10-01.epro'
OUT = BASE / '工程提取'
OUT.mkdir(exist_ok=True)

def table(headers, rows):
    def cell(v):
        return str(v).replace('|', '\\|').replace('\n', '<br>')
    return '\n'.join('| ' + ' | '.join(map(cell, row)) + ' |' for row in [headers, ['---'] * len(headers), *rows])

with zipfile.ZipFile(SOURCE) as z:
    project = json.loads(z.read('project.json'))
    report = {'source': SOURCE.name, 'sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'boards': {}}
    for board, refs in project['boards'].items():
        pcbpath = 'PCB/' + refs['pcb'] + '.epcb'
        schpath = 'SHEET/' + refs['schematic'] + '/1.esch'
        pcb = [json.loads(l) for l in z.read(pcbpath).decode().splitlines() if l.strip()]
        sch = [json.loads(l) for l in z.read(schpath).decode().splitlines() if l.strip()]
        attrs, schattrs = {}, {}
        for r in pcb:
            if r[0] == 'ATTR': attrs.setdefault(r[3], {})[r[7]] = r[8]
        for r in sch:
            if r[0] == 'ATTR': schattrs.setdefault(r[2], {})[r[3]] = r[4]
        comp, pins, models = [], [], {}
        for r in pcb:
            if r[0] != 'COMPONENT': continue
            cid = r[1]
            a = attrs[cid]
            d = {**project['devices'].get(a.get('Device'), {}).get('attributes', {}), **a}
            symbol = d.get('Symbol')
            names = {}
            if symbol:
                symattrs = {}
                for line in z.read('SYMBOL/' + symbol + '.esym').decode().splitlines():
                    s = json.loads(line)
                    if s[0] == 'ATTR': symattrs.setdefault(s[2], {})[s[3]] = s[4]
                names = {v['NUMBER']: v.get('NAME', '') for v in symattrs.values() if 'NUMBER' in v}
            comp.append([a['Designator'], d.get('Manufacturer Part', ''), d.get('Value', ''), d.get('Supplier Footprint', ''), d.get('Supplier Part', ''), '顶层' if r[3] == 1 else '底层', cid])
            models[a['Designator']] = d
            for n in pcb:
                if n[0] == 'PAD_NET' and n[1] == cid:
                    pins.append([a['Designator'], n[2], names.get(n[2], ''), n[3] or '未分配网络', cid, n[4]])
        schrefs = {a['Designator'] for a in schattrs.values() if 'Designator' in a}
        assert schrefs == {r[0] for r in comp}, (board, '原理图/PCB元件位号不一致')
        standalone = [[r[1], r[5], r[3], r[6], r[7]] for r in pcb if r[0] == 'PAD']
        text = f'# {board}工程提取清单\n\n来源：`{SOURCE.name}` 内 `{pcbpath}`，元件参数关联 `project.json`，符号引脚关联 `SYMBOL/*.esym`。\n\n元件实例 {len(comp)} 个；原理图与 PCB 位号集合一致。位号不能代表器件类型，型号以关联参数为准。此清单是工程设计数据，不是装配检验或 ERC/DRC 结论。\n\n## 元件\n\n'
        text += table(['位号', '型号', '值', '封装标注', '供应商编号', '安装面', 'PCB对象ID'], comp)
        text += '\n\n## 引脚与网络\n\n' + table(['位号', '脚号', '符号脚名', '网络', '元件对象ID', '封装焊盘ID'], pins)
        text += '\n\n## 独立焊盘\n\n坐标单位 mil；1 mil = 0.0254 mm。\n\n' + table(['对象ID', '焊盘号', '网络', 'X', 'Y'], standalone) + '\n'
        (OUT / (board + '-元件与网络.md')).write_text(text)
        report['boards'][board] = {'pcb_path': pcbpath, 'schematic_path': schpath, 'components': comp, 'pins': pins, 'standalone_pads': standalone, 'attributes': models}
    (OUT / '工程提取.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'sha256': report['sha256'], 'boards': {b: {'components': len(v['components']), 'pins': len(v['pins'])} for b,v in report['boards'].items()}}, ensure_ascii=False))
