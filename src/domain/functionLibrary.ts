/**
 * Function library — all math the evaluator is allowed to reach for.
 *
 * Layer: domain (pure, no React / DOM / storage imports).
 *
 * Every routine takes and returns `Decimal`. No native float arithmetic is used
 * anywhere in the engine: constants such as PI are computed from a high-precision
 * literal via `new Decimal(...)` and every transcendental call goes through
 * decimal.js so that chained calculations keep full internal precision.
 *
 * Domain violations are reported as typed CalcError('INVALID_DOMAIN'), overflow
 * as CalcError('OVERFLOW').
 */

import Decimal from 'decimal.js';
import { CalcError } from './errors';

/**
 * Precision policy (per spec §4 Numeric rules):
 *  - PRECISION: significant digits retained internally. Must be >= 30.
 *  - ROUNDING_MODE: how the last retained digit is decided.
 *  - EXPONENTIAL thresholds: keep decimal.js's internal string form stable and
 *    let the display layer decide on scientific notation. The parameters are set
 *    to well outside the display range so internal values stay plain.
 *
 * These settings are applied at module load so that importing
 * `functionLibrary` is enough to make the whole domain layer deterministic.
 */
export const PRECISION = 40;
export const DISPLAY_SIGNIFICANT_DIGITS = 15;

Decimal.set({
  precision: PRECISION,
  rounding: Decimal.ROUND_HALF_UP,
  // Keep internal to/sd output plain over a very wide range; display formatting
  // is the presentation layer's responsibility.
  toExpNeg: -9e15,
  toExpPos: 9e15,
  minE: -9e15,
  maxE: 9e15,
});

export type AngleMode = 'deg' | 'rad';

/** π computed at the configured precision. */
export const PI: Decimal = new Decimal(
  '3.14159265358979323846264338327950288419716939937510582097494459230781640628620899862803482534211706798',
);

/** 180 at the configured precision, for degrees↔radians conversion. */
const ONE_EIGHTY = new Decimal(180);

/** number of radians per degree, precomputed at full precision. */
const DEG_TO_RAD = PI.dividedBy(ONE_EIGHTY);

/**
 * Detect a non-finite Decimal (NaN / ±Infinity) and raise OVERFLOW.
 *
 * `decimal.js` represents divide-by-zero as ±Infinity and domain-free
 * transcendental edge cases as NaN; the domain layer must never leak those
 * values upward as normal results.
 */
export function assertFiniteResult(value: Decimal): Decimal {
  if (value.isFinite()) {
    return value;
  }
  throw new CalcError('OVERFLOW');
}

// --- arithmetic -----------------------------------------------------------

export function add(a: Decimal, b: Decimal): Decimal {
  return assertFiniteResult(a.plus(b));
}

export function subtract(a: Decimal, b: Decimal): Decimal {
  return assertFiniteResult(a.minus(b));
}

export function multiply(a: Decimal, b: Decimal): Decimal {
  return assertFiniteResult(a.times(b));
}

export function divide(a: Decimal, b: Decimal): Decimal {
  if (b.isZero()) {
    throw new CalcError('DIVIDE_BY_ZERO');
  }
  return assertFiniteResult(a.dividedBy(b));
}

/** Power with integer-exponent fast path and fractional-exponent domain check. */
export function power(base: Decimal, exponent: Decimal): Decimal {
  // 0^0 is conventionally 1 in this calculator (matches most desk calculators).
  if (base.isZero() && exponent.isZero()) {
    return new Decimal(1);
  }
  // 0^negative → divide by zero.
  if (base.isZero() && exponent.isNegative()) {
    throw new CalcError('DIVIDE_BY_ZERO');
  }
  // Negative base with a non-integer exponent has no real result.
  if (base.isNegative() && !exponent.isInteger()) {
    throw new CalcError('INVALID_DOMAIN');
  }
  const result = base.pow(exponent);
  return assertFiniteResult(result);
}

// --- direct unary helpers -------------------------------------------------

export function square(x: Decimal): Decimal {
  return assertFiniteResult(x.times(x));
}

export function cube(x: Decimal): Decimal {
  return assertFiniteResult(x.times(x).times(x));
}

export function sqrt(x: Decimal): Decimal {
  if (x.isNegative()) {
    throw new CalcError('INVALID_DOMAIN');
  }
  return assertFiniteResult(x.sqrt());
}

// --- logarithms -----------------------------------------------------------

/** Base-10 logarithm. Domain is strictly positive. */
export function log10(x: Decimal): Decimal {
  if (x.isNegative() || x.isZero()) {
    throw new CalcError('INVALID_DOMAIN');
  }
  return assertFiniteResult(x.log(10));
}

/** Natural logarithm. Domain is strictly positive. */
export function ln(x: Decimal): Decimal {
  if (x.isNegative() || x.isZero()) {
    throw new CalcError('INVALID_DOMAIN');
  }
  return assertFiniteResult(x.ln());
}

// --- trigonometry ---------------------------------------------------------

/** Convert a value in the given angle mode into radians. */
export function toRadians(value: Decimal, mode: AngleMode): Decimal {
  if (mode === 'rad') {
    return value;
  }
  return value.times(DEG_TO_RAD);
}

export function sin(x: Decimal, mode: AngleMode): Decimal {
  return assertFiniteResult(toRadians(x, mode).sin());
}

export function cos(x: Decimal, mode: AngleMode): Decimal {
  return assertFiniteResult(toRadians(x, mode).cos());
}

export function tan(x: Decimal, mode: AngleMode): Decimal {
  const radians = toRadians(x, mode);
  // tan(90°) is undefined: cos(90°) is exactly 0 at our working precision only
  // if the argument is reduced exactly; guard against the explicit singular case
  // in degrees so the user gets a typed error instead of a wildly large number.
  if (mode === 'deg') {
    const normalised = x.modulo(180);
    if (normalised.equals(90) || normalised.equals(-90)) {
      throw new CalcError('INVALID_DOMAIN', 'tan is undefined at 90°.');
    }
  }
  return assertFiniteResult(radians.tan());
}

// --- constants ------------------------------------------------------------

export function pi(): Decimal {
  return PI;
}