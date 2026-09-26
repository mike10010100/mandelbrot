// Interactive Minimap showing global overview of the Mandelbrot set
// and an overlay viewfinder showing current camera position and zoom

export class Minimap {
    constructor(canvas, onNavigate) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onNavigate = onNavigate;

        // Mandelbrot bounding box for minimap
        this.minX = -2.1;
        this.maxX = 0.9;
        this.minY = -1.25;
        this.maxY = 1.25;

        this.width = canvas.width;
        this.height = canvas.height;

        this.isDragging = false;
        this.baseImage = null;

        this.initBaseMandelbrot();
        this.setupEvents();
    }

    initBaseMandelbrot() {
        const w = this.width;
        const h = this.height;
        const imgData = this.ctx.createImageData(w, h);
        const data = imgData.data;

        for (let py = 0; py < h; py++) {
            const y0 = this.maxY - (py / h) * (this.maxY - this.minY);
            for (let px = 0; px < w; px++) {
                const x0 = this.minX + (px / w) * (this.maxX - this.minX);

                let x = 0.0;
                let y = 0.0;
                let iter = 0;
                const maxIter = 40;

                while (x * x + y * y <= 4.0 && iter < maxIter) {
                    const xtemp = x * x - y * y + x0;
                    y = 2 * x * y + y0;
                    x = xtemp;
                    iter++;
                }

                const idx = (py * w + px) * 4;
                if (iter === maxIter) {
                    // Interior - deep dark navy
                    data[idx] = 12;
                    data[idx + 1] = 16;
                    data[idx + 2] = 28;
                    data[idx + 3] = 255;
                } else {
                    // Exterior subtle glow
                    const t = iter / maxIter;
                    data[idx] = Math.round(30 + 180 * t);
                    data[idx + 1] = Math.round(50 + 140 * t);
                    data[idx + 2] = Math.round(90 + 165 * (1 - t));
                    data[idx + 3] = 220;
                }
            }
        }

        // Cache base image
        createImageBitmap(imgData).then(bitmap => {
            this.baseImage = bitmap;
            this.draw();
        });
    }

    setupEvents() {
        const handleInteraction = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const clientX = e.clientX ?? (e.touches && e.touches[0].clientX);
            const clientY = e.clientY ?? (e.touches && e.touches[0].clientY);
            if (clientX === undefined) return;

            const px = (clientX - rect.left) / rect.width * this.width;
            const py = (clientY - rect.top) / rect.height * this.height;

            const targetX = this.minX + (px / this.width) * (this.maxX - this.minX);
            const targetY = this.maxY - (py / this.height) * (this.maxY - this.minY);

            if (this.onNavigate) {
                this.onNavigate(targetX, targetY);
            }
        };

        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            handleInteraction(e);
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                handleInteraction(e);
            }
        });

        window.addEventListener('mouseup', () => {
            this.isDragging = false;
        });

        this.canvas.addEventListener('touchstart', (e) => {
            this.isDragging = true;
            handleInteraction(e);
            e.preventDefault();
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            if (this.isDragging) {
                handleInteraction(e);
            }
            e.preventDefault();
        }, { passive: false });

        this.canvas.addEventListener('touchend', () => {
            this.isDragging = false;
        });
    }

    updateViewport(state, aspect) {
        this.currentCenter = { x: state.centerX, y: state.centerY };
        this.currentScale = 3.0 / state.zoom;
        this.currentAspect = aspect;
        this.draw();
    }

    draw() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.clearRect(0, 0, w, h);

        if (this.baseImage) {
            ctx.drawImage(this.baseImage, 0, 0);
        }

        if (!this.currentCenter) return;

        // Calculate viewfinder rectangle in minimap canvas coordinates
        const scaleX = this.currentScale;
        const scaleY = this.currentScale;
        const hw = (scaleX * Math.max(1, this.currentAspect)) / 2;
        const hh = (scaleY * Math.max(1, 1 / this.currentAspect)) / 2;

        const leftX = this.currentCenter.x - hw;
        const rightX = this.currentCenter.x + hw;
        const topY = this.currentCenter.y + hh;
        const bottomY = this.currentCenter.y - hh;

        const px1 = ((leftX - this.minX) / (this.maxX - this.minX)) * w;
        const px2 = ((rightX - this.minX) / (this.maxX - this.minX)) * w;
        const py1 = ((this.maxY - topY) / (this.maxY - this.minY)) * h;
        const py2 = ((this.maxY - bottomY) / (this.maxY - this.minY)) * h;

        const boxX = Math.min(px1, px2);
        const boxY = Math.min(py1, py2);
        const boxW = Math.max(4, Math.abs(px2 - px1));
        const boxH = Math.max(4, Math.abs(py2 - py1));

        // Draw glowing viewfinder
        ctx.save();
        ctx.fillStyle = 'rgba(0, 229, 255, 0.15)';
        ctx.fillRect(boxX, boxY, boxW, boxH);

        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 6;
        ctx.strokeRect(boxX, boxY, boxW, boxH);

        // Center reticle
        const cx = ((this.currentCenter.x - this.minX) / (this.maxX - this.minX)) * w;
        const cy = ((this.maxY - this.currentCenter.y) / (this.maxY - this.minY)) * h;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
    }
}
