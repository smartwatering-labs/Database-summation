// One local photography setup for the shared scene. Values are scene units,
// linear light intensities and sRGB material colours; no downloaded HDRI.
export const productStudio = {
  renderer: { exposure: .95, maxPixelRatio: 1.5 },
  shell: {
    color: 0xf3f2ef, metalness: 0, roughness: .38,
    ior: 1.48, specularIntensity: 1, clearcoat: .015,
    clearcoatRoughness: .42, envMapIntensity: .32,
  },
  environment: {
    background: 0x9d9fa2, blur: .06,
    cards: [
      { position: [-5, 6, 5], size: [7, 6], power: 3.4 },
      { position: [6, 2, 4], size: [3, 7], power: 1.2 },
      { position: [2, 5, -6], size: [6, 4], power: 3 },
      { position: [-1, 0, 8], size: [3, 8], power: 1.4 },
    ],
  },
  lights: {
    hemisphere: { sky: 0xffffff, ground: 0xc1c4c8, intensity: .16 },
    key: { position: [-3.5, 4, 4], size: [4, 5], color: 0xfffcf7, intensity: 5 },
    fill: { position: [5, 1, 3], size: [3, 5], color: 0xf8faff, intensity: 1.8 },
    rim: { position: [-1, 3.5, -6.5], size: [6, 1.5], color: 0xffffff, intensity: 3 },
    shadow: { position: [-.6, 14, 4], intensity: .15, mapSize: 1536, extent: 6, normalBias: .012, bias: -.0001, radius: 7, blurSamples: 10 },
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
  ground: { homeOpacity: .13, productOpacity: .09, sizeRatio: 2.5, gap: .005, fadeInMs: 240, fadeOutMs: 120 },
};
