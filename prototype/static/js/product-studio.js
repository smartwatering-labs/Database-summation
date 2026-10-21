// One local photography setup for the shared scene. Values are scene units,
// linear light intensities and sRGB material colours; no downloaded HDRI.
export const productStudio = {
  renderer: { exposure: 1, maxPixelRatio: 1.5, maxViewportPixels: 3300000 },
  shell: {
    color: 0xdce0e2, metalness: 0, roughness: .94,
    ior: 1.48, specularIntensity: .26, clearcoat: 0,
    clearcoatRoughness: 1, envMapIntensity: .16,
  },
  environment: {
    background: 0x7e858b, blur: .04, resolution: 128,
    cards: [
      { position: [-5, 7, 4], size: [5, 6], power: 4.4 },
      { position: [6, 2, 4], size: [2, 6], power: .65 },
      { position: [3, 4, -5], size: [2, 7], power: 5 },
      { position: [-1, 0, 8], size: [3, 7], power: .6 },
    ],
  },
  lights: {
    hemisphere: { sky: 0xf5f8ff, ground: 0x747e87, intensity: .2 },
    key: { position: [-4, 5, 5], size: [4, 5], color: 0xfffaf2, intensity: 7.5 },
    fill: { position: [5, 1, 3], size: [3, 5], color: 0xe5edff, intensity: 1.4 },
    rim: { position: [3, 4, -5], size: [2, 6], color: 0xffffff, intensity: 5 },
    shadow: { position: [-.6, 24, 1], intensity: .3, mapSize: 1536, extent: 6, normalBias: .012, bias: -.0001, radius: 9, blurSamples: 12 },
  },
  finishes: {
    'solder-mask': [0x07527d, 0, .52],
    'fr4-edge': [0x8b7944, 0, .8],
    'silkscreen': [0xe9eee8, 0, .8],
    'ic-epoxy': [0x111318, 0, .82],
    'connector-polymer': [0x17191d, 0, .42],
    'gold-contact': [0xd8b566, .96, .24],
    'solder': [0xbec3c7, .92, .34],
    'nickel': [0xc4c8cb, .96, .23],
    'ceramic': [0xb49c7d, 0, .62],
    'tantalum': [0xb57d35, 0, .52],
    'insulator': [0xd8d5c9, 0, .52],
    'indicator-lens': [0x2f7062, 0, .18],
  },
  ground: { homeOpacity: .16, productOpacity: .10, sizeRatio: 2.5, gap: .005, fadeInMs: 240, fadeOutMs: 120 },
};
