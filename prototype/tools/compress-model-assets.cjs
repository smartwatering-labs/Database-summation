// Offline, lossless compression. No runtime compressor or build dependency.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'../static');
const files=[
 'assets/models/watering-box-9-30ver.glb',
 'vendor/three/build/three.module.js',
 'vendor/three/build/three.core.js',
 'vendor/three/addons/lights/RectAreaLightTexturesLib.js',
 'vendor/three/addons/loaders/GLTFLoader.js',
 'vendor/three/addons/utils/BufferGeometryUtils.js',
];
let original=0,compressed=0;
for(const file of files){
 const source=fs.readFileSync(path.join(root,file));
 const packed=zlib.gzipSync(source,{level:9});
 if(!zlib.gunzipSync(packed).equals(source))throw Error(`Round-trip mismatch: ${file}`);
 fs.writeFileSync(path.join(root,file+'.gz'),packed);
 original+=source.length;compressed+=packed.length;
 console.log(`${file}: ${source.length} -> ${packed.length} bytes`);
}
console.log(`Total: ${original} -> ${compressed} bytes (${(100*(1-compressed/original)).toFixed(1)}% smaller)`);
