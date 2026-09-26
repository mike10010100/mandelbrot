// Curated presets for Mandelbrot, Julia, and Burning Ship fractals
// Coordinates, zoom levels, iteration counts, and recommended palettes

export const PRESETS = [
    {
        id: 'overview',
        name: 'Full Mandelbrot View',
        category: 'Classic',
        type: 0, // Mandelbrot
        centerX: -0.65,
        centerY: 0.0,
        zoom: 0.85,
        iterations: 200,
        paletteId: 'cosmic',
        description: 'Complete view of the iconic cardioid and circular bulbs'
    },
    {
        id: 'seahorse_valley',
        name: 'Seahorse Valley',
        category: 'Spirals & Valleys',
        type: 0,
        centerX: -0.7436438870371587,
        centerY: 0.1318259042053119,
        zoom: 45000,
        iterations: 600,
        paletteId: 'cyberpunk',
        description: 'Interlocking dual seahorse tail spirals along the main cusp'
    },
    {
        id: 'deep_seahorse_spire',
        name: 'Deep Seahorse Spire (450k Zoom)',
        category: 'Spirals & Valleys',
        type: 0,
        centerX: -0.7436438870371587,
        centerY: 0.1318259042053119,
        zoom: 450000,
        iterations: 1200,
        paletteId: 'fire',
        description: 'Microscopic vortex spiral deep inside Seahorse Valley'
    },
    {
        id: 'elephant_valley',
        name: 'Elephant Valley',
        category: 'Spirals & Valleys',
        type: 0,
        centerX: 0.275,
        centerY: 0.006,
        zoom: 350,
        iterations: 400,
        paletteId: 'sunset',
        description: 'Majestic marching fractal elephant trunks on the real axis'
    },
    {
        id: 'triple_spiral',
        name: 'Scepter & Triple Spiral',
        category: 'Spirals & Valleys',
        type: 0,
        centerX: -0.1002,
        centerY: 0.8383,
        zoom: 1800,
        iterations: 500,
        paletteId: 'fire',
        description: 'Three-armed whirling galactic arms between period bulbs'
    },
    {
        id: 'mini_mandelbrot',
        name: 'Satellite Mini-Brot',
        category: 'Deep Wonders',
        type: 0,
        centerX: -1.768778833,
        centerY: -0.001738994,
        zoom: 38000,
        iterations: 1200,
        paletteId: 'cosmic',
        description: 'A perfect miniature replica Mandelbrot embedded deep in antenna filaments'
    },
    {
        id: 'satellite_antenna',
        name: 'Needle Antenna Minibrots',
        category: 'Deep Wonders',
        type: 0,
        centerX: -1.7497561,
        centerY: 0.0,
        zoom: 3500,
        iterations: 800,
        paletteId: 'toxic',
        description: 'Nested fractal antennas along the main spike of the cardioid'
    },
    {
        id: 'lightning_needle',
        name: 'Lightning Needle',
        category: 'Deep Wonders',
        type: 0,
        centerX: -0.745428,
        centerY: 0.113009,
        zoom: 16000,
        iterations: 750,
        paletteId: 'emerald',
        description: 'Electrified dendrites pulsing through microscopic chasms'
    },
    {
        id: 'starfish_spirals',
        name: 'Starfish Galaxy',
        category: 'Deep Wonders',
        type: 0,
        centerX: -0.74989,
        centerY: 0.05322,
        zoom: 14000,
        iterations: 800,
        paletteId: 'rainbow',
        description: 'Multi-symmetric pinwheel vortex with glowing tentacles'
    },
    {
        id: 'feather_nebula',
        name: 'Feather Nebula',
        category: 'Deep Wonders',
        type: 0,
        centerX: -0.16070135,
        centerY: 1.0375665,
        zoom: 1200,
        iterations: 500,
        paletteId: 'ice',
        description: 'Delicate crystalline plumes radiating out into infinity'
    },
    // Ultra-Deep Double-Double (FP106) wonders (10^18 to 10^28 zoom)
    {
        id: 'fp106_elephant_spiral',
        name: 'Elephant Valley Spiral (1.14e18 Zoom)',
        category: 'Ultra-Deep (FP106)',
        type: 0,
        centerX: 0.2617331068522581,
        centerY: 0.0019088714018098115,
        centerX_str: '0.2617331068522581094379944415',
        centerY_str: '0.00190887140180981147845359632',
        zoom: 1.14e18,
        iterations: 3950,
        paletteId: 'fire',
        description: '106-bit double-double resolution of microscopic spiral swirls at 10^18x magnification'
    },
    {
        id: 'fp106_deep_tendril',
        name: 'Deep Tendril Vortex (5.25e20 Zoom)',
        category: 'Ultra-Deep (FP106)',
        type: 0,
        centerX: 0.265571753852993,
        centerY: 0.0029724527621191567,
        centerX_str: '0.26557175385299295977317512431045',
        centerY_str: '0.0029724527621191566863238539335865',
        zoom: 5.25e20,
        iterations: 2500,
        paletteId: 'cyberpunk',
        description: 'Electrified logarithmic tendril galaxy deep within the boundary at 5.25 × 10^20x zoom'
    },
    {
        id: 'fp106_needle_minibrot',
        name: 'Needle Satellite Brot (3.81e20 Zoom)',
        category: 'Ultra-Deep (FP106)',
        type: 0,
        centerX: -0.6418858965635481,
        centerY: 0.0000000860930859,
        centerX_str: '-0.64188589656354808793146967261',
        centerY_str: '0.0000000860930859117602508121328612544',
        zoom: 3.81e20,
        iterations: 3200,
        paletteId: 'cosmic',
        description: 'Flawless satellite minibrot suspended on a 10^-20 filament needle'
    },
    {
        id: 'fp106_dumbbell_nebula',
        name: 'Dumbbell Nebula (3.55e28 Zoom)',
        category: 'Ultra-Deep (FP106)',
        type: 0,
        centerX: 0.36544123740689855,
        centerY: 0.362798255861987,
        centerX_str: '0.365441237406898537275634464919826944709',
        centerY_str: '0.3627982558619870213261499227436402711285',
        zoom: 3.55e28,
        iterations: 3000,
        paletteId: 'rainbow',
        description: 'The absolute outer limit of Double-Double precision: 3.55 × 10^28x magnification'
    },
    // Julia sets
    {
        id: 'douady_rabbit',
        name: "Douady's Rabbit (Julia)",
        category: 'Julia Sets',
        type: 1, // Julia
        centerX: 0.0,
        centerY: 0.0,
        zoom: 1.1,
        iterations: 350,
        paletteId: 'sunset',
        juliaC: [-0.123, 0.745],
        description: 'Classic three-eared rotational symmetry discovered by Adrien Douady'
    },
    {
        id: 'san_marco',
        name: 'San Marco Dragon (Julia)',
        category: 'Julia Sets',
        type: 1,
        centerX: 0.0,
        centerY: 0.0,
        zoom: 1.1,
        iterations: 300,
        paletteId: 'fire',
        juliaC: [-0.75, 0.0],
        description: 'Resembles the Basilica di San Marco arches and jagged dragon curves'
    },
    {
        id: 'dendrite_tree',
        name: 'Infinite Dendrite (Julia)',
        category: 'Julia Sets',
        type: 1,
        centerX: 0.0,
        centerY: 0.0,
        zoom: 1.0,
        iterations: 400,
        paletteId: 'emerald',
        juliaC: [0.0, 1.0],
        description: 'Pure tree-like branching fractal with no interior area'
    },
    {
        id: 'siegel_disk',
        name: 'Siegel Disk / Golden Ratio (Julia)',
        category: 'Julia Sets',
        type: 1,
        centerX: 0.0,
        centerY: 0.0,
        zoom: 1.1,
        iterations: 500,
        paletteId: 'copper',
        juliaC: [-0.391, -0.587],
        description: 'Smooth conformal rotation disc surrounded by turbulent chaos'
    },
    {
        id: 'electric_swirls',
        name: 'Electric Swirls (Julia)',
        category: 'Julia Sets',
        type: 1,
        centerX: 0.0,
        centerY: 0.0,
        zoom: 1.15,
        iterations: 400,
        paletteId: 'cyberpunk',
        juliaC: [-0.8, 0.156],
        description: 'Disconnecting Cantor dust clouds with luminous whirlpools'
    },
    // Burning Ship fractal
    {
        id: 'burning_ship_main',
        name: 'Burning Ship Overview',
        category: 'Burning Ship',
        type: 2, // Burning Ship
        centerX: -0.45,
        centerY: -0.5,
        zoom: 0.8,
        iterations: 300,
        paletteId: 'fire',
        description: 'Non-analytic absolute-value fractal resembling a burning ghost galleon'
    },
    {
        id: 'burning_ship_armada',
        name: 'Ghost Armada & Masts',
        category: 'Burning Ship',
        type: 2,
        centerX: -1.75,
        centerY: -0.03,
        zoom: 80,
        iterations: 600,
        paletteId: 'fire',
        description: 'Intricate rigging and burning masts drifting along the needle'
    },
    // Multibrot
    {
        id: 'multibrot_cubic',
        name: 'Cubic Multibrot (z^3 + c)',
        category: 'Higher Powers',
        type: 3, // Multibrot 3
        centerX: 0.0,
        centerY: 0.0,
        zoom: 0.9,
        iterations: 300,
        paletteId: 'rainbow',
        description: 'Two-lobed cardioid symmetric fractal governed by cubic mapping'
    },
    {
        id: 'multibrot_quartic',
        name: 'Quartic Multibrot (z⁴ + c)',
        category: 'Higher Powers',
        type: 4, // Multibrot 4
        centerX: 0.0,
        centerY: 0.0,
        zoom: 0.9,
        iterations: 300,
        paletteId: 'toxic',
        description: 'Three-lobed rotational symmetry governed by fourth-power mapping'
    }
];
