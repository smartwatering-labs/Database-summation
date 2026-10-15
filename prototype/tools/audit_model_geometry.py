"""Audit triangle winding against CAD normals; optionally repair the local GLB.

Preserves positions, normals, UVs, material roles and assembly ownership. Only
flat faces whose three normals agree may be reversed. Zero-area triangles and
reversed slivers below 1e-8 square source units are omitted. Tiny valid details
are retained. This is a rendering audit, not a manufacturing check.
"""
import argparse
import json
import math
import struct
from pathlib import Path


def audit(path, repair=False):
    data = path.read_bytes()
    length = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + length])
    binary = bytearray(data[28 + length:])
    report = []

    def read(index):
        a = gltf['accessors'][index]
        view = gltf['bufferViews'][a['bufferView']]
        count = a['count'] * (3 if a['type'] == 'VEC3' else 1)
        code = 'f' if a['componentType'] == 5126 else 'I'
        return struct.unpack_from('<' + str(count) + code, binary,
                                  view.get('byteOffset', 0) + a.get('byteOffset', 0))

    for node in gltf['nodes']:
        if 'mesh' not in node:
            continue
        for primitive in gltf['meshes'][node['mesh']]['primitives']:
            p, n = (read(primitive['attributes'][key]) for key in ('POSITION', 'NORMAL'))
            indices = read(primitive['indices'])
            issue = {'mesh': node['name'], 'triangles': len(indices) // 3,
                     'slivers': 0, 'reversedFlatFaces': 0, 'unresolvedNormals': 0}
            issue['maxNormalLengthError'] = max(abs(math.hypot(*n[j:j + 3]) - 1) for j in range(0, len(n), 3))
            fixed = []
            for start in range(0, len(indices), 3):
                ids = list(indices[start:start + 3])
                a, b, c = [i * 3 for i in ids]
                u, v = ([p[b + k] - p[a + k] for k in range(3)], [p[c + k] - p[a + k] for k in range(3)])
                cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
                area2 = math.hypot(*cross)
                if area2 < 1e-10:
                    issue['slivers'] += 1
                    continue
                direction = sum(cross[k] * (n[a+k]+n[b+k]+n[c+k])/3 for k in range(3)) / area2
                if direction < -.01:
                    if area2 < 2e-8:
                        issue['slivers'] += 1
                        continue
                    flat = all(sum(n[a+k]*n[j+k] for k in range(3)) > .9999 for j in (b, c))
                    if flat:
                        issue['reversedFlatFaces'] += 1
                        ids[1], ids[2] = ids[2], ids[1]
                    else:
                        issue['unresolvedNormals'] += 1
                fixed.extend(ids)
            if repair:
                accessor = gltf['accessors'][primitive['indices']]
                view = gltf['bufferViews'][accessor['bufferView']]
                offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
                struct.pack_into('<' + str(len(fixed)) + 'I', binary, offset, *fixed)
                # Leave unreferenced padding in place so all other buffer offsets
                # and vertex payloads remain byte-for-byte unchanged.
                accessor['count'] = len(fixed)
                view['byteLength'] = len(fixed) * 4
            report.append(issue)
    if repair:
        metadata = json.dumps(gltf, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        metadata += b' ' * (-len(metadata) % 4)
        path.write_bytes(struct.pack('<III', 0x46546C67, 2, 28 + len(metadata) + len(binary))
                         + struct.pack('<II', len(metadata), 0x4E4F534A) + metadata
                         + struct.pack('<II', len(binary), 0x004E4942) + binary)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('model', type=Path)
    parser.add_argument('--repair', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    result = audit(args.model, args.repair)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'meshes': len(result), 'triangles': sum(m['triangles'] for m in result),
                      'slivers': sum(m['slivers'] for m in result),
                      'reversedFlatFaces': sum(m['reversedFlatFaces'] for m in result),
                      'unresolvedNormals': sum(m['unresolvedNormals'] for m in result)}, ensure_ascii=False))
