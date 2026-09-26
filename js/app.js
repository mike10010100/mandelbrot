// Main Application Controller for Interactive Mandelbrot Fractal Explorer
import { PALETTES, getPalette } from './palettes.js';
import { PRESETS } from './presets.js';
import { VERTEX_SHADER, FRAGMENT_SHADER_SINGLE, FRAGMENT_SHADER_DOUBLE, FRAGMENT_SHADER_PERTURBATION, FRAGMENT_BLIT_PALETTE } from './shaders.js';
import { createProgram, setupQuad, splitFloat } from './webgl-utils.js';
import { Minimap } from './minimap.js';
import { PipJulia } from './pip-julia.js';
import { dd_add, dd_sub, dd_mul, dd_sqr, dd_set, dd_from_string, dd_to_string } from './double-double.js';

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

        // State (Dual Float64 and 106-bit Double-Double Coordinates)
        this.state = {
            centerX: -0.65,
            centerY: 0.0,
            centerDD_x: [-0.65, 0.0],
            centerDD_y: [0.0, 0.0],
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

        // 2-Pass FBO State
        this.fractalFbo = null;
        this.fractalTexture = null;
        this.fractalTextureValid = false;
        this.fboWidth = 0;
        this.fboHeight = 0;

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
        this.centerAtDragStartDD_x = [-0.65, 0.0];
        this.centerAtDragStartDD_y = [0.0, 0.0];
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

    invalidateFractal() {
        this.fractalTextureValid = false;
        this.needsRender = true;
    }

    handleNoWebGL() {
        const modal = document.getElementById('fallbackModal');
        if (modal) modal.classList.remove('hidden');
        console.error('WebGL 2.0 is required but not supported on this device/browser.');
    }

    setCenter(x, y) {
        if (Array.isArray(x)) {
            this.state.centerDD_x = [x[0], x[1]];
        } else if (typeof x === 'string') {
            this.state.centerDD_x = dd_from_string(x);
        } else {
            this.state.centerDD_x = dd_set(x);
        }

        if (Array.isArray(y)) {
            this.state.centerDD_y = [y[0], y[1]];
        } else if (typeof y === 'string') {
            this.state.centerDD_y = dd_from_string(y);
        } else {
            this.state.centerDD_y = dd_set(y);
        }

        this.state.centerX = this.state.centerDD_x[0] + this.state.centerDD_x[1];
        this.state.centerY = this.state.centerDD_y[0] + this.state.centerDD_y[1];
        this.invalidateFractal();
    }

    initWebGL() {
        const gl = this.gl;

        // Ensure floating point render buffers are supported for 2-pass FBO
        gl.getExtension('EXT_color_buffer_float');

        // Compile single-precision, double-precision, perturbation, and blit palette programs
        try {
            this.programSingle = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER_SINGLE);
            this.locationsSingle = this.cacheUniformLocations(this.programSingle, false);

            this.programDouble = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER_DOUBLE);
            this.locationsDouble = this.cacheUniformLocations(this.programDouble, true);

            this.programPerturbation = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER_PERTURBATION);
            this.locationsPerturbation = this.cachePerturbationLocations(this.programPerturbation);

            this.programBlit = createProgram(gl, VERTEX_SHADER, FRAGMENT_BLIT_PALETTE);
            this.locationsBlit = this.cacheBlitLocations(this.programBlit);
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

        // Initialize 2-Pass FBO
        this.fractalFbo = gl.createFramebuffer();
        this.fractalTexture = gl.createTexture();
        this.fractalTextureValid = false;

        this.quadVao = setupQuad(gl);
        this.resize();
    }

    initFBO(w, h) {
        const gl = this.gl;
        if (this.fboWidth === w && this.fboHeight === h && this.fractalTexture) return;
        this.fboWidth = w;
        this.fboHeight = h;

        gl.bindTexture(gl.TEXTURE_2D, this.fractalTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fractalFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fractalTexture, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        this.fractalTextureValid = false;
    }

    cacheBlitLocations(program) {
        const gl = this.gl;
        return {
            u_fractal_texture: gl.getUniformLocation(program, 'u_fractal_texture'),
            u_palette_a: gl.getUniformLocation(program, 'u_palette_a'),
            u_palette_b: gl.getUniformLocation(program, 'u_palette_b'),
            u_palette_c: gl.getUniformLocation(program, 'u_palette_c'),
            u_palette_d: gl.getUniformLocation(program, 'u_palette_d'),
            u_palette_freq: gl.getUniformLocation(program, 'u_palette_freq'),
            u_palette_phase: gl.getUniformLocation(program, 'u_palette_phase'),
            u_interior_mode: gl.getUniformLocation(program, 'u_interior_mode')
        };
    }

    cacheUniformLocations(program, isDouble) {
        const gl = this.gl;
        const locs = {
            u_resolution: gl.getUniformLocation(program, 'u_resolution'),
            u_max_iterations: gl.getUniformLocation(program, 'u_max_iterations'),
            u_fractal_type: gl.getUniformLocation(program, 'u_fractal_type'),
            u_julia_c: gl.getUniformLocation(program, 'u_julia_c'),
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
            u_interior_mode: gl.getUniformLocation(program, 'u_interior_mode'),
            u_skip_iterations: gl.getUniformLocation(program, 'u_skip_iterations'),
            u_series_A: gl.getUniformLocation(program, 'u_series_A'),
            u_series_B: gl.getUniformLocation(program, 'u_series_B')
        };
    }

    computeReferenceOrbit(effectiveIter) {
        const gl = this.gl;
        const maxIter = Math.min(effectiveIter, 4000);
        const cx = this.state.centerX;
        const cy = this.state.centerY;
        const cxDD = this.state.centerDD_x;
        const cyDD = this.state.centerDD_y;
        const zoom = this.state.zoom;
        const scale = 3.0 / zoom;
        const fractalType = this.state.fractalType;
        const juliaC = this.state.juliaC;
        const isDD = zoom >= 1e13;

        const evalEscape = (x, y, limit = maxIter) => {
            let zx = 0.0, zy = 0.0;
            let cConstX = x, cConstY = y;
            if (fractalType === 1) {
                zx = x; zy = y;
                cConstX = juliaC[0]; cConstY = juliaC[1];
            }
            for (let i = 0; i < limit; i++) {
                const x2 = zx * zx, y2 = zy * zy;
                if (x2 + y2 > 64.0) return i;
                const newZy = 2.0 * zx * zy + cConstY;
                zx = x2 - y2 + cConstX;
                zy = newZy;
            }
            return limit;
        };

        const evalEscapeDD = (cx_h, cx_l, cy_h, cy_l, limit = maxIter) => {
            let zx_h = 0.0, zx_l = 0.0;
            let zy_h = 0.0, zy_l = 0.0;
            let ccx_h = cx_h, ccx_l = cx_l;
            let ccy_h = cy_h, ccy_l = cy_l;
            if (fractalType === 1) {
                zx_h = cx_h; zx_l = cx_l;
                zy_h = cy_h; zy_l = cy_l;
                ccx_h = juliaC[0]; ccx_l = 0.0;
                ccy_h = juliaC[1]; ccy_l = 0.0;
            }
            for (let i = 0; i < limit; i++) {
                const [x2_h, x2_l] = dd_sqr(zx_h, zx_l);
                const [y2_h, y2_l] = dd_sqr(zy_h, zy_l);
                if (x2_h + y2_h > 64.0) return i;
                const [p_h, p_l] = dd_mul(zx_h, zx_l, zy_h, zy_l);
                const [newZy_h, newZy_l] = dd_add(2.0 * p_h, 2.0 * p_l, ccy_h, ccy_l);
                const [diff_h, diff_l] = dd_sub(x2_h, x2_l, y2_h, y2_l);
                const [newZx_h, newZx_l] = dd_add(diff_h, diff_l, ccx_h, ccx_l);
                zx_h = newZx_h; zx_l = newZx_l;
                zy_h = newZy_h; zy_l = newZy_l;
            }
            return limit;
        };

        let refDD_x = [...cxDD];
        let refDD_y = [...cyDD];
        let refX = cx;
        let refY = cy;
        let bestIter = isDD ? evalEscapeDD(cxDD[0], cxDD[1], cyDD[0], cyDD[1]) : evalEscape(cx, cy);

        // Check if cached orbit can be reused (within perturbation radius)
        const cached = this.refOrbitCache;
        let canReuseCached = false;
        if (cached && cached.fractalType === fractalType && cached.refLen > 500) {
            const dx = isDD ? Math.abs(dd_sub(cached.refDD_x[0], cached.refDD_x[1], cxDD[0], cxDD[1])[0]) : Math.abs(cached.refX - cx);
            const dy = isDD ? Math.abs(dd_sub(cached.refDD_y[0], cached.refDD_y[1], cyDD[0], cyDD[1])[0]) : Math.abs(cached.refY - cy);
            if (dx < scale * 0.9 && dy < scale * 0.9) {
                refX = cached.refX;
                refY = cached.refY;
                if (isDD && cached.refDD_x) {
                    refDD_x = [...cached.refDD_x];
                    refDD_y = [...cached.refDD_y];
                }
                bestIter = cached.refLen;
                canReuseCached = true;
            }
        }

        // If center escapes early and we cannot reuse cache, search candidate points using 2-stage probe
        if (!canReuseCached && bestIter < maxIter) {
            const probeLimit = Math.min(250, maxIter);
            let bestProbeIter = bestIter;
            let bestCandidate = null;

            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    if (isDD) {
                        const pxDD = dd_add(cxDD[0], cxDD[1], (dx / 4) * scale, 0.0);
                        const pyDD = dd_add(cyDD[0], cyDD[1], (dy / 4) * scale, 0.0);
                        const it = evalEscapeDD(pxDD[0], pxDD[1], pyDD[0], pyDD[1], probeLimit);
                        if (it > bestProbeIter) {
                            bestProbeIter = it;
                            bestCandidate = { pxDD, pyDD, px: pxDD[0] + pxDD[1], py: pyDD[0] + pyDD[1] };
                        }
                    } else {
                        const px = cx + (dx / 4) * scale;
                        const py = cy + (dy / 4) * scale;
                        const it = evalEscape(px, py, probeLimit);
                        if (it > bestProbeIter) {
                            bestProbeIter = it;
                            bestCandidate = { px, py };
                        }
                    }
                }
            }

            // Stage 2: Evaluate winning candidate up to full maxIter
            if (bestCandidate) {
                if (isDD) {
                    refDD_x = bestCandidate.pxDD;
                    refDD_y = bestCandidate.pyDD;
                    refX = bestCandidate.px;
                    refY = bestCandidate.py;
                    bestIter = evalEscapeDD(refDD_x[0], refDD_x[1], refDD_y[0], refDD_y[1], maxIter);
                } else {
                    refX = bestCandidate.px;
                    refY = bestCandidate.py;
                    bestIter = evalEscape(refX, refY, maxIter);
                }
            }
        }

        let actualLen = maxIter;
        const refData = this.refOrbitData;

        if (isDD) {
            let zx_h = 0.0, zx_l = 0.0;
            let zy_h = 0.0, zy_l = 0.0;
            let ccx_h = refDD_x[0], ccx_l = refDD_x[1];
            let ccy_h = refDD_y[0], ccy_l = refDD_y[1];
            if (fractalType === 1) {
                zx_h = refDD_x[0]; zx_l = refDD_x[1];
                zy_h = refDD_y[0]; zy_l = refDD_y[1];
                ccx_h = juliaC[0]; ccx_l = 0.0;
                ccy_h = juliaC[1]; ccy_l = 0.0;
            }

            for (let i = 0; i < maxIter; i++) {
                refData[i * 2] = zx_h;
                refData[i * 2 + 1] = zy_h;

                const [x2_h, x2_l] = dd_sqr(zx_h, zx_l);
                const [y2_h, y2_l] = dd_sqr(zy_h, zy_l);

                if (x2_h + y2_h > 64.0) {
                    const endIdx = Math.min(maxIter, i + 6);
                    for (let j = i + 1; j < endIdx; j++) {
                        const [p_h, p_l] = dd_mul(zx_h, zx_l, zy_h, zy_l);
                        const [newZy_h, newZy_l] = dd_add(2.0 * p_h, 2.0 * p_l, ccy_h, ccy_l);
                        const [diff_h, diff_l] = dd_sub(x2_h, x2_l, y2_h, y2_l);
                        const [newZx_h, newZx_l] = dd_add(diff_h, diff_l, ccx_h, ccx_l);
                        zx_h = newZx_h; zx_l = newZx_l;
                        zy_h = newZy_h; zy_l = newZy_l;
                        refData[j * 2] = zx_h;
                        refData[j * 2 + 1] = zy_h;
                    }
                    actualLen = endIdx;
                    break;
                }

                const [p_h, p_l] = dd_mul(zx_h, zx_l, zy_h, zy_l);
                const [newZy_h, newZy_l] = dd_add(2.0 * p_h, 2.0 * p_l, ccy_h, ccy_l);
                const [diff_h, diff_l] = dd_sub(x2_h, x2_l, y2_h, y2_l);
                const [newZx_h, newZx_l] = dd_add(diff_h, diff_l, ccx_h, ccx_l);
                zx_h = newZx_h; zx_l = newZx_l;
                zy_h = newZy_h; zy_l = newZy_l;
            }
        } else {
            let zx = 0.0, zy = 0.0;
            let cConstX = refX, cConstY = refY;
            if (fractalType === 1) {
                zx = refX; zy = refY;
                cConstX = juliaC[0]; cConstY = juliaC[1];
            }

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
        }

        gl.bindTexture(gl.TEXTURE_2D, this.refOrbitTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, actualLen, 1, gl.RG, gl.FLOAT, refData.subarray(0, actualLen * 2));

        let dcBaseX = 0.0;
        let dcBaseY = 0.0;
        if (isDD) {
            const [dx_h, dx_l] = dd_sub(cxDD[0], cxDD[1], refDD_x[0], refDD_x[1]);
            const [dy_h, dy_l] = dd_sub(cyDD[0], cyDD[1], refDD_y[0], refDD_y[1]);
            dcBaseX = dx_h + dx_l;
            dcBaseY = dy_h + dy_l;
        } else {
            dcBaseX = cx - refX;
            dcBaseY = cy - refY;
        }

        // Bivariate Series Approximation (Taylor Polynomial Fast-Forwarding)
        let skipIter = 0;
        let seriesA = [0.0, 0.0];
        let seriesB = [0.0, 0.0];

        if (fractalType === 0 || fractalType === 1) {
            let Ax = fractalType === 1 ? 1.0 : 0.0;
            let Ay = 0.0;
            let Bx = 0.0;
            let By = 0.0;
            const maxRadius = scale * 1.5;

            for (let n = 0; n < actualLen - 5; n++) {
                const Zx = refData[n * 2];
                const Zy = refData[n * 2 + 1];

                const magA = Math.hypot(Ax, Ay);
                const magB = Math.hypot(Bx, By);
                const linearDisp = magA * maxRadius;
                const quadDisp = magB * maxRadius * maxRadius;

                if (Zx * Zx + Zy * Zy > 4.0 || linearDisp > 0.5 || quadDisp > 0.1 * (linearDisp + 1e-12) || magB * maxRadius > 0.1) {
                    break;
                }

                skipIter = n;
                seriesA = [Ax, Ay];
                seriesB = [Bx, By];

                const two_ZA_x = 2.0 * (Zx * Ax - Zy * Ay);
                const two_ZA_y = 2.0 * (Zx * Ay + Zy * Ax);
                const nextAx = two_ZA_x + (fractalType === 0 ? 1.0 : 0.0);
                const nextAy = two_ZA_y;

                const two_ZB_x = 2.0 * (Zx * Bx - Zy * By);
                const two_ZB_y = 2.0 * (Zx * By + Zy * Bx);
                const A2_x = Ax * Ax - Ay * Ay;
                const A2_y = 2.0 * Ax * Ay;
                const nextBx = two_ZB_x + A2_x;
                const nextBy = two_ZB_y + A2_y;

                if (!isFinite(nextAx) || !isFinite(nextBx) || Math.abs(nextAx) > 1e20 || Math.abs(nextBx) > 1e35) {
                    break;
                }

                Ax = nextAx;
                Ay = nextAy;
                Bx = nextBx;
                By = nextBy;
            }
        }

        this.refOrbitCache = {
            refX,
            refY,
            refDD_x,
            refDD_y,
            refLen: actualLen,
            zoom,
            centerX: cx,
            centerY: cy,
            fractalType,
            maxIter
        };

        return { refX, refY, refLen: actualLen, dcBaseX, dcBaseY, skipIter, seriesA, seriesB };
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
            this.initFBO(displayWidth, displayHeight);
            this.invalidateFractal();
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

    renderFractalToFBO() {
        const gl = this.gl;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const scaleVal = 3.0 / this.state.zoom;
        const effectiveIter = this.getEffectiveIterations();

        const usePerturb = this.isUsingPerturbation();
        const useDouble = !usePerturb && this.isUsingDoublePrecision();

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fractalFbo);
        gl.viewport(0, 0, width, height);

        if (usePerturb) {
            const { refLen, dcBaseX, dcBaseY, skipIter, seriesA, seriesB } = this.computeReferenceOrbit(effectiveIter);
            const locs = this.locationsPerturbation;

            gl.useProgram(this.programPerturbation);
            gl.bindVertexArray(this.quadVao);

            gl.uniform2f(locs.u_resolution, width, height);
            gl.uniform2f(locs.u_scale, scaleVal, scaleVal);
            gl.uniform2f(locs.u_dc_base, dcBaseX, dcBaseY);
            gl.uniform2f(locs.u_center, this.state.centerX, this.state.centerY);
            gl.uniform1i(locs.u_max_iterations, effectiveIter);
            gl.uniform1i(locs.u_ref_len, refLen);

            gl.uniform1i(locs.u_fractal_type, this.state.fractalType);
            gl.uniform2f(locs.u_julia_c, this.state.juliaC[0], this.state.juliaC[1]);
            gl.uniform1i(locs.u_interior_mode, this.state.interiorMode);

            gl.uniform1i(locs.u_skip_iterations, skipIter);
            gl.uniform2f(locs.u_series_A, seriesA[0], seriesA[1]);
            gl.uniform2f(locs.u_series_B, seriesB[0], seriesB[1]);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.refOrbitTexture);
            gl.uniform1i(locs.u_refOrbit, 0);

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

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.fractalTextureValid = true;

        // Update Minimap viewfinder
        if (this.minimap && this.state.fractalType === 0) {
            this.minimap.updateViewport(this.state, width / height);
        }
    }

    renderBlitPalette() {
        const gl = this.gl;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const locs = this.locationsBlit;

        gl.viewport(0, 0, width, height);
        gl.useProgram(this.programBlit);
        gl.bindVertexArray(this.quadVao);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.fractalTexture);
        gl.uniform1i(locs.u_fractal_texture, 0);

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
    }

    render(forceCompute = false) {
        if (forceCompute || !this.fractalTextureValid) {
            this.renderFractalToFBO();
        }
        this.renderBlitPalette();
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

                const diffX = dd_sub(anim.toDD_x[0], anim.toDD_x[1], anim.fromDD_x[0], anim.fromDD_x[1]);
                const diffY = dd_sub(anim.toDD_y[0], anim.toDD_y[1], anim.fromDD_y[0], anim.fromDD_y[1]);

                const stepX = dd_mul(diffX[0], diffX[1], ease, 0.0);
                const stepY = dd_mul(diffY[0], diffY[1], ease, 0.0);

                this.state.centerDD_x = dd_add(anim.fromDD_x[0], anim.fromDD_x[1], stepX[0], stepX[1]);
                this.state.centerDD_y = dd_add(anim.fromDD_y[0], anim.fromDD_y[1], stepY[0], stepY[1]);
                this.state.centerX = this.state.centerDD_x[0] + this.state.centerDD_x[1];
                this.state.centerY = this.state.centerDD_y[0] + this.state.centerDD_y[1];

                // Logarithmic zoom interpolation for natural perceptual zoom speed
                const logFrom = Math.log(anim.fromZoom);
                const logTo = Math.log(anim.toZoom);
                this.state.zoom = Math.exp(logFrom + (logTo - logFrom) * ease);

                this.invalidateFractal();

                if (t >= 1.0) {
                    this.cameraAnimation = null;
                    this.syncToHash();
                }
            }

            // Pan inertia / momentum
            if (!this.isDragging && (Math.abs(this.momentum.vx) > 0.0001 || Math.abs(this.momentum.vy) > 0.0001)) {
                const minDim = Math.min(this.canvas.width, this.canvas.height);
                const scaleVal = 3.0 / this.state.zoom;
                const stepX = (this.momentum.vx / minDim) * scaleVal;
                const stepY = (this.momentum.vy / minDim) * scaleVal;

                this.state.centerDD_x = dd_sub(this.state.centerDD_x[0], this.state.centerDD_x[1], stepX, 0.0);
                this.state.centerDD_y = dd_add(this.state.centerDD_y[0], this.state.centerDD_y[1], stepY, 0.0);
                this.state.centerX = this.state.centerDD_x[0] + this.state.centerDD_x[1];
                this.state.centerY = this.state.centerDD_y[0] + this.state.centerDD_y[1];

                this.momentum.vx *= 0.90;
                this.momentum.vy *= 0.90;
                this.invalidateFractal();

                if (Math.abs(this.momentum.vx) <= 0.0001 && Math.abs(this.momentum.vy) <= 0.0001) {
                    this.momentum.vx = 0;
                    this.momentum.vy = 0;
                    this.syncToHash();
                }
            }

            // Dynamic color cycling animation (lightning fast: only re-blits palette pass)
            if (this.state.animateColor) {
                this.state.palettePhase = (this.state.palettePhase + this.state.colorSpeed) % 1.0;
                this.renderBlitPalette();
            }

            if (this.needsRender) {
                this.render();
            }

            requestAnimationFrame(loop);
        };

        requestAnimationFrame(loop);
    }

    screenToComplexDD(px, py) {
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
        const deltaX = offsetX * scaleVal;
        const deltaY = offsetY * scaleVal;

        const real = dd_add(this.state.centerDD_x[0], this.state.centerDD_x[1], deltaX, 0.0);
        const imag = dd_add(this.state.centerDD_y[0], this.state.centerDD_y[1], deltaY, 0.0);

        return { real, imag };
    }

    screenToComplex(px, py) {
        const dd = this.screenToComplexDD(px, py);
        return {
            real: dd.real[0] + dd.real[1],
            imag: dd.imag[0] + dd.imag[1]
        };
    }

    flyTo(targetX, targetY, targetZoom, duration = 1000) {
        let toDD_x, toDD_y;
        if (Array.isArray(targetX)) toDD_x = [targetX[0], targetX[1]];
        else if (typeof targetX === 'string') toDD_x = dd_from_string(targetX);
        else toDD_x = dd_set(targetX);

        if (Array.isArray(targetY)) toDD_y = [targetY[0], targetY[1]];
        else if (typeof targetY === 'string') toDD_y = dd_from_string(targetY);
        else toDD_y = dd_set(targetY);

        this.cameraAnimation = {
            fromDD_x: [...this.state.centerDD_x],
            fromDD_y: [...this.state.centerDD_y],
            fromZoom: this.state.zoom,
            toDD_x: toDD_x,
            toDD_y: toDD_y,
            toZoom: targetZoom,
            startTime: performance.now(),
            duration: Math.max(300, duration)
        };
        this.invalidateFractal();
    }

    zoomAtPoint(screenX, screenY, factor) {
        const before = this.screenToComplexDD(screenX, screenY);
        const newZoom = Math.max(0.1, Math.min(1e30, this.state.zoom * factor));

        const minDim = Math.min(this.canvas.width, this.canvas.height);
        const rect = this.canvas.getBoundingClientRect();
        const dpr = this.state.dpr;

        const canvasX = (screenX - rect.left) * dpr;
        const canvasY = (rect.height - (screenY - rect.top)) * dpr;
        const offsetX = (canvasX - 0.5 * this.canvas.width) / minDim;
        const offsetY = (canvasY - 0.5 * this.canvas.height) / minDim;

        const newScaleVal = 3.0 / newZoom;
        const deltaX = offsetX * newScaleVal;
        const deltaY = offsetY * newScaleVal;

        this.state.centerDD_x = dd_sub(before.real[0], before.real[1], deltaX, 0.0);
        this.state.centerDD_y = dd_sub(before.imag[0], before.imag[1], deltaY, 0.0);
        this.state.centerX = this.state.centerDD_x[0] + this.state.centerDD_x[1];
        this.state.centerY = this.state.centerDD_y[0] + this.state.centerDD_y[1];
        this.state.zoom = newZoom;

        this.invalidateFractal();
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

        this.invalidateFractal();
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

        if (preset.centerX_str && preset.centerY_str) {
            this.setCenter(preset.centerX_str, preset.centerY_str);
        } else if (preset.centerDD_x && preset.centerDD_y) {
            this.setCenter(preset.centerDD_x, preset.centerDD_y);
        } else {
            this.setCenter(preset.centerX, preset.centerY);
        }

        this.setFractalType(preset.type, preset.juliaC);
        this.flyTo(this.state.centerDD_x, this.state.centerDD_y, preset.zoom, 1200);

        if (this.pipJulia && preset.type === 0) {
            this.pipJulia.setConstant(this.state.centerX, this.state.centerY, this.state.palette, this.state.paletteFreq);
        }
    }

    updateHUD() {
        const hudCoords = document.getElementById('hudCoords');
        const hudZoom = document.getElementById('hudZoom');
        const hudIter = document.getElementById('hudIter');
        const hudPrecision = document.getElementById('hudPrecision');

        if (hudCoords) {
            const zoomLog = Math.log10(Math.max(1, this.state.zoom));
            const prec = Math.min(28, Math.max(8, Math.ceil(zoomLog) + 3));
            const rx = dd_to_string(this.state.centerDD_x[0], this.state.centerDD_x[1], prec);
            const ry = dd_to_string(this.state.centerDD_y[0], this.state.centerDD_y[1], prec);
            const signX = (this.state.centerDD_x[0] >= 0 && !rx.startsWith('-') && !rx.startsWith('+')) ? '+' : '';
            const signY = (this.state.centerDD_y[0] >= 0 && !ry.startsWith('-') && !ry.startsWith('+')) ? '+' : '';
            hudCoords.textContent = `${signX}${rx}, ${signY}${ry}i`;
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
            const isDD = this.state.zoom >= 1e14;
            if (isDD) {
                hudPrecision.textContent = 'FP106 (Double-Double)';
                hudPrecision.className = 'hud-badge badge-fp64';
            } else if (isPerturb) {
                hudPrecision.textContent = 'FP64 (Perturbation)';
                hudPrecision.className = 'hud-badge badge-fp64';
            } else {
                const isDbl = this.isUsingDoublePrecision();
                hudPrecision.textContent = isDbl ? 'FP64 (Double)' : 'FP32 (Fast)';
                hudPrecision.className = isDbl ? 'hud-badge badge-fp64' : 'hud-badge badge-fp32';
            }
        }
    }

    initEvents() {
        // Hash navigation support (browser back/forward or manual hash change)
        window.addEventListener('hashchange', () => this.loadFromHash());

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
                this.centerAtDragStartDD_x = [...this.state.centerDD_x];
                this.centerAtDragStartDD_y = [...this.state.centerDD_y];
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

                const deltaX = (dx * dpr / minDim) * scaleVal;
                const deltaY = (dy * dpr / minDim) * scaleVal;

                this.state.centerDD_x = dd_sub(this.centerAtDragStartDD_x[0], this.centerAtDragStartDD_x[1], deltaX, 0.0);
                this.state.centerDD_y = dd_add(this.centerAtDragStartDD_y[0], this.centerAtDragStartDD_y[1], deltaY, 0.0);
                this.state.centerX = this.state.centerDD_x[0] + this.state.centerDD_x[1];
                this.state.centerY = this.state.centerDD_y[0] + this.state.centerDD_y[1];

                // Track momentum
                const now = performance.now();
                const dt = Math.max(1, now - this.lastPointerTime);
                this.momentum.vx = ((e.clientX - this.lastPointerPos.x) * dpr / dt) * 16;
                this.momentum.vy = ((e.clientY - this.lastPointerPos.y) * dpr / dt) * 16;
                this.lastPointerPos = { x: e.clientX, y: e.clientY };
                this.lastPointerTime = now;

                this.invalidateFractal();
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
                this.centerAtDragStartDD_x = [...this.state.centerDD_x];
                this.centerAtDragStartDD_y = [...this.state.centerDD_y];
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

                const deltaX = (dx * dpr / minDim) * scaleVal;
                const deltaY = (dy * dpr / minDim) * scaleVal;

                this.state.centerDD_x = dd_sub(this.centerAtDragStartDD_x[0], this.centerAtDragStartDD_x[1], deltaX, 0.0);
                this.state.centerDD_y = dd_add(this.centerAtDragStartDD_y[0], this.centerAtDragStartDD_y[1], deltaY, 0.0);
                this.state.centerX = this.state.centerDD_x[0] + this.state.centerDD_x[1];
                this.state.centerY = this.state.centerDD_y[0] + this.state.centerDD_y[1];
                this.invalidateFractal();
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
                    this.state.centerDD_x = dd_sub(this.state.centerDD_x[0], this.state.centerDD_x[1], step, 0.0);
                    this.state.centerX = this.state.centerDD_x[0] + this.state.centerDD_x[1];
                    this.invalidateFractal();
                    break;
                case 'ArrowRight':
                case 'd':
                case 'D':
                    this.state.centerDD_x = dd_add(this.state.centerDD_x[0], this.state.centerDD_x[1], step, 0.0);
                    this.state.centerX = this.state.centerDD_x[0] + this.state.centerDD_x[1];
                    this.invalidateFractal();
                    break;
                case 'ArrowUp':
                case 'w':
                case 'W':
                    this.state.centerDD_y = dd_add(this.state.centerDD_y[0], this.state.centerDD_y[1], step, 0.0);
                    this.state.centerY = this.state.centerDD_y[0] + this.state.centerDD_y[1];
                    this.invalidateFractal();
                    break;
                case 'ArrowDown':
                case 's':
                case 'S':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.takeSnapshot();
                        return;
                    }
                    this.state.centerDD_y = dd_sub(this.state.centerDD_y[0], this.state.centerDD_y[1], step, 0.0);
                    this.state.centerY = this.state.centerDD_y[0] + this.state.centerDD_y[1];
                    this.invalidateFractal();
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
                case 'p':
                case 'P':
                    this.toggleControlPanel();
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
        const centerComplexDD = this.screenToComplexDD(midX, midY);

        const zoomFactor = Math.min(window.innerWidth / boxW, window.innerHeight / boxH);
        this.flyTo(centerComplexDD.real, centerComplexDD.imag, this.state.zoom * zoomFactor, 800);
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

    toggleControlPanel(forceOpen = null) {
        const controlPanel = document.getElementById('controlPanel');
        const btnExpandPanel = document.getElementById('btnExpandPanel');
        if (!controlPanel) return;

        const isCurrentlyCollapsed = controlPanel.classList.contains('collapsed');
        const shouldCollapse = forceOpen !== null ? !forceOpen : !isCurrentlyCollapsed;

        if (shouldCollapse) {
            controlPanel.classList.add('collapsed');
            if (btnExpandPanel) btnExpandPanel.classList.remove('hidden');
            this.showToast('Controls hidden (Press P or click Controls tab)');
        } else {
            controlPanel.classList.remove('collapsed');
            if (btnExpandPanel) btnExpandPanel.classList.add('hidden');
            this.showToast('Controls restored');
        }
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
                this.invalidateFractal();
            });
        }

        // Auto iterations toggle
        const autoIterToggle = document.getElementById('autoIterationsToggle');
        if (autoIterToggle) {
            autoIterToggle.checked = this.state.autoIterations;
            autoIterToggle.addEventListener('change', (e) => {
                this.state.autoIterations = e.target.checked;
                this.invalidateFractal();
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
                this.invalidateFractal();
            });
        }

        // Precision Mode
        const precSelect = document.getElementById('precisionModeSelect');
        if (precSelect) {
            precSelect.value = this.state.precisionMode;
            precSelect.addEventListener('change', (e) => {
                this.state.precisionMode = e.target.value;
                this.invalidateFractal();
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

        // Toggle panel collapse / expand
        const btnCollapsePanel = document.getElementById('btnCollapsePanel');
        const btnExpandPanel = document.getElementById('btnExpandPanel');
        const btnToggleControls = document.getElementById('btnToggleControls');

        if (btnCollapsePanel) {
            btnCollapsePanel.addEventListener('click', () => {
                this.toggleControlPanel(false);
            });
        }
        if (btnExpandPanel) {
            btnExpandPanel.addEventListener('click', () => {
                this.toggleControlPanel(true);
            });
        }
        if (btnToggleControls) {
            btnToggleControls.addEventListener('click', () => {
                this.toggleControlPanel();
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
            this.initFBO(targetW, targetH);
        }

        this.render(true);
        this.downloadCanvas(this.canvas);

        if (targetW !== originalW || targetH !== originalH) {
            this.canvas.width = originalW;
            this.canvas.height = originalH;
            this.initFBO(originalW, originalH);
            this.render(true);
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
        const zoomLog = Math.log10(Math.max(1, this.state.zoom));
        const prec = Math.min(28, Math.max(8, Math.ceil(zoomLog) + 3));
        const rx = dd_to_string(this.state.centerDD_x[0], this.state.centerDD_x[1], prec);
        const ry = dd_to_string(this.state.centerDD_y[0], this.state.centerDD_y[1], prec);
        params.set('x', rx);
        params.set('y', ry);
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

            let newX = null, newY = null;
            if (params.has('x')) newX = params.get('x');
            if (params.has('y')) newY = params.get('y');
            if (newX !== null || newY !== null) {
                this.setCenter(newX ?? this.state.centerDD_x, newY ?? this.state.centerDD_y);
            }
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
