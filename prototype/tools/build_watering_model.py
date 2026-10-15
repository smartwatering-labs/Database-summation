"""Convert the supplied 9-30 OBJ to a local four-assembly GLB (standard Python).

This exporter is intentionally specific to this CAD export. Its ordered solids
contain the upper PCB at 0, lower PCB at 425, telescoping lid at 646 and base at
647. Keep whole solids with their PCB, including underside pins and lettering.
"""
import argparse
import json
import re
import struct
from array import array
from collections import defaultdict
from pathlib import Path
from audit_model_geometry import audit

ASSEMBLIES = ['外壳-顶盖', '上层主板', '下层主板', '外壳-底壳']


def role(group, material):
    if group['index'] >= 646:
        return 'abs-plastic'
    if material == 'Opaque(0,106,163)': return 'solder-mask'
    if material == 'Opaque(239,239,166)': return 'fr4-edge'
    rgb = tuple(map(int, re.search(r'\((\d+),(\d+),(\d+)\)', material).groups()))
    if rgb == (255, 255, 255):
        if group['max'][2] - group['min'][2] < .003: return 'silkscreen'
        return 'solder'
    if rgb in [(63, 63, 63), (64, 64, 64), (38, 38, 38)]: return 'ic-epoxy'
    if rgb == (57, 57, 57): return 'connector-polymer'
    if rgb in [(242, 194, 46), (151, 118, 0)]: return 'gold-contact'
    if rgb == (247, 224, 153): return 'ceramic'
    if rgb in [(0, 255, 255), (0, 231, 36), (203, 210, 239)]: return 'indicator-lens'
    if rgb in [(255, 167, 0), (232, 113, 8)]: return 'tantalum'
    if rgb == (252, 255, 252): return 'insulator'
    return 'nickel'


def read_obj(source):
    vertices, normals, groups = [None], [None], []
    material = None
    with source.open(encoding='utf-8-sig') as stream:
        for line in stream:
            t = line.split()
            if not t: continue
            if t[0] == 'g':
                group = {'index': len(groups), 'name': ' '.join(t[1:]), 'min': [float('inf')] * 3,
                         'max': [-float('inf')] * 3, 'faces': defaultdict(list)}
                groups.append(group)
            elif t[0] == 'v':
                point = tuple(map(float, t[1:4])); vertices.append(point)
                group['min'] = list(map(min, group['min'], point))
                group['max'] = list(map(max, group['max'], point))
            elif t[0] == 'vn': normals.append(tuple(map(float, t[1:4])))
            elif t[0] == 'usemtl': material = ' '.join(t[1:])
            elif t[0] == 'f':
                face = [tuple(int(v) if v else 0 for v in vertex.split('/')) for vertex in t[1:]]
                for i in range(1, len(face) - 1):
                    group['faces'][material].extend((face[0], face[i], face[i + 1]))
    assert len(groups) == 648 and groups[425]['name'] == '实体1:322', 'Different CAD export: recheck assembly boundaries'
    return vertices, normals, groups


def convert(source, destination):
    vertices, normals, groups = read_obj(source)
    buckets = {}
    for group in groups:
        i = group['index']
        assembly = 0 if i == 646 else 3 if i == 647 else 1 if i < 425 else 2
        for material, face in group['faces'].items():
            surfaces = {role(group, material): face}
            if i == 647:
                # The original ON/OFF lettering is recessed into the switch side.
                # Keep its exact CAD contours, but give the letter faces black ink.
                surfaces = defaultdict(list)
                for start in range(0, len(face), 3):
                    triangle = face[start:start + 3]
                    lettering = all(abs(vertices[v[0]][0] + 4.548738) < .00002
                                    and normals[v[-1]][0] < -.999 for v in triangle)
                    surfaces['shell-silkscreen' if lettering else 'abs-plastic'].extend(triangle)
            for physical, surface in surfaces.items():
                append_surface(buckets, assembly, physical, i, surface, vertices, normals)

    write_glb(buckets, groups, destination)
    audit(destination, repair=True)


def append_surface(buckets, assembly, physical, solid, face, vertices, normals):
    key = (assembly, physical)
    bucket = buckets.setdefault(key, {'positions': array('f'), 'normals': array('f'), 'indices': array('I'), 'seen': {}, 'solids': set()})
    bucket['solids'].add(solid)
    for vertex in face:
        pair = (vertex[0], vertex[-1])
        if pair not in bucket['seen']:
            bucket['seen'][pair] = len(bucket['positions']) // 3
            bucket['positions'].extend(vertices[pair[0]])
            bucket['normals'].extend(normals[pair[1]])
        bucket['indices'].append(bucket['seen'][pair])


def write_glb(buckets, groups, destination):
    document = {'asset': {'version': '2.0', 'generator': 'Watering platform four-assembly OBJ exporter'}, 'scene': 0,
                'scenes': [{'nodes': [0, 1, 2, 3]}], 'nodes': [{'name': name, 'children': []} for name in ASSEMBLIES],
                'meshes': [], 'materials': [], 'accessors': [], 'bufferViews': [], 'buffers': []}
    binary = bytearray()

    def accessor(data, kind, component, target, bounds=False):
        binary.extend(b'\0' * (-len(binary) % 4))
        view = {'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data) * data.itemsize, 'target': target}
        binary.extend(data.tobytes()); document['bufferViews'].append(view)
        item = {'bufferView': len(document['bufferViews']) - 1, 'componentType': component,
                'count': len(data) // (3 if kind == 'VEC3' else 1), 'type': kind}
        if bounds:
            item.update(min=[min(data[j::3]) for j in range(3)], max=[max(data[j::3]) for j in range(3)])
        document['accessors'].append(item)
        return len(document['accessors']) - 1

    materials = {}
    for (assembly, physical), bucket in buckets.items():
        if physical not in materials:
            materials[physical] = len(document['materials'])
            document['materials'].append({'name': physical, 'pbrMetallicRoughness': {'baseColorFactor': [.3, .3, .3, 1], 'metallicFactor': 0, 'roughnessFactor': .6}})
        primitive = {'attributes': {'POSITION': accessor(bucket['positions'], 'VEC3', 5126, 34962, True),
                                    'NORMAL': accessor(bucket['normals'], 'VEC3', 5126, 34962)},
                     'indices': accessor(bucket['indices'], 'SCALAR', 5125, 34963), 'material': materials[physical]}
        document['nodes'][assembly]['children'].append(len(document['nodes']))
        document['nodes'].append({'name': f'{ASSEMBLIES[assembly]}-{physical}', 'mesh': len(document['meshes']),
                                  'extras': {'sourceSolids': sorted(bucket['solids']), 'physicalMaterial': physical}})
        document['meshes'].append({'primitives': [primitive]})
    document['buffers'] = [{'byteLength': len(binary)}]
    metadata = json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    metadata += b' ' * (-len(metadata) % 4); binary.extend(b'\0' * (-len(binary) % 4))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(struct.pack('<III', 0x46546C67, 2, 28 + len(metadata) + len(binary))
                           + struct.pack('<II', len(metadata), 0x4E4F534A) + metadata
                           + struct.pack('<II', len(binary), 0x004E4942) + binary)
    print(f'{len(groups)} solids -> {len(ASSEMBLIES)} assemblies, {len(buckets)} meshes, {destination.stat().st_size:,} bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'static/assets/models/watering-box-9-30ver.glb')
    args = parser.parse_args()
    convert(args.source, args.output)
