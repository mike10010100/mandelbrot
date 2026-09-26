// Cosine Color Gradient Palettes
// IQ (Inigo Quilez) formula: color(t) = a + b * cos(2 * PI * (c * t + d))
// Provides smooth, mathematically infinite cyclic color transitions without banding.

export const PALETTES = [
    {
        id: 'cosmic',
        name: 'Cosmic Nebula',
        description: 'Deep violet, neon cyan, electric blues and starlight',
        a: [0.5, 0.5, 0.5],
        b: [0.5, 0.5, 0.5],
        c: [1.0, 1.0, 1.0],
        d: [0.0, 0.33, 0.67],
        defaultFreq: 1.0
    },
    {
        id: 'fire',
        name: 'Fire & Magma',
        description: 'Obsidian, blazing crimson, liquid gold and solar flare',
        a: [0.5, 0.5, 0.5],
        b: [0.5, 0.5, 0.5],
        c: [2.0, 1.0, 0.0],
        d: [0.5, 0.20, 0.25],
        defaultFreq: 1.2
    },
    {
        id: 'cyberpunk',
        name: 'Electric Cyberpunk',
        description: 'Neon magenta, laser cyan, synthwave yellow and violet',
        a: [0.8, 0.5, 0.4],
        b: [0.2, 0.4, 0.2],
        c: [2.0, 1.0, 1.0],
        d: [0.0, 0.25, 0.25],
        defaultFreq: 1.5
    },
    {
        id: 'emerald',
        name: 'Emerald Matrix',
        description: 'Phosphor green, digital jade, mint bioluminescence and black',
        a: [0.2, 0.7, 0.4],
        b: [0.2, 0.4, 0.2],
        c: [1.0, 2.0, 1.0],
        d: [0.15, 0.35, 0.15],
        defaultFreq: 1.2
    },
    {
        id: 'rainbow',
        name: 'Psychedelic Spectrum',
        description: 'Full high-vibrancy continuous optical spectral hue cycle',
        a: [0.5, 0.5, 0.5],
        b: [0.5, 0.5, 0.5],
        c: [1.0, 1.0, 1.0],
        d: [0.8, 0.90, 0.30],
        defaultFreq: 1.0
    },
    {
        id: 'sunset',
        name: 'Twilight Sunset',
        description: 'Velvet dusk, glowing coral, peach horizon and deep amethyst',
        a: [0.65, 0.45, 0.45],
        b: [0.35, 0.35, 0.35],
        c: [1.2, 1.0, 1.0],
        d: [0.2, 0.4, 0.7],
        defaultFreq: 1.1
    },
    {
        id: 'copper',
        name: 'Copper & Bronze',
        description: 'Steampunk metallic sheen, warm amber and burnished gold',
        a: [0.6, 0.45, 0.3],
        b: [0.4, 0.35, 0.25],
        c: [1.0, 1.0, 1.0],
        d: [0.0, 0.1, 0.2],
        defaultFreq: 1.4
    },
    {
        id: 'monochrome',
        name: 'Monochrome Noir',
        description: 'Dramatic high-contrast silver, charcoal and architectural light',
        a: [0.5, 0.5, 0.5],
        b: [0.5, 0.5, 0.5],
        c: [1.0, 1.0, 1.0],
        d: [0.0, 0.0, 0.0],
        defaultFreq: 0.9
    },
    {
        id: 'toxic',
        name: 'Radioactive Neon',
        description: 'Acid chartreuse, electric lime, deep slate and amber',
        a: [0.4, 0.6, 0.1],
        b: [0.4, 0.4, 0.2],
        c: [2.0, 2.0, 1.0],
        d: [0.0, 0.33, 0.67],
        defaultFreq: 1.3
    },
    {
        id: 'ice',
        name: 'Arctic Glaze',
        description: 'Glacial cyan, crystal cerulean, permafrost white and midnight',
        a: [0.4, 0.6, 0.8],
        b: [0.3, 0.3, 0.2],
        c: [1.0, 1.0, 1.0],
        d: [0.1, 0.2, 0.4],
        defaultFreq: 1.0
    }
];

export function getPalette(id) {
    return PALETTES.find(p => p.id === id) || PALETTES[0];
}

// Evaluates cosine gradient on CPU (used for preview swatches and canvas fallback)
export function evaluatePalette(t, palette) {
    const { a, b, c, d } = palette;
    const PI2 = Math.PI * 2.0;
    const r = Math.min(1.0, Math.max(0.0, a[0] + b[0] * Math.cos(PI2 * (c[0] * t + d[0]))));
    const g = Math.min(1.0, Math.max(0.0, a[1] + b[1] * Math.cos(PI2 * (c[1] * t + d[1]))));
    const bl = Math.min(1.0, Math.max(0.0, a[2] + b[2] * Math.cos(PI2 * (c[2] * t + d[2]))));
    return [Math.round(r * 255), Math.round(g * 255), Math.round(bl * 255)];
}
