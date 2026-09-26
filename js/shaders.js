// WebGL 2.0 Shader Sources for Mandelbrot, Julia, Burning Ship, and Multibrot fractals
// Includes standard 32-bit single-precision shader and 64-bit emulated double-single shader for deep zoom

export const VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 a_position;
out vec2 v_uv;

void main() {
    v_uv = (a_position + 1.0) * 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER_SINGLE = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform vec2 u_center;
uniform vec2 u_scale;
uniform int u_max_iterations;
uniform int u_fractal_type; // 0=Mandelbrot, 1=Julia, 2=Burning Ship, 3=Multibrot 3, 4=Multibrot 4
uniform vec2 u_julia_c;

uniform vec3 u_palette_a;
uniform vec3 u_palette_b;
uniform vec3 u_palette_c;
uniform vec3 u_palette_d;
uniform float u_palette_freq;
uniform float u_palette_phase;
uniform int u_interior_mode; // 0: black, 1: glowing orbit trap, 2: zebra stripes

const float PI2 = 6.283185307179586;
const float ESCAPE_RADIUS_SQ = 64.0;

vec3 evalPalette(float t) {
    return u_palette_a + u_palette_b * cos(PI2 * (u_palette_c * t + u_palette_d));
}

void main() {
    // Coordinate mapping centered and aspect-corrected
    float minDim = min(u_resolution.x, u_resolution.y);
    vec2 offset = (gl_FragCoord.xy - 0.5 * u_resolution) / minDim;
    vec2 c = u_center + offset * u_scale;

    vec2 z;
    vec2 constC;
    float power = 2.0;

    if (u_fractal_type == 1) {
        // Julia set
        z = c;
        constC = u_julia_c;
    } else {
        // Mandelbrot, Burning Ship, Multibrot
        z = vec2(0.0);
        constC = c;
        if (u_fractal_type == 3) power = 3.0;
        if (u_fractal_type == 4) power = 4.0;
    }

    // Early bailout optimization for main Mandelbrot cardioid and period-2 bulb
    if (u_fractal_type == 0) {
        float cx = constC.x;
        float cy = constC.y;
        float cy2 = cy * cy;
        // Period-2 bulb test: (x+1)^2 + y^2 <= 1/16
        if ((cx + 1.0) * (cx + 1.0) + cy2 <= 0.0625) {
            fragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
        }
        // Main cardioid test: q = (x - 1/4)^2 + y^2; q * (q + (x - 1/4)) <= 1/4 * y^2
        float qx = cx - 0.25;
        float q = qx * qx + cy2;
        if (q * (q + qx) <= 0.25 * cy2) {
            fragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
        }
    }

    int iter = 0;
    float minDistanceSq = 1e10;
    float stripeAccum = 0.0;
    float r2 = 0.0;

    for (int i = 0; i < 4000; i++) {
        if (i >= u_max_iterations) break;

        float zx = z.x;
        float zy = z.y;
        r2 = zx * zx + zy * zy;

        if (r2 > ESCAPE_RADIUS_SQ) {
            iter = i;
            break;
        }

        if (i > 0) {
            minDistanceSq = min(minDistanceSq, r2);
            stripeAccum += 0.5 + 0.5 * sin(2.0 * atan(zy, zx) + r2);
        }

        if (u_fractal_type == 2) {
            // Burning ship: (|Re(z)| + i|Im(z)|)^2 + c
            float ax = abs(zx);
            float ay = abs(zy);
            z = vec2(ax * ax - ay * ay + constC.x, -2.0 * ax * ay + constC.y);
        } else if (u_fractal_type == 3) {
            // Multibrot 3: z^3 + c = (x^3 - 3xy^2) + i(3x^2y - y^3) + c
            z = vec2(zx * (zx * zx - 3.0 * zy * zy) + constC.x, zy * (3.0 * zx * zx - zy * zy) + constC.y);
        } else if (u_fractal_type == 4) {
            // Multibrot 4: z^4 + c
            float zx2 = zx * zx;
            float zy2 = zy * zy;
            z = vec2(zx2 * zx2 - 6.0 * zx2 * zy2 + zy2 * zy2 + constC.x, 4.0 * zx * zy * (zx2 - zy2) + constC.y);
        } else {
            // Standard Mandelbrot / Julia (z^2 + c)
            z = vec2(zx * zx - zy * zy + constC.x, 2.0 * zx * zy + constC.y);
        }
    }

    if (r2 <= ESCAPE_RADIUS_SQ) {
        // Point is inside the set
        if (u_interior_mode == 1) {
            // Orbit trap iridescent glow
            float glow = clamp(1.0 - sqrt(minDistanceSq) * 1.3, 0.0, 1.0);
            vec3 intCol = u_palette_a * pow(glow, 2.2) * 0.8;
            fragColor = vec4(intCol, 1.0);
        } else if (u_interior_mode == 2) {
            // Interior zebra stripes
            float s = 0.5 + 0.5 * sin(stripeAccum * 0.4);
            fragColor = vec4(u_palette_a * s * 0.5, 1.0);
        } else {
            // Classic solid obsidian black
            fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        }
        return;
    }

    // Continuous normalized smooth iteration count
    // nu = i + 1 - log(0.5 * log(r2)) / log(power)
    float logR = 0.5 * log(r2);
    float nu = float(iter) + 1.0 - log(max(1.0, logR)) / log(power);

    float t = nu * (u_palette_freq * 0.04) + u_palette_phase;
    vec3 color = evalPalette(t);

    fragColor = vec4(color, 1.0);
}
`;

export const FRAGMENT_SHADER_DOUBLE = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;

// Center and scale split into high and low 32-bit floats for double-single emulation
uniform vec2 u_center_hi;
uniform vec2 u_center_lo;
uniform vec2 u_scale_hi;
uniform vec2 u_scale_lo;

uniform int u_max_iterations;
uniform int u_fractal_type; // 0=Mandelbrot, 1=Julia, 2=Burning Ship
uniform vec2 u_julia_c;

uniform vec3 u_palette_a;
uniform vec3 u_palette_b;
uniform vec3 u_palette_c;
uniform vec3 u_palette_d;
uniform float u_palette_freq;
uniform float u_palette_phase;
uniform int u_interior_mode;

const float PI2 = 6.283185307179586;
const float ESCAPE_RADIUS_SQ = 64.0;

// Double-single arithmetic functions
vec2 ds_set(float a) {
    return vec2(a, 0.0);
}

// Knuth two-sum
vec2 ds_add(vec2 a, vec2 b) {
    float s = a.x + b.x;
    float v = s - a.x;
    float e = (a.x - (s - v)) + (b.x - v);
    float g = e + (a.y + b.y);
    float zh = s + g;
    float zl = g - (zh - s);
    return vec2(zh, zl);
}

vec2 ds_sub(vec2 a, vec2 b) {
    return ds_add(a, vec2(-b.x, -b.y));
}

// Dekker splitting for exact product
vec2 ds_split(float a) {
    const float split = 4097.0; // 2^12 + 1
    float c = split * a;
    float a_hi = c - (c - a);
    float a_lo = a - a_hi;
    return vec2(a_hi, a_lo);
}

// Double-single multiplication
vec2 ds_mul(vec2 a, vec2 b) {
    float p = a.x * b.x;
    vec2 a_s = ds_split(a.x);
    vec2 b_s = ds_split(b.x);
    float err = ((a_s.x * b_s.x - p) + a_s.x * b_s.y + a_s.y * b_s.x) + a_s.y * b_s.y;
    err += a.x * b.y + a.y * b.x;
    float zh = p + err;
    float zl = err - (zh - p);
    return vec2(zh, zl);
}

vec2 ds_sqr(vec2 a) {
    float p = a.x * a.x;
    vec2 a_s = ds_split(a.x);
    float err = ((a_s.x * a_s.x - p) + 2.0 * a_s.x * a_s.y) + a_s.y * a_s.y;
    err += 2.0 * a.x * a.y;
    float zh = p + err;
    float zl = err - (zh - p);
    return vec2(zh, zl);
}

vec3 evalPalette(float t) {
    return u_palette_a + u_palette_b * cos(PI2 * (u_palette_c * t + u_palette_d));
}

void main() {
    float minDim = min(u_resolution.x, u_resolution.y);
    vec2 offset = (gl_FragCoord.xy - 0.5 * u_resolution) / minDim;

    vec2 scale_x = vec2(u_scale_hi.x, u_scale_lo.x);
    vec2 scale_y = vec2(u_scale_hi.y, u_scale_lo.y);

    vec2 center_x = vec2(u_center_hi.x, u_center_lo.x);
    vec2 center_y = vec2(u_center_hi.y, u_center_lo.y);

    // High-precision coordinates
    vec2 cx = ds_add(center_x, ds_mul(ds_set(offset.x), scale_x));
    vec2 cy = ds_add(center_y, ds_mul(ds_set(offset.y), scale_y));

    vec2 zx = vec2(0.0);
    vec2 zy = vec2(0.0);
    vec2 constCx = cx;
    vec2 constCy = cy;

    if (u_fractal_type == 1) {
        // Julia set in double precision
        zx = cx;
        zy = cy;
        constCx = ds_set(u_julia_c.x);
        constCy = ds_set(u_julia_c.y);
    }

    int iter = 0;
    float r2 = 0.0;
    float minDistanceSq = 1e10;

    for (int i = 0; i < 4000; i++) {
        if (i >= u_max_iterations) break;

        vec2 zx2 = ds_sqr(zx);
        vec2 zy2 = ds_sqr(zy);
        r2 = zx2.x + zy2.x;

        if (r2 > ESCAPE_RADIUS_SQ) {
            iter = i;
            break;
        }

        if (i > 0) {
            minDistanceSq = min(minDistanceSq, r2);
        }

        vec2 zxy = ds_mul(zx, zy);
        vec2 two_zxy = ds_add(zxy, zxy);

        if (u_fractal_type == 2) {
            // Burning ship
            zx = ds_add(ds_sub(zx2, zy2), constCx);
            zy = ds_add(ds_set(-abs(two_zxy.x)), constCy);
        } else {
            // Standard z^2 + c
            zx = ds_add(ds_sub(zx2, zy2), constCx);
            zy = ds_add(two_zxy, constCy);
        }
    }

    if (r2 <= ESCAPE_RADIUS_SQ) {
        if (u_interior_mode == 1) {
            float glow = clamp(1.0 - sqrt(minDistanceSq) * 1.3, 0.0, 1.0);
            vec3 intCol = u_palette_a * pow(glow, 2.2) * 0.8;
            fragColor = vec4(intCol, 1.0);
        } else {
            fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        }
        return;
    }

    float logR = 0.5 * log(r2);
    float nu = float(iter) + 1.0 - log(max(1.0, logR)) / log(2.0);

    float t = nu * (u_palette_freq * 0.04) + u_palette_phase;
    vec3 color = evalPalette(t);

    fragColor = vec4(color, 1.0);
}
`;
