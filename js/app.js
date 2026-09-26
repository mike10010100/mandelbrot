// Main Application Controller for Interactive Mandelbrot Fractal Explorer
import { PALETTES, getPalette } from './palettes.js';
import { PRESETS } from './presets.js';
import { VERTEX_SHADER, FRAGMENT_SHADER_SINGLE, FRAGMENT_SHADER_DOUBLE, FRAGMENT_SHADER_PERTURBATION } from './shaders.js';
import { createProgram, setupQuad, splitFloat } from './webgl-utils.js';
import { Minimap } from './minimap.js';
import { PipJulia } from './pip-julia.js';

export class MandelbrotApp {
    constructor() {
        this.canvas = document.getElementById('glCanvas');
        this.gl = this.canvas.getContext('webgl2', {
            antialias: false,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance'
        });

        if (!this.gl) {
            this.handleNoWebGL();
            return;
        }

        // State
        this.state = {
            centerX: -0.65,
            centerY: 0.0,
            zoom: 0.85,
            maxIterations: 250,
            autoIterations: true,
            fractalType: 0, // 0=Mandelbrot, 1=Julia, 2=Burning Ship, 3=Multibrot 3, 4=Multibrot 4
            juliaC: [-0.7436, 0.1318],
            palette: PALETTES[0],
            paletteFreq: 1.0,
            palettePhase: 0.0,
            animateColor: false,
            colorSpeed: 0.002,
            precisionMode: 'auto', // 'auto', 'single', 'double'
            interiorMode: 1, // 0: black, 1: glow, 2: stripes
            dpr: Math.min(window.devicePixelRatio || 1, 2)
        };

        // Animation / Rendering timing
        this.animating = false;
        this.needsRender = true;
        this.lastFrameTime = performance.now();
        this.frameCount = 0;
        this.fps = 60;
        this.fpsTimer = performance.now();

        // Fly-to camera transition
        this.cameraAnimation = null;

        // Interaction state
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        this.centerAtDragStart = { x: 0, y: 0 };
        this.momentum = { vx: 0, vy: 0 };
        this.lastPointerPos = { x: 0, y: 0 };
        this.lastPointerTime = 0;

        // Touch pinch-to-zoom
        this.activePointers = new Map();
        this.initialPinchDistance = 0;
        this.initialPinchZoom = 1;
        this.pinchCenter = { x: 0, y: 0 };

        // Box zoom (Shift + Drag)
        this.isBoxZooming = false;
        this.boxZoomStart = { x: 0, y: 0 };
        this.boxZoomCurrent = { x: 0, y: 0 };
        this.boxZoomBox = document.getElementById('boxZoomOverlay');

        this.initWebGL();
        this.initSubsystems();
        this.initUI();
        this.initEvents();
        this.loadFromHash();

        // Start render loop
        this.startLoop();
    }

    handleNoWebGL() {
        const modal = document.getElementById('fallbackModal');
        if (modal) modal.classList.remove('hidden');
        console.error('WebGL 2.0 is required but not supported on this device/browser.');
    }

    initWebGL() {
        const gl = this.gl;

        // Compile single-precision, double-precision, and perturbation programs
        try {
            this.programSingle = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER_SINGLE);
            this.locationsSingle = this.cacheUniformLocations(this.programSingle, false);

            this.programDouble = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER_DOUBLE);
            this.locationsDouble = this.cacheUniformLocations(this.programDouble, true);

            this.programPerturbation = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER_PERTURBATION);
            this.locationsPerturbation = this.cachePerturbationLocations(this.programPerturbation);
        } catch (e) {
            console.error('Shader initialization failed:', e);
            alert('Shader compilation error: ' + e.message);
            return;
        }

        // Initialize 1D RG32F reference orbit texture for deep zoom perturbation
        this.refOrbitTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.refOrbitTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, 4096, 1, 0, gl.RG, gl.FLOAT, null);

        this.refOrbitData = new Float32Array(4096 * 2);
        this.refOrbitCache = null;

        this.quadVao = setupQuad(gl);
        this.resize();
    }

    cacheUniformLocations(program, isDouble) {
        const gl = this.gl;
        const locs = {
            u_resolution: gl.getUniformLocation(program, 'u_resolution'),
            u_max_iterations: gl.getUniformLocation(program, 'u_max_iterations'),
            u_fractal_type: gl.getUniformLocation(program, 'u_fractal_type'),
            u_julia_c: gl.getUniformLocation(program, 'u_julia_c'),
            u_palette_a: gl.getUniformLocation(program, 'u_palette_a'),
            u_palette_b: gl.getUniformLocation(program, 'u_palette_b'),
            u_palette_c: gl.getUniformLocation(program, 'u_palette_c'),
            u_palette_d: gl.getUniformLocation(program, 'u_palette_d'),
            u_palette_freq: gl.getUniformLocation(program, 'u_palette_freq'),
            u_palette_phase: gl.getUniformLocation(program, 'u_palette_phase'),
            u_interior_mode: gl.getUniformLocation(program, 'u_interior_mode')
        };

        if (isDouble) {
            locs.u_center_hi = gl.getUniformLocation(program, 'u_center_hi');
            locs.u_center_lo = gl.getUniformLocation(program, 'u_center_lo');
            locs.u_scale_hi = gl.getUniformLocation(program, 'u_scale_hi');
            locs.u_scale_lo = gl.getUniformLocation(program, 'u_scale_lo');
        } else {
            locs.u_center = gl.getUniformLocation(program, 'u_center');
            locs.u_scale = gl.getUniformLocation(program, 'u_scale');
        }

        return locs;
    }

    cachePerturbationLocations(program) {
        const gl = this.gl;
        return {
            u_resolution: gl.getUniformLocation(program, 'u_resolution'),
            u_scale: gl.getUniformLocation(program, 'u_scale'),
            u_dc_base: gl.getUniformLocation(program, 'u_dc_base'),
            u_center: gl.getUniformLocation(program, 'u_center'),
            u_max_iterations: gl.getUniformLocation(program, 'u_max_iterations'),
            u_ref_len: gl.getUniformLocation(program, 'u_ref_len'),
            u_fractal_type: gl.getUniformLocation(program, 'u_fractal_type'),
            u_julia_c: gl.getUniformLocation(program, 'u_julia_c'),
            u_refOrbit: gl.getUniformLocation(program, 'u_refOrbit'),
            u_palette_a: gl.getUniformLocation(program, 'u_palette_a'),
            u_palette_b: gl.getUniformLocation(program, 'u_palette_b'),
            u_palette_c: gl.getUniformLocation(program, 'u_palette_c'),
            u_palette_d: gl.getUniformLocation(program, 'u_palette_d'),
            u_palette_freq: gl.getUniformLocation(program, 'u_palette_freq'),
            u_palette_phase: gl.getUniformLocation(program, 'u_palette_phase'),
            u_interior_mode: gl.getUniformLocation(program, 'u_interior_mode')
        };
    }

    computeReferenceOrbit(effectiveIter) {
        const gl = this.gl;
        const maxIter = Math.min(effectiveIter, 4000);
        const cx = this.state.centerX;
        const cy = this.state.centerY;
        const zoom = this.state.zoom;
        const scale = 3.0 / zoom;
        const fractalType = this.state.fractalType;
        const juliaC = this.state.juliaC;

        const evalEscape = (x, y) => {
            let zx = 0.0, zy = 0.0;
            let cConstX = x, cConstY = y;
            if (fractalType === 1) {
                zx = x; zy = y;
                cConstX = juliaC[0]; cConstY = juliaC[1];
            }
            for (let i = 0; i < maxIter; i++) {
                const x2 = zx * zx, y2 = zy * zy;
                if (x2 + y2 > 64.0) return i;
                const newZy = 2.0 * zx * zy + cConstY;
                zx = x2 - y2 + cConstX;
                zy = newZy;
            }
            return maxIter;
        };

        let refX = cx;
        let refY = cy;
        let bestIter = evalEscape(cx, cy);

        // If center escapes early and not maxIter, probe nearby points in the view
        if (bestIter < maxIter) {
            const cached = this.refOrbitCache;
            if (cached && cached.fractalType === fractalType && cached.refLen > bestIter) {
                const dx = Math.abs(cached.refX - cx);
                const dy = Math.abs(cached.refY - cy);
                if (dx < scale * 0.7 && dy < scale * 0.7) {
                    refX = cached.refX;
                    refY = cached.refY;
                    bestIter = cached.refLen;
                }
            }

            if (bestIter < maxIter) {
                for (let dy = -2; dy <= 2; dy++) {
                    for (let dx = -2; dx <= 2; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const px = cx + (dx / 4) * scale;
                        const py = cy + (dy / 4) * scale;
                        const it = evalEscape(px, py);
                        if (it > bestIter) {
                            bestIter = it;
                            refX = px;
                            refY = py;
                            if (bestIter >= maxIter) break;
                        }
                    }
                    if (bestIter >= maxIter) break;
                }
            }
        }

        let zx = 0.0, zy = 0.0;
        let cConstX = refX, cConstY = refY;
        if (fractalType === 1) {
            zx = refX; zy = refY;
            cConstX = juliaC[0]; cConstY = juliaC[1];
        }

        let actualLen = maxIter;
        const refData = this.refOrbitData;

        for (let i = 0; i < maxIter; i++) {
            refData[i * 2] = zx;
            refData[i * 2 + 1] = zy;
            const x2 = zx * zx;
            const y2 = zy * zy;

            if (x2 + y2 > 64.0) {
                const endIdx = Math.min(maxIter, i + 6);
                for (let j = i + 1; j < endIdx; j++) {
                    const newZy = 2.0 * zx * zy + cConstY;
                    zx = zx * zx - zy * zy + cConstX;
                    zy = newZy;
                    refData[j * 2] = zx;
                    refData[j * 2 + 1] = zy;
                }
                actualLen = endIdx;
                break;
            }

            const newZy = 2.0 * zx * zy + cConstY;
            zx = x2 - y2 + cConstX;
            zy = newZy;
        }

        gl.bindTexture(gl.TEXTURE_2D, this.refOrbitTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, actualLen, 1, gl.RG, gl.FLOAT, refData.subarray(0, actualLen * 2));

        this.refOrbitCache = {
            refX,
            refY,
            refLen: actualLen,
            zoom,
            centerX: cx,
            centerY: cy,
            fractalType,
            maxIter
        };

        return { refX, refY, refLen: actualLen };
    }

    initSubsystems() {
        // Minimap
        const minimapCanvas = document.getElementById('minimapCanvas');
        if (minimapCanvas) {
            this.minimap = new Minimap(minimapCanvas, (targetX, targetY) => {
                this.flyTo(targetX, targetY, this.state.zoom, 400);
            });
        }

        // Live Julia Picture-in-Picture
        const pipCanvas = document.getElementById('pipJuliaCanvas');
        if (pipCanvas) {
            this.pipJulia = new PipJulia(pipCanvas, (c) => {
                this.setFractalType(1, c);
            });
            this.pipJulia.setConstant(this.state.juliaC[0], this.state.juliaC[1], this.state.palette, this.state.paletteFreq, true);
        }
    }

    resize() {
        const dpr = this.state.dpr;
        const displayWidth = Math.round(this.canvas.clientWidth * dpr);
        const displayHeight = Math.round(this.canvas.clientHeight * dpr);

        if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
            this.canvas.width = displayWidth;
            this.canvas.height = displayHeight;
            this.gl.viewport(0, 0, displayWidth, displayHeight);
            this.needsRender = true;
        }
    }

    getEffectiveIterations() {
        if (!this.state.autoIterations) {
            return this.state.maxIterations;
        }
        // Auto scale: smoothly scale iterations as zoom penetrates deeper
        const logZoom = Math.max(0, Math.log10(this.state.zoom));
        const scaled = Math.round(200 + Math.pow(logZoom, 1.35) * 85);
        return Math.min(scaled, 4000);
    }

    isUsingDoublePrecision() {
        if (this.state.precisionMode === 'double') return true;
        if (this.state.precisionMode === 'single') return false;
        // Auto: switch above 50,000x zoom where float32 begins pixelating
        return this.state.zoom >= 50000;
    }

    isUsingPerturbation() {
        // Perturbation supports Mandelbrot (type 0) and Julia (type 1)
        if (this.state.fractalType !== 0 && this.state.fractalType !== 1) {
            return false;
        }
        return this.isUsingDoublePrecision();
    }

    render() {
        const gl = this.gl;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const minDim = Math.min(width, height);
        const scaleVal = 3.0 / this.state.zoom;
        const effectiveIter = this.getEffectiveIterations();

        const usePerturb = this.isUsingPerturbation();
        const useDouble = !usePerturb && this.isUsingDoublePrecision();

        if (usePerturb) {
            const { refX, refY, refLen } = this.computeReferenceOrbit(effectiveIter);
            const locs = this.locationsPerturbation;

            gl.useProgram(this.programPerturbation);
            gl.bindVertexArray(this.quadVao);

            gl.uniform2f(locs.u_resolution, width, height);
            gl.uniform2f(locs.u_scale, scaleVal, scaleVal);
            gl.uniform2f(locs.u_dc_base, this.state.centerX - refX, this.state.centerY - refY);
            gl.uniform2f(locs.u_center, this.state.centerX, this.state.centerY);
            gl.uniform1i(locs.u_max_iterations, effectiveIter);
            gl.uniform1i(locs.u_ref_len, refLen);
            gl.uniform1i(locs.u_fractal_type, this.state.fractalType);
            gl.uniform2f(locs.u_julia_c, this.state.juliaC[0], this.state.juliaC[1]);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.refOrbitTexture);
            gl.uniform1i(locs.u_refOrbit, 0);

            // Palettes
            const pal = this.state.palette;
            gl.uniform3fv(locs.u_palette_a, pal.a);
            gl.uniform3fv(locs.u_palette_b, pal.b);
            gl.uniform3fv(locs.u_palette_c, pal.c);
            gl.uniform3fv(locs.u_palette_d, pal.d);
            gl.uniform1f(locs.u_palette_freq, this.state.paletteFreq);
            gl.uniform1f(locs.u_palette_phase, this.state.palettePhase);
            gl.uniform1i(locs.u_interior_mode, this.state.interiorMode);

            gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.bindVertexArray(null);
        } else {
            const program = useDouble ? this.programDouble : this.programSingle;
            const locs = useDouble ? this.locationsDouble : this.locationsSingle;

            gl.useProgram(program);
            gl.bindVertexArray(this.quadVao);

            gl.uniform2f(locs.u_resolution, width, height);
            gl.uniform1i(locs.u_max_iterations, effectiveIter);
            gl.uniform1i(locs.u_fractal_type, this.state.fractalType);
            gl.uniform2f(locs.u_julia_c, this.state.juliaC[0], this.state.juliaC[1]);

            // Palettes
            const pal = this.state.palette;
            gl.uniform3fv(locs.u_palette_a, pal.a);
            gl.uniform3fv(locs.u_palette_b, pal.b);
            gl.uniform3fv(locs.u_palette_c, pal.c);
            gl.uniform3fv(locs.u_palette_d, pal.d);
            gl.uniform1f(locs.u_palette_freq, this.state.paletteFreq);
            gl.uniform1f(locs.u_palette_phase, this.state.palettePhase);
            gl.uniform1i(locs.u_interior_mode, this.state.interiorMode);

            if (useDouble) {
                const [cxHi, cxLo] = splitFloat(this.state.centerX);
                const [cyHi, cyLo] = splitFloat(this.state.centerY);
                gl.uniform2f(locs.u_center_hi, cxHi, cyHi);
                gl.uniform2f(locs.u_center_lo, cxLo, cyLo);

                const [sxHi, sxLo] = splitFloat(scaleVal);
                const [syHi, syLo] = splitFloat(scaleVal);
                gl.uniform2f(locs.u_scale_hi, sxHi, syHi);
                gl.uniform2f(locs.u_scale_lo, sxLo, syLo);
            } else {
                gl.uniform2f(locs.u_center, this.state.centerX, this.state.centerY);
                gl.uniform2f(locs.u_scale, scaleVal, scaleVal);
            }

            gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.bindVertexArray(null);
        }

        // Update Minimap viewfinder
        if (this.minimap && this.state.fractalType === 0) {
            this.minimap.updateViewport(this.state, width / height);
        }

        this.updateHUD();
        this.needsRender = false;
    }

    startLoop() {
        const loop = (now) => {
            const delta = (now - this.lastFrameTime) / 1000;
            this.lastFrameTime = now;

            // Compute FPS
            this.frameCount++;
            if (now - this.fpsTimer >= 500) {
                this.fps = Math.round((this.frameCount * 1000) / (now - this.fpsTimer));
                this.frameCount = 0;
                this.fpsTimer = now;
                const fpsEl = document.getElementById('hudFps');
                if (fpsEl) fpsEl.textContent = `${this.fps} FPS`;
            }

            // Camera transition interpolation
            if (this.cameraAnimation) {
                const anim = this.cameraAnimation;
                const elapsed = now - anim.startTime;
                const t = Math.min(1.0, elapsed / anim.duration);

                // Smooth cubic ease-in-out
                const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

                this.state.centerX = anim.fromX + (anim.toX - anim.fromX) * ease;
                this.state.centerY = anim.fromY + (anim.toY - anim.fromY) * ease;

                // Logarithmic zoom interpolation for natural perceptual zoom speed
                const logFrom = Math.log(anim.fromZoom);
                const logTo = Math.log(anim.toZoom);
                this.state.zoom = Math.exp(logFrom + (logTo - logFrom) * ease);

                this.needsRender = true;

                if (t >= 1.0) {
                    this.cameraAnimation = null;
                    this.syncToHash();
                }
            }

            // Pan inertia / momentum
            if (!this.isDragging && (Math.abs(this.momentum.vx) > 0.0001 || Math.abs(this.momentum.vy) > 0.0001)) {
                const minDim = Math.min(this.canvas.width, this.canvas.height);
                const scaleVal = 3.0 / this.state.zoom;
                this.state.centerX -= (this.momentum.vx / minDim) * scaleVal;
                this.state.centerY += (this.momentum.vy / minDim) * scaleVal;

                this.momentum.vx *= 0.90;
                this.momentum.vy *= 0.90;
                this.needsRender = true;

                if (Math.abs(this.momentum.vx) <= 0.0001 && Math.abs(this.momentum.vy) <= 0.0001) {
                    this.momentum.vx = 0;
                    this.momentum.vy = 0;
                    this.syncToHash();
                }
            }

            // Dynamic color cycling animation
            if (this.state.animateColor) {
                this.state.palettePhase = (this.state.palettePhase + this.state.colorSpeed) % 1.0;
                this.needsRender = true;
            }

            if (this.needsRender) {
                this.render();
            }

            requestAnimationFrame(loop);
        };

        requestAnimationFrame(loop);
    }

    screenToComplex(px, py) {
        const rect = this.canvas.getBoundingClientRect();
        const cssX = px - rect.left;
        const cssY = py - rect.top;

        const dpr = this.state.dpr;
        const canvasX = cssX * dpr;
        const canvasY = (rect.height - cssY) * dpr; // flip Y for GL coordinates

        const minDim = Math.min(this.canvas.width, this.canvas.height);
        const offsetX = (canvasX - 0.5 * this.canvas.width) / minDim;
        const offsetY = (canvasY - 0.5 * this.canvas.height) / minDim;

        const scaleVal = 3.0 / this.state.zoom;
        const real = this.state.centerX + offsetX * scaleVal;
        const imag = this.state.centerY + offsetY * scaleVal;

        return { real, imag };
    }

    flyTo(targetX, targetY, targetZoom, duration = 1000) {
        this.cameraAnimation = {
            fromX: this.state.centerX,
            fromY: this.state.centerY,
            fromZoom: this.state.zoom,
            toX: targetX,
            toY: targetY,
            toZoom: targetZoom,
            startTime: performance.now(),
            duration: Math.max(300, duration)
        };
        this.needsRender = true;
    }

    zoomAtPoint(screenX, screenY, factor) {
        const before = this.screenToComplex(screenX, screenY);
        const newZoom = Math.max(0.1, Math.min(1e14, this.state.zoom * factor));

        const minDim = Math.min(this.canvas.width, this.canvas.height);
        const rect = this.canvas.getBoundingClientRect();
        const dpr = this.state.dpr;

        const canvasX = (screenX - rect.left) * dpr;
        const canvasY = (rect.height - (screenY - rect.top)) * dpr;
        const offsetX = (canvasX - 0.5 * this.canvas.width) / minDim;
        const offsetY = (canvasY - 0.5 * this.canvas.height) / minDim;

        const newScaleVal = 3.0 / newZoom;
        this.state.centerX = before.real - offsetX * newScaleVal;
        this.state.centerY = before.imag - offsetY * newScaleVal;
        this.state.zoom = newZoom;

        this.needsRender = true;
        this.debounceSyncHash();
    }

    setFractalType(type, juliaC = null) {
        this.state.fractalType = type;
        if (juliaC) {
            this.state.juliaC = [...juliaC];
        }

        const typeSelect = document.getElementById('fractalTypeSelect');
        if (typeSelect) typeSelect.value = String(type);

        const juliaGroup = document.getElementById('juliaControlsGroup');
        const minimapCard = document.getElementById('minimapCard');
        const pipCard = document.getElementById('pipJuliaCard');

        if (type === 1) {
            // Julia mode
            if (juliaGroup) juliaGroup.classList.remove('hidden');
            if (minimapCard) minimapCard.classList.add('hidden');
            if (pipCard) pipCard.classList.add('hidden');
            document.getElementById('modeReturnBrot')?.classList.remove('hidden');
        } else {
            // Mandelbrot or higher powers
            if (juliaGroup) juliaGroup.classList.add('hidden');
            if (minimapCard) minimapCard.classList.remove('hidden');
            if (pipCard) pipCard.classList.remove('hidden');
            document.getElementById('modeReturnBrot')?.classList.add('hidden');
        }

        this.needsRender = true;
        this.syncToHash();
    }

    applyPreset(preset) {
        this.state.palette = getPalette(preset.paletteId);
        this.state.paletteFreq = this.state.palette.defaultFreq;
        this.state.maxIterations = preset.iterations;
        this.state.autoIterations = false; // Honor preset's exact iterations

        const iterSlider = document.getElementById('iterationsSlider');
        const iterValue = document.getElementById('iterationsValue');
        if (iterSlider) iterSlider.value = preset.iterations;
        if (iterValue) iterValue.textContent = preset.iterations;

        const autoIterToggle = document.getElementById('autoIterationsToggle');
        if (autoIterToggle) autoIterToggle.checked = false;

        const palSelect = document.getElementById('paletteSelect');
        if (palSelect) palSelect.value = preset.paletteId;

        if (preset.juliaC) {
            this.state.juliaC = [...preset.juliaC];
        }

        this.setFractalType(preset.type, preset.juliaC);
        this.flyTo(preset.centerX, preset.centerY, preset.zoom, 1200);

        if (this.pipJulia && preset.type === 0) {
            this.pipJulia.setConstant(preset.centerX, preset.centerY, this.state.palette, this.state.paletteFreq);
        }
    }

    updateHUD() {
        const hudCoords = document.getElementById('hudCoords');
        const hudZoom = document.getElementById('hudZoom');
        const hudIter = document.getElementById('hudIter');
        const hudPrecision = document.getElementById('hudPrecision');

        if (hudCoords) {
            const prec = Math.min(16, Math.max(8, Math.ceil(Math.log10(Math.max(1, this.state.zoom))) + 3));
            const rx = this.state.centerX >= 0 ? `+${this.state.centerX.toFixed(prec)}` : this.state.centerX.toFixed(prec);
            const ry = this.state.centerY >= 0 ? `+${this.state.centerY.toFixed(prec)}i` : `${this.state.centerY.toFixed(prec)}i`;
            hudCoords.textContent = `${rx}, ${ry}`;
        }

        if (hudZoom) {
            if (this.state.zoom >= 1e6) {
                hudZoom.textContent = `${this.state.zoom.toExponential(2)}x`;
            } else if (this.state.zoom >= 1000) {
                hudZoom.textContent = `${Math.round(this.state.zoom).toLocaleString()}x`;
            } else {
                hudZoom.textContent = `${this.state.zoom.toFixed(2)}x`;
            }
        }

        if (hudIter) {
            const eff = this.getEffectiveIterations();
            hudIter.textContent = `${eff} iter`;
        }

        if (hudPrecision) {
            const isPerturb = this.isUsingPerturbation();
            const isDbl = isPerturb || this.isUsingDoublePrecision();
            hudPrecision.textContent = isPerturb ? 'FP64 (Perturbation)' : (isDbl ? 'FP64 (Double)' : 'FP32 (Fast)');
            hudPrecision.className = isDbl ? 'hud-badge badge-fp64' : 'hud-badge badge-fp32';
        }
    }

    initEvents() {
        // Resize observer
        const resizeObserver = new ResizeObserver(() => {
            this.resize();
        });
        resizeObserver.observe(this.canvas);
        window.addEventListener('resize', () => this.resize());

        // Mouse Drag / Pan
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                if (e.shiftKey) {
                    // Start Box Zoom
                    this.isBoxZooming = true;
                    this.boxZoomStart = { x: e.clientX, y: e.clientY };
                    this.boxZoomCurrent = { x: e.clientX, y: e.clientY };
                    this.updateBoxZoomOverlay();
                    return;
                }

                this.isDragging = true;
                this.dragStart = { x: e.clientX, y: e.clientY };
                this.centerAtDragStart = { x: this.state.centerX, y: this.state.centerY };
                this.lastPointerPos = { x: e.clientX, y: e.clientY };
                this.lastPointerTime = performance.now();
                this.momentum = { vx: 0, vy: 0 };
                this.canvas.style.cursor = 'grabbing';
            } else if (e.button === 2) {
                // Right click: zoom out 2x
                this.zoomAtPoint(e.clientX, e.clientY, 0.5);
                e.preventDefault();
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isBoxZooming) {
                this.boxZoomCurrent = { x: e.clientX, y: e.clientY };
                this.updateBoxZoomOverlay();
                return;
            }

            if (this.isDragging) {
                const dx = e.clientX - this.dragStart.x;
                const dy = e.clientY - this.dragStart.y;

                const minDim = Math.min(this.canvas.width, this.canvas.height);
                const scaleVal = 3.0 / this.state.zoom;
                const dpr = this.state.dpr;

                this.state.centerX = this.centerAtDragStart.x - (dx * dpr / minDim) * scaleVal;
                this.state.centerY = this.centerAtDragStart.y + (dy * dpr / minDim) * scaleVal;

                // Track momentum
                const now = performance.now();
                const dt = Math.max(1, now - this.lastPointerTime);
                this.momentum.vx = ((e.clientX - this.lastPointerPos.x) * dpr / dt) * 16;
                this.momentum.vy = ((e.clientY - this.lastPointerPos.y) * dpr / dt) * 16;
                this.lastPointerPos = { x: e.clientX, y: e.clientY };
                this.lastPointerTime = now;

                this.needsRender = true;
            } else {
                // Mouse hover updates live Julia preview
                if (this.state.fractalType === 0 && this.pipJulia && this.pipJulia.visible) {
                    const c = this.screenToComplex(e.clientX, e.clientY);
                    this.pipJulia.setConstant(c.real, c.imag, this.state.palette, this.state.paletteFreq);
                }
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (this.isBoxZooming) {
                this.finishBoxZoom();
                return;
            }

            if (this.isDragging) {
                this.isDragging = false;
                this.canvas.style.cursor = 'grab';
                this.debounceSyncHash();
            }
        });

        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Mouse Wheel Zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            // Smooth zoom exponential mapping
            const zoomSpeed = 0.0016;
            const factor = Math.exp(-e.deltaY * zoomSpeed);
            this.zoomAtPoint(e.clientX, e.clientY, factor);
        }, { passive: false });

        // Double Click to zoom in
        this.canvas.addEventListener('dblclick', (e) => {
            e.preventDefault();
            const factor = e.shiftKey ? 0.5 : 2.0;
            this.zoomAtPoint(e.clientX, e.clientY, factor);
        });

        // Touch Gestures
        this.setupTouchGestures();

        // Keyboard Navigation
        this.setupKeyboard();
    }

    setupTouchGestures() {
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                this.activePointers.set(t.identifier, { x: t.clientX, y: t.clientY });
            }

            if (this.activePointers.size === 1) {
                const t = e.touches[0];
                this.isDragging = true;
                this.dragStart = { x: t.clientX, y: t.clientY };
                this.centerAtDragStart = { x: this.state.centerX, y: this.state.centerY };
                this.momentum = { vx: 0, vy: 0 };
            } else if (this.activePointers.size === 2) {
                this.isDragging = false;
                const [t1, t2] = [e.touches[0], e.touches[1]];
                this.initialPinchDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                this.initialPinchZoom = this.state.zoom;
                this.pinchCenter = {
                    x: (t1.clientX + t2.clientX) / 2,
                    y: (t1.clientY + t2.clientY) / 2
                };
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (this.activePointers.size === 1 && this.isDragging) {
                const t = e.touches[0];
                const dx = t.clientX - this.dragStart.x;
                const dy = t.clientY - this.dragStart.y;
                const minDim = Math.min(this.canvas.width, this.canvas.height);
                const scaleVal = 3.0 / this.state.zoom;
                const dpr = this.state.dpr;

                this.state.centerX = this.centerAtDragStart.x - (dx * dpr / minDim) * scaleVal;
                this.state.centerY = this.centerAtDragStart.y + (dy * dpr / minDim) * scaleVal;
                this.needsRender = true;
            } else if (this.activePointers.size === 2 && this.initialPinchDistance > 0) {
                const [t1, t2] = [e.touches[0], e.touches[1]];
                const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                const factor = currentDist / this.initialPinchDistance;

                const centerNow = {
                    x: (t1.clientX + t2.clientX) / 2,
                    y: (t1.clientY + t2.clientY) / 2
                };

                this.zoomAtPoint(centerNow.x, centerNow.y, factor / (this.state.zoom / this.initialPinchZoom));
            }
        }, { passive: false });

        const endTouch = (e) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                this.activePointers.delete(e.changedTouches[i].identifier);
            }
            if (this.activePointers.size === 0) {
                this.isDragging = false;
                this.initialPinchDistance = 0;
                this.syncToHash();
            }
        };

        this.canvas.addEventListener('touchend', endTouch);
        this.canvas.addEventListener('touchcancel', endTouch);
    }

    setupKeyboard() {
        window.addEventListener('keydown', (e) => {
            // Ignore if active in input field
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

            const minDim = Math.min(this.canvas.width, this.canvas.height);
            const step = (3.0 / this.state.zoom) * 0.08;

            switch (e.key) {
                case 'ArrowLeft':
                case 'a':
                case 'A':
                    this.state.centerX -= step;
                    this.needsRender = true;
                    break;
                case 'ArrowRight':
                case 'd':
                case 'D':
                    this.state.centerX += step;
                    this.needsRender = true;
                    break;
                case 'ArrowUp':
                case 'w':
                case 'W':
                    this.state.centerY += step;
                    this.needsRender = true;
                    break;
                case 'ArrowDown':
                case 's':
                case 'S':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.takeSnapshot();
                        return;
                    }
                    this.state.centerY -= step;
                    this.needsRender = true;
                    break;
                case '+':
                case '=':
                    this.zoomAtPoint(window.innerWidth / 2, window.innerHeight / 2, 1.3);
                    break;
                case '-':
                case '_':
                    this.zoomAtPoint(window.innerWidth / 2, window.innerHeight / 2, 0.77);
                    break;
                case 'r':
                case 'R':
                    this.applyPreset(PRESETS[0]);
                    break;
                case ' ':
                    e.preventDefault();
                    this.state.animateColor = !this.state.animateColor;
                    document.getElementById('animateColorToggle').checked = this.state.animateColor;
                    this.needsRender = true;
                    break;
                case 'c':
                case 'C':
                    this.nextPalette();
                    break;
                case 'j':
                case 'J':
                    this.setFractalType(this.state.fractalType === 1 ? 0 : 1, this.state.juliaC);
                    break;
                case 'h':
                case 'H':
                    this.toggleZenMode();
                    break;
                case 'f':
                case 'F':
                    this.toggleFullscreen();
                    break;
                case '?':
                    this.toggleHelpModal();
                    break;
                case '1':
                case '2':
                case '3':
                case '4':
                case '5':
                case '6':
                case '7':
                case '8':
                case '9': {
                    const idx = parseInt(e.key, 10) - 1;
                    if (PRESETS[idx]) this.applyPreset(PRESETS[idx]);
                    break;
                }
            }
        });
    }

    updateBoxZoomOverlay() {
        if (!this.boxZoomBox) return;
        this.boxZoomBox.classList.remove('hidden');

        const x1 = Math.min(this.boxZoomStart.x, this.boxZoomCurrent.x);
        const y1 = Math.min(this.boxZoomStart.y, this.boxZoomCurrent.y);
        const w = Math.abs(this.boxZoomCurrent.x - this.boxZoomStart.x);
        const h = Math.abs(this.boxZoomCurrent.y - this.boxZoomStart.y);

        this.boxZoomBox.style.left = `${x1}px`;
        this.boxZoomBox.style.top = `${y1}px`;
        this.boxZoomBox.style.width = `${w}px`;
        this.boxZoomBox.style.height = `${h}px`;
    }

    finishBoxZoom() {
        this.isBoxZooming = false;
        if (this.boxZoomBox) this.boxZoomBox.classList.add('hidden');

        const x1 = Math.min(this.boxZoomStart.x, this.boxZoomCurrent.x);
        const x2 = Math.max(this.boxZoomStart.x, this.boxZoomCurrent.x);
        const y1 = Math.min(this.boxZoomStart.y, this.boxZoomCurrent.y);
        const y2 = Math.max(this.boxZoomStart.y, this.boxZoomCurrent.y);

        const boxW = x2 - x1;
        const boxH = y2 - y1;

        if (boxW < 10 || boxH < 10) return; // Too small, ignore

        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const centerComplex = this.screenToComplex(midX, midY);

        const zoomFactor = Math.min(window.innerWidth / boxW, window.innerHeight / boxH);
        this.flyTo(centerComplex.real, centerComplex.imag, this.state.zoom * zoomFactor, 800);
    }

    nextPalette() {
        const idx = PALETTES.findIndex(p => p.id === this.state.palette.id);
        const next = PALETTES[(idx + 1) % PALETTES.length];
        this.state.palette = next;
        this.state.paletteFreq = next.defaultFreq;

        const sel = document.getElementById('paletteSelect');
        if (sel) sel.value = next.id;

        const freqSlider = document.getElementById('paletteFreqSlider');
        if (freqSlider) freqSlider.value = next.defaultFreq;

        this.needsRender = true;
        this.showToast(`Palette: ${next.name}`);
    }

    toggleZenMode() {
        const uiContainer = document.getElementById('uiContainer');
        if (uiContainer) {
            uiContainer.classList.toggle('zen-hidden');
            const isHidden = uiContainer.classList.contains('zen-hidden');
            this.showToast(isHidden ? 'Zen Mode ON (Press H to restore UI)' : 'UI Restored');
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.warn('Fullscreen error:', err);
            });
        } else {
            document.exitFullscreen();
        }
    }

    toggleHelpModal() {
        const modal = document.getElementById('helpModal');
        if (modal) modal.classList.toggle('hidden');
    }

    showToast(msg) {
        let toast = document.getElementById('appToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'appToast';
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
    }

    initUI() {
        // Presets selector
        const presetSelect = document.getElementById('presetSelect');
        if (presetSelect) {
            presetSelect.innerHTML = '';
            let currentGroup = null;
            let groupEl = null;

            PRESETS.forEach(p => {
                if (p.category !== currentGroup) {
                    currentGroup = p.category;
                    groupEl = document.createElement('optgroup');
                    groupEl.label = currentGroup;
                    presetSelect.appendChild(groupEl);
                }
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                groupEl.appendChild(opt);
            });

            presetSelect.addEventListener('change', (e) => {
                const found = PRESETS.find(p => p.id === e.target.value);
                if (found) this.applyPreset(found);
            });
        }

        // Palette selector
        const paletteSelect = document.getElementById('paletteSelect');
        if (paletteSelect) {
            paletteSelect.innerHTML = '';
            PALETTES.forEach(pal => {
                const opt = document.createElement('option');
                opt.value = pal.id;
                opt.textContent = pal.name;
                paletteSelect.appendChild(opt);
            });
            paletteSelect.value = this.state.palette.id;
            paletteSelect.addEventListener('change', (e) => {
                this.state.palette = getPalette(e.target.value);
                this.state.paletteFreq = this.state.palette.defaultFreq;
                const freq = document.getElementById('paletteFreqSlider');
                if (freq) freq.value = this.state.paletteFreq;
                this.needsRender = true;
                this.debounceSyncHash();
            });
        }

        // Fractal type dropdown
        const typeSelect = document.getElementById('fractalTypeSelect');
        if (typeSelect) {
            typeSelect.addEventListener('change', (e) => {
                this.setFractalType(parseInt(e.target.value, 10));
            });
        }

        // Iterations slider
        const iterSlider = document.getElementById('iterationsSlider');
        const iterValue = document.getElementById('iterationsValue');
        if (iterSlider) {
            iterSlider.value = this.state.maxIterations;
            iterSlider.addEventListener('input', (e) => {
                this.state.maxIterations = parseInt(e.target.value, 10);
                if (iterValue) iterValue.textContent = this.state.maxIterations;
                this.needsRender = true;
            });
        }

        // Auto iterations toggle
        const autoIterToggle = document.getElementById('autoIterationsToggle');
        if (autoIterToggle) {
            autoIterToggle.checked = this.state.autoIterations;
            autoIterToggle.addEventListener('change', (e) => {
                this.state.autoIterations = e.target.checked;
                this.needsRender = true;
            });
        }

        // Palette Frequency slider
        const freqSlider = document.getElementById('paletteFreqSlider');
        const freqValue = document.getElementById('paletteFreqValue');
        if (freqSlider) {
            freqSlider.addEventListener('input', (e) => {
                this.state.paletteFreq = parseFloat(e.target.value);
                if (freqValue) freqValue.textContent = `${this.state.paletteFreq.toFixed(1)}x`;
                this.needsRender = true;
            });
        }

        // Animate color toggle
        const animToggle = document.getElementById('animateColorToggle');
        if (animToggle) {
            animToggle.addEventListener('change', (e) => {
                this.state.animateColor = e.target.checked;
                this.needsRender = true;
            });
        }

        // Interior Mode
        const interiorSelect = document.getElementById('interiorModeSelect');
        if (interiorSelect) {
            interiorSelect.value = String(this.state.interiorMode);
            interiorSelect.addEventListener('change', (e) => {
                this.state.interiorMode = parseInt(e.target.value, 10);
                this.needsRender = true;
            });
        }

        // Precision Mode
        const precSelect = document.getElementById('precisionModeSelect');
        if (precSelect) {
            precSelect.value = this.state.precisionMode;
            precSelect.addEventListener('change', (e) => {
                this.state.precisionMode = e.target.value;
                this.needsRender = true;
            });
        }

        // Explore Julia from PiP button
        const btnExploreJulia = document.getElementById('btnExploreJulia');
        if (btnExploreJulia && this.pipJulia) {
            btnExploreJulia.addEventListener('click', () => {
                const [cr, ci] = this.pipJulia.currentC;
                this.setFractalType(1, [cr, ci]);
                this.flyTo(0.0, 0.0, 1.0, 800);
            });
        }

        // Return to Mandelbrot button
        const btnReturnBrot = document.getElementById('btnReturnBrot');
        if (btnReturnBrot) {
            btnReturnBrot.addEventListener('click', () => {
                this.setFractalType(0);
                this.flyTo(this.state.juliaC[0], this.state.juliaC[1], 1500, 800);
            });
        }

        // Reset View button
        const btnReset = document.getElementById('btnReset');
        if (btnReset) {
            btnReset.addEventListener('click', () => this.applyPreset(PRESETS[0]));
        }

        // Copy Shareable Link
        const btnCopyLink = document.getElementById('btnCopyLink');
        if (btnCopyLink) {
            btnCopyLink.addEventListener('click', () => {
                this.syncToHash();
                navigator.clipboard.writeText(window.location.href).then(() => {
                    this.showToast('Copied shareable view URL to clipboard!');
                }).catch(() => {
                    this.showToast('Could not copy link');
                });
            });
        }

        // Snapshot modal trigger & execution
        const btnOpenSnapshot = document.getElementById('btnOpenSnapshot');
        const snapshotModal = document.getElementById('snapshotModal');
        if (btnOpenSnapshot && snapshotModal) {
            btnOpenSnapshot.addEventListener('click', () => snapshotModal.classList.remove('hidden'));
        }

        const btnExportPNG = document.getElementById('btnExportPNG');
        if (btnExportPNG) {
            btnExportPNG.addEventListener('click', () => {
                const resSelect = document.getElementById('snapshotResolution');
                const res = resSelect ? resSelect.value : 'viewport';
                this.exportSnapshot(res);
                if (snapshotModal) snapshotModal.classList.add('hidden');
            });
        }

        // Modal close buttons
        document.querySelectorAll('.btn-close-modal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.closest('.modal-overlay')?.classList.add('hidden');
            });
        });

        // Toggle panel collapse
        const btnCollapsePanel = document.getElementById('btnCollapsePanel');
        const controlPanel = document.getElementById('controlPanel');
        if (btnCollapsePanel && controlPanel) {
            btnCollapsePanel.addEventListener('click', () => {
                controlPanel.classList.toggle('collapsed');
            });
        }
    }

    exportSnapshot(resolution) {
        let targetW = this.canvas.width;
        let targetH = this.canvas.height;

        if (resolution === '1080p') {
            targetW = 1920;
            targetH = 1080;
        } else if (resolution === '1440p') {
            targetW = 2560;
            targetH = 1440;
        } else if (resolution === '4k') {
            targetW = 3840;
            targetH = 2160;
        }

        const originalW = this.canvas.width;
        const originalH = this.canvas.height;

        if (targetW !== originalW || targetH !== originalH) {
            this.canvas.width = targetW;
            this.canvas.height = targetH;
            this.gl.viewport(0, 0, targetW, targetH);
        }

        this.render();
        this.downloadCanvas(this.canvas);

        if (targetW !== originalW || targetH !== originalH) {
            this.canvas.width = originalW;
            this.canvas.height = originalH;
            this.gl.viewport(0, 0, originalW, originalH);
            this.render();
        }
    }

    downloadCanvas(targetCanvas) {
        targetCanvas.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const typeName = this.state.fractalType === 1 ? 'julia' : 'mandelbrot';
            a.download = `${typeName}_z${this.state.zoom.toExponential(2)}_iter${this.getEffectiveIterations()}.png`;
            a.href = url;
            a.click();
            URL.revokeObjectURL(url);
            this.showToast('Snapshot downloaded!');
        }, 'image/png');
    }

    takeSnapshot() {
        this.exportSnapshot('viewport');
    }

    debounceSyncHash() {
        clearTimeout(this.hashTimer);
        this.hashTimer = setTimeout(() => this.syncToHash(), 300);
    }

    syncToHash() {
        const params = new URLSearchParams();
        const prec = Math.min(16, Math.max(8, Math.ceil(Math.log10(Math.max(1, this.state.zoom))) + 3));
        params.set('x', this.state.centerX.toFixed(prec));
        params.set('y', this.state.centerY.toFixed(prec));
        params.set('z', this.state.zoom >= 1e6 ? this.state.zoom.toExponential(4) : this.state.zoom.toFixed(4));
        params.set('iter', this.state.maxIterations);
        params.set('pal', this.state.palette.id);
        params.set('type', this.state.fractalType);
        if (this.state.fractalType === 1) {
            params.set('jx', this.state.juliaC[0].toFixed(8));
            params.set('jy', this.state.juliaC[1].toFixed(8));
        }
        window.history.replaceState(null, '', `#${params.toString()}`);
    }

    loadFromHash() {
        if (!window.location.hash || window.location.hash.length <= 1) return;
        try {
            const hash = window.location.hash.substring(1);
            const params = new URLSearchParams(hash);

            if (params.has('x')) this.state.centerX = parseFloat(params.get('x'));
            if (params.has('y')) this.state.centerY = parseFloat(params.get('y'));
            if (params.has('z')) this.state.zoom = parseFloat(params.get('z'));
            if (params.has('iter')) {
                this.state.maxIterations = parseInt(params.get('iter'), 10);
                this.state.autoIterations = false;
            }
            if (params.has('pal')) this.state.palette = getPalette(params.get('pal'));
            if (params.has('type')) this.state.fractalType = parseInt(params.get('type'), 10);
            if (params.has('jx') && params.has('jy')) {
                this.state.juliaC = [parseFloat(params.get('jx')), parseFloat(params.get('jy'))];
            }

            this.setFractalType(this.state.fractalType, this.state.juliaC);
            this.needsRender = true;
        } catch (e) {
            console.warn('Could not parse URL hash params:', e);
        }
    }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
    window.app = new MandelbrotApp();
});
