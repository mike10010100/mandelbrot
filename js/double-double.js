// High-performance Double-Double (106-bit / ~31 decimal digit) precision arithmetic
// Based on algorithms by Knuth, Dekker, Priest, and Bailey (QD library)
// Each number is represented as an unevaluated sum of two 64-bit IEEE 754 floats: [hi, lo]
// where |lo| <= 0.5 * ulp(hi).

const SPLIT = 134217729.0; // 2^27 + 1 for IEEE 754 float64 mantissa splitting

/**
 * Exact sum of two floating-point numbers (Knuth's Two-Sum).
 * Returns [s, e] where s + e = a + b exactly, and s = round(a + b).
 */
export function two_sum(a, b) {
    const s = a + b;
    const v = s - a;
    const e = (a - (s - v)) + (b - v);
    return [s, e];
}

/**
 * Fast sum when |a| >= |b|.
 */
export function quick_two_sum(a, b) {
    const s = a + b;
    const e = b - (s - a);
    return [s, e];
}

/**
 * Exact product of two floating-point numbers (Dekker's Two-Product).
 * Returns [p, e] where p + e = a * b exactly, and p = round(a * b).
 */
export function two_prod(a, b) {
    const p = a * b;
    const ca = SPLIT * a;
    const a_hi = ca - (ca - a);
    const a_lo = a - a_hi;
    const cb = SPLIT * b;
    const b_hi = cb - (cb - b);
    const b_lo = b - b_hi;
    const err = ((a_hi * b_hi - p) + a_hi * b_lo + a_lo * b_hi) + a_lo * b_lo;
    return [p, err];
}

/**
 * Double-Double addition: (a_hi + a_lo) + (b_hi + b_lo)
 */
export function dd_add(a_hi, a_lo, b_hi, b_lo) {
    const [s, e] = two_sum(a_hi, b_hi);
    const g = e + (a_lo + b_lo);
    return quick_two_sum(s, g);
}

/**
 * Double-Double subtraction: (a_hi + a_lo) - (b_hi + b_lo)
 */
export function dd_sub(a_hi, a_lo, b_hi, b_lo) {
    return dd_add(a_hi, a_lo, -b_hi, -b_lo);
}

/**
 * Double-Double multiplication: (a_hi + a_lo) * (b_hi + b_lo)
 */
export function dd_mul(a_hi, a_lo, b_hi, b_lo) {
    const [p, err] = two_prod(a_hi, b_hi);
    const err2 = err + (a_hi * b_lo + a_lo * b_hi);
    return quick_two_sum(p, err2);
}

/**
 * Double-Double squaring: (a_hi + a_lo)^2
 * Optimized with single product and doubling of cross term.
 */
export function dd_sqr(a_hi, a_lo) {
    const [p, err] = two_prod(a_hi, a_hi);
    const err2 = err + 2.0 * a_hi * a_lo;
    return quick_two_sum(p, err2);
}

/**
 * Double-Double division: (a_hi + a_lo) / (b_hi + b_lo)
 */
export function dd_div(a_hi, a_lo, b_hi, b_lo) {
    const q1 = a_hi / b_hi;
    const [p_hi, p_lo] = two_prod(q1, b_hi);
    const [d_hi, d_lo] = dd_sub(a_hi, a_lo, p_hi, p_lo + q1 * b_lo);
    const q2 = d_hi / b_hi;
    return quick_two_sum(q1, q2);
}

/**
 * Create a double-double from a single number.
 */
export function dd_set(val) {
    return [val, 0.0];
}

/**
 * Parse an arbitrary-precision decimal string into a double-double [hi, lo].
 */
export function dd_from_string(str) {
    if (!str || typeof str !== 'string') return [0.0, 0.0];
    const trimmed = str.trim();
    const hi = parseFloat(trimmed);
    if (!Number.isFinite(hi)) return [hi, 0.0];

    // High-precision remainder parsing
    // Subtract hi from string representation using BigInt decimal scaling if string is long
    const dotIdx = trimmed.indexOf('.');
    if (dotIdx === -1 || trimmed.length <= 15) {
        return [hi, 0.0];
    }

    // Parse with BigInt scaling to capture full fractional precision
    try {
        const isNeg = trimmed.startsWith('-');
        const cleanStr = isNeg ? trimmed.slice(1) : trimmed;
        const [intPart, fracPart = ''] = cleanStr.split('.');
        const fullDigits = intPart + fracPart;
        const scale = fracPart.length;

        // Convert hi to BigInt representation with same scale
        const hiStr = Math.abs(hi).toFixed(scale);
        const [hiInt, hiFrac = ''] = hiStr.split('.');
        const hiFullDigits = hiInt + hiFrac;

        const diff = BigInt(fullDigits) - BigInt(hiFullDigits);
        const loVal = Number(diff) / Math.pow(10, scale);
        const lo = isNeg ? -loVal : loVal;

        return quick_two_sum(hi, lo);
    } catch {
        return [hi, 0.0];
    }
}

/**
 * Helper to convert IEEE 754 float64 to exact rational fraction [num, den] using BigInt.
 */
function floatToFraction(f) {
    if (f === 0) return [0n, 1n];
    const buf = new ArrayBuffer(8);
    new Float64Array(buf)[0] = f;
    const u32 = new Uint32Array(buf);
    const hi = u32[1], lo = u32[0];
    const sign = (hi & 0x80000000) !== 0 ? -1n : 1n;
    const exp = (hi >> 20) & 0x7ff;
    let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    let e = exp - 1023 - 52;
    if (exp === 0) {
        e = 1 - 1023 - 52;
    } else {
        mant |= (1n << 52n);
    }
    let num = sign * mant;
    let den = 1n;
    if (e >= 0) {
        num <<= BigInt(e);
    } else {
        den <<= BigInt(-e);
    }
    return [num, den];
}

/**
 * Format a double-double [hi, lo] to a decimal string with specified decimal precision.
 * Uses exact BigInt rational arithmetic to guarantee bit-exact accuracy up to 32 digits.
 */
export function dd_to_string(hi, lo, decimals = 28) {
    if (!Number.isFinite(hi)) return String(hi);
    if (hi === 0 && lo === 0) return (0).toFixed(decimals);
    if (decimals <= 14) return (hi + lo).toFixed(decimals);

    const prec = Math.max(1, Math.min(32, decimals));
    const [n1, d1] = floatToFraction(hi);
    const [n2, d2] = floatToFraction(lo);
    const num = n1 * d2 + n2 * d1;
    const den = d1 * d2;

    const sign = num < 0n ? '-' : '';
    const absNum = num < 0n ? -num : num;

    const scale = 10n ** BigInt(prec);
    const scaled = (absNum * scale * 10n + 5n * den) / (den * 10n);

    const intPart = scaled / scale;
    const fracPart = scaled % scale;
    const fracStr = fracPart.toString().padStart(prec, '0');

    return `${sign}${intPart}.${fracStr}`;
}

