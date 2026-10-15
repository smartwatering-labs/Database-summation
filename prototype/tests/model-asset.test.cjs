const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const folder = path.resolve(__dirname, '../static/assets/models');
const config = JSON.parse(fs.readFileSync(path.join(folder, 'model.json')));
const bytes = fs.readFileSync(path.join(folder, path.basename(config.url)));
assert.equal(bytes.readUInt32LE(0), 0x46546c67);
assert.equal(bytes.readUInt32LE(8), bytes.length);
const length = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.subarray(20, 20 + length));
const binary = bytes.subarray(28 + length);
const assemblies = gltf.scenes[gltf.scene].nodes.map(i => gltf.nodes[i]);
assert.deepEqual(assemblies.map(n => n.name), ['外壳-顶盖', '上层主板', '下层主板', '外壳-底壳']);
const owners = new Map();
function values(id) {
  const a = gltf.accessors[id], view = gltf.bufferViews[a.bufferView];
  const stride = a.type === 'VEC3' ? 3 : 1, out = [];
  for (let i = 0; i < a.count * stride; i++) {
    const offset = (view.byteOffset || 0) + (a.byteOffset || 0) + i * 4;
    out.push(a.componentType === 5126 ? binary.readFloatLE(offset) : binary.readUInt32LE(offset));
  }
  return out;
}
let ceiling = -Infinity, baseTop = -Infinity;
for (const assembly of assemblies) for (const child of assembly.children) {
  const node = gltf.nodes[child];
  for (const solid of node.extras.sourceSolids) {
    if (owners.has(solid)) assert.equal(owners.get(solid), assembly.name, 'whole component follows exactly one assembly');
    owners.set(solid, assembly.name);
  }
  for (const primitive of gltf.meshes[node.mesh].primitives) {
    const positions = values(primitive.attributes.POSITION), normals = values(primitive.attributes.NORMAL), indices = values(primitive.indices);
    assert.equal(positions.length, normals.length);
    assert.equal(indices.length % 3, 0);
    assert.ok(positions.every(Number.isFinite) && normals.every(Number.isFinite));
    assert.ok(indices.every(index => index < positions.length / 3), 'every triangle references existing vertices');
    for (let j = 0; j < normals.length; j += 3) assert.ok(Math.abs(Math.hypot(...normals.slice(j, j + 3)) - 1) < .001, 'CAD normals are unit length');
    for (let j = 0; j < indices.length; j += 3) {
      const [a,b,c] = indices.slice(j,j+3).map(i=>i*3);
      const u = [0,1,2].map(k=>positions[b+k]-positions[a+k]), v = [0,1,2].map(k=>positions[c+k]-positions[a+k]);
      const cross = [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]], length = Math.hypot(...cross);
      assert.ok(length > 1e-10, 'no zero-area triangles');
      const agreement = cross.reduce((sum,value,k)=>sum+value*(normals[a+k]+normals[b+k]+normals[c+k])/3,0)/length;
      assert.ok(agreement >= -.01, `triangle winding agrees with CAD normals: ${node.name} triangle ${j/3}`);
    }
    for (let i = 2; i < positions.length; i += 3) {
      if (assembly.name === '外壳-顶盖' && normals[i] < -.999) ceiling = Math.max(ceiling, positions[i]);
      if (assembly.name === '外壳-底壳') baseTop = Math.max(baseTop, positions[i]);
    }
  }
}
assert.equal(owners.size, 648, 'no CAD solid lost during layer/material splitting');
const shellInk = assemblies[3].children.map(i => gltf.nodes[i]).find(n => n.extras.physicalMaterial === 'shell-silkscreen');
assert.ok(shellInk, 'switch-side ON/OFF lettering has its own ink material');
assert.deepEqual(shellInk.extras.sourceSolids, [647], 'lettering remains attached to the base shell');
const inkPrimitive = gltf.meshes[shellInk.mesh].primitives[0];
assert.equal(values(inkPrimitive.indices).length / 3, 156, 'all original letter contours retained');
const inkPositions = values(inkPrimitive.attributes.POSITION);
assert.ok(inkPositions.filter((_,i) => i % 3 === 0).every(x => Math.abs(x + 4.548738) < .00002), 'ink is confined to original switch lettering');
assert.ok(gltf.materials.some(m => m.name === 'abs-plastic') && !gltf.materials.some(m => m.name === 'aluminum'), 'shell uses ABS material roles');
for (let i = 0; i < 648; i++) assert.ok(owners.has(i));
assert.equal(owners.get(0), '上层主板'); assert.equal(owners.get(425), '下层主板');
const lid = config.parts.find(p => p.name === '外壳-顶盖');
const base = config.parts.find(p => p.name === '外壳-底壳');
const gap = ceiling + lid.states.home.offset[2] - baseTop - base.states.home.offset[2];
assert.ok(gap >= 0 && gap < .05, `telescoping lid seats over the base with only assembly clearance: ${gap}`);
console.log(`PASS: four separate assemblies, 648 intact CAD solids, valid geometry, seated lid clearance ${gap.toFixed(4)}`);
