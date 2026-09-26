// Live Picture-in-Picture Julia Set Companion Preview
// Dynamically renders the Julia set corresponding to mouse position or viewport center

import { evaluatePalette } from './palettes.js';

export class PipJulia {
    constructor(canvas, onExploreJulia) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onExploreJulia = onExploreJulia;

        this.width = canvas.width;
        this.height = canvas.height;
        this.currentC = [-0.7436, 0.1318];
        this.currentPalette = null;
        this.currentFreq = 1.0;
        this.visible = true;

        this.debounceTimer = null;
        this.isHoveringExplore = false;
    }

    setConstant(cr, ci, palette, freq = 1.0, immediate = false) {
        this.currentC = [cr, ci];
        this.currentPalette = palette;
        this.currentFreq = freq;

        if (immediate) {
            this.render();
        } else {
            if (this.debounceTimer) cancelAnimationFrame(this.debounceTimer);
            this.debounceTimer = requestAnimationFrame(() => this.render());
        }
    }

    render() {
        if (!this.visible || !this.currentPalette) return;

        const w = this.width;
        const h = this.height;
        const imgData = this.ctx.createImageData(w, h);
        const data = imgData.data;

        const [cr, ci] = this.currentC;
        const maxIter = 80;
        const scale = 2.4;

        for (let py = 0; py < h; py++) {
            const zy0 = (1.0 - (py / h) * 2.0) * (scale / 2);
            for (let px = 0; px < w; px++) {
                const zx0 = ((px / w) * 2.0 - 1.0) * (scale / 2);

                let zx = zx0;
                let zy = zy0;
                let iter = 0;

                while (zx * zx + zy * zy <= 4.0 && iter < maxIter) {
                    const xtemp = zx * zx - zy * zy + cr;
                    zy = 2.0 * zx * zy + ci;
                    zx = xtemp;
                    iter++;
                }

                const idx = (py * w + px) * 4;
                if (iter === maxIter) {
                    data[idx] = 10;
                    data[idx + 1] = 12;
                    data[idx + 2] = 20;
                    data[idx + 3] = 255;
                } else {
                    const r2 = zx * zx + zy * zy;
                    const nu = iter + 1.0 - Math.log(0.5 * Math.log(Math.max(1.0, r2))) / Math.log(2.0);
                    const t = nu * 0.05 * this.currentFreq;
                    const [r, g, b] = evaluatePalette(t, this.currentPalette);
                    data[idx] = r;
                    data[idx + 1] = g;
                    data[idx + 2] = b;
                    data[idx + 3] = 255;
                }
            }
        }

        this.ctx.putImageData(imgData, 0, 0);
    }
}
