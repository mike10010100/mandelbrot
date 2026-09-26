# ✦ MANDELBROT 64 — Interactive Fractal Explorer

A hardware-accelerated, high-performance interactive fractal engine running in modern WebGL 2.0 with continuous smooth iteration coloring, emulated 64-bit double precision, live Julia set exploration, interactive minimap navigation, dynamic palette animation, and high-resolution snapshot export.

---

## 🚀 Quick Start

Start the local server with Python or Node:

```bash
# Using Python (recommended)
python3 server.py

# Or using npm / npx
npm start
# or: npx -y serve . -p 8088
```

Then open **[http://127.0.0.1:8088](http://127.0.0.1:8088)** in your browser (Chrome, Firefox, Safari, Edge).

---

## ✨ Features

### 1. ⚡ Ultra-Fast GPU Acceleration & Deep Zoom Perturbation Engine (FP64)
- **WebGL 2.0 Shaders (GLSL ES 3.00)**: Renders at native monitor refresh rates (60 to 120+ FPS) across high-DPI Retina and 4K displays.
- **Continuous Smooth Coloring**: Uses the normalized fractional escape equation $\nu = n + 1 - \frac{\ln(\ln(|z|))}{\ln(2)}$ to eliminate discrete color banding.
- **Perturbation Theory Deep Zoom Pipeline**: To bypass the 32-bit floating point precision barrier ($> 10^5$ zoom) where standard float32 arithmetic collapses into blocky pixelation (and where GPU driver optimizations like Apple Metal's `-ffast-math` fold algebraic double-single emulations), the engine computes a 64-bit IEEE 754 reference orbit $Z_{n+1} = Z_n^2 + C_0$ on the CPU and streams it to the GPU via an `RG32F` texture buffer. The fragment shader then solves the delta recurrence $\Delta z_{n+1} = 2 Z_n \Delta z_n + \Delta z_n^2 + \Delta c$ at full hardware speed, providing razor-sharp, zero-pixelation rendering down to $10^{14}\times$ zoom.

### 2. 🌀 Dual Mandelbrot & Julia Set Modes
- **Live Picture-in-Picture Julia Companion**: As you hover your mouse across the Mandelbrot set, a real-time mini canvas in the corner displays the corresponding Julia set $z_{n+1} = z_n^2 + c$.
- **1-Click Deep Exploration**: Click **"Explore This Julia"** to seamlessly transition into exploring that Julia set with full zoom and pan capabilities.
- **Return to Mandelbrot**: Instantly jump back with a single click.

### 3. 🗺️ Interactive Overview Map
- An overview minimap with a glowing, real-time viewfinder rectangle tracking your current position and zoom level.
- Click or drag anywhere on the minimap to immediately reposition the viewport.

### 4. 🎨 Mathematical Cosine Palettes & Animation
- **Continuous Cosine Gradients**: Based on Inigo Quilez's formula $\mathbf{c}(t) = \mathbf{a} + \mathbf{b} \cos(2\pi(\mathbf{c} \cdot t + \mathbf{d}))$.
- **10 Curated Palettes**: Cosmic Nebula, Fire & Magma, Electric Cyberpunk, Emerald Matrix, Psychedelic Spectrum, Twilight Sunset, Copper & Bronze, Monochrome Noir, Radioactive Neon, and Arctic Glaze.
- **Dynamic Color Animation**: Press `Spacebar` to activate hypnotic continuous palette phase rotation.
- **Interior Shading**: Choose between solid obsidian black, glowing orbit trap depth, or zebra striping.

### 5. 🪐 Multiple Fractal Geometries
- **Mandelbrot Set**: $z_{n+1} = z_n^2 + c$
- **Julia Sets**: $z_{n+1} = z_n^2 + c$ (with custom $c$)
- **Burning Ship Fractal**: $z_{n+1} = (|\text{Re}(z)| + i|\text{Im}(z)|)^2 + c$
- **Cubic Multibrot**: $z_{n+1} = z_n^3 + c$
- **Quartic Multibrot**: $z_{n+1} = z_n^4 + c$

### 6. 📸 High-Resolution Image Export & Permalink Sharing
- **Snapshot Exporter**: Capture current views at Viewport resolution, Full HD (1080p), 2K Quad HD (1440p), or 4K Ultra HD (3840 × 2160) saved directly as PNG.
- **URL Hash Permalinks**: Coordinates, zoom level, iterations, and palette are automatically synced into the browser URL (`#x=...&y=...&z=...`) so any view can be bookmarked and shared.

---

## 🕹️ Controls & Navigation

| Action | Control | Description |
| :--- | :--- | :--- |
| **Pan** | Click & Drag or `W` `A` `S` `D` / Arrows | Smooth pan with momentum inertia |
| **Zoom at Pointer** | Mouse Wheel / Trackpad Scroll | Exponential zoom centered precisely at mouse cursor |
| **Box Zoom** | `Shift` + Click & Drag | Draws a rectangle marquee; zooms to fit on release |
| **Zoom In** | Double Click or `+` / `=` | Zoom in 2x at cursor |
| **Zoom Out** | Right Click or `-` | Zoom out 2x |
| **Touch** | 1-Finger Drag / 2-Finger Pinch | Full mobile & tablet multi-touch gestures |
| **Cycle Palettes** | `C` | Jump to next color palette |
| **Toggle Animation** | `Spacebar` | Start/stop continuous hypnotic color cycling |
| **Toggle Julia Mode** | `J` | Switch between Mandelbrot and Julia set |
| **Zen Mode** | `H` | Hide all UI for clean wallpaper view |
| **Fullscreen** | `F` | Toggle fullscreen mode |
| **Reset View** | `R` | Return to initial full Mandelbrot view |
| **Export Snapshot** | `S` | Open high-resolution export dialog |
| **Help Modal** | `?` | Show interactive shortcut cheat sheet |
| **Quick Presets** | `1` – `9` | Instant jump to curated landmarks |

---

## 📁 Project Architecture

- [`index.html`](file:///Users/mike10010100/git/mandelbrot/index.html) — Application entry point, control dock, HUD bar, minimap overlay, and modals.
- [`css/style.css`](file:///Users/mike10010100/git/mandelbrot/css/style.css) — Glassmorphic styling, responsive layout, sliders, and dark theme.
- [`js/app.js`](file:///Users/mike10010100/git/mandelbrot/js/app.js) — Core application loop, coordinate transforms, touch/mouse interaction, and URL state management.
- [`js/shaders.js`](file:///Users/mike10010100/git/mandelbrot/js/shaders.js) — WebGL 2.0 GLSL fragment shaders (FP32 and FP64 double-single emulation) with smooth coloring.
- [`js/palettes.js`](file:///Users/mike10010100/git/mandelbrot/js/palettes.js) — Mathematical cosine color palettes and CPU preview evaluators.
- [`js/presets.js`](file:///Users/mike10010100/git/mandelbrot/js/presets.js) — Curated coordinates for famous fractal landmarks.
- [`js/minimap.js`](file:///Users/mike10010100/git/mandelbrot/js/minimap.js) — Global overview navigator with interactive viewport bounding box.
- [`js/pip-julia.js`](file:///Users/mike10010100/git/mandelbrot/js/pip-julia.js) — Real-time Picture-in-Picture Julia companion preview.
- [`js/webgl-utils.js`](file:///Users/mike10010100/git/mandelbrot/js/webgl-utils.js) — Shader compilation, program linking, and double-single float splitting.
- [`server.py`](file:///Users/mike10010100/git/mandelbrot/server.py) — Lightweight local HTTP server with automatic browser launch.
