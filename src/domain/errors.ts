/**
 * Typed error model for the SCI CAL-1 math engine.
 *
 * Layer: domain (pure, no React / DOM / storage imports).
 *
 * No-crash contract: the public entry points of the domain layer
 * (`evaluate` in ./index.ts) must never throw untyped errors and must
 * never surface NaN / Infinity without a CalcError. Every internal
 * failure is normalised into a `CalcError` with one of the codes below.
 */

export type CalcErrorCode =
  | 'DIVIDE_BY_ZERO'
  | 'INVALID_DOMAIN' // sqrt(-), log/ln(<=0)
  | 'MALFORMED_EXPRESSION' // unbalanced parens, trailing operator, bad token
  | 'OVERFLOW';

/** Friendly, user-facing copy for each error code. Never blank, never a stack trace. */
export const CALC_ERROR_MESSAGES: Readonly<Record<CalcErrorCode, string>> = {
  DIVIDE_BY_ZERO: 'Cannot divide by zero.',
  INVALID_DOMAIN: 'That value is outside the function’s domain.',
  MALFORMED_EXPRESSION: 'That expression is incomplete or malformed.',
  OVERFLOW: 'The result is too large to compute.',
};

/**
 * Domain error carrying a stable machine code plus a friendly message.
 *
 * `offset` is optional and, when known, points at the character index in the
 * source expression that caused the failure — useful for future caret
 * highlighting without changing the error contract.
 */
export class CalcError extends Error {
  public readonly code: CalcErrorCode;
  public readonly offset?: number;

  constructor(code: CalcErrorCode, message?: string, offset?: number) {
    super(message ?? CALC_ERROR_MESSAGES[code]);
    this.name = 'CalcError';
    this.code = code;
    if (offset !== undefined) {
      this.offset = offset;
    }
    // Restore prototype chain for targets that transpile class extends Error.
    Object.setPrototypeOf(this, CalcError.prototype);
  }
}

/**
 * Normalise any thrown value into a CalcError.
 *
 * Used at the boundary of the domain layer so that a bug inside the engine can
 * never escape as an untyped exception. Anything that is not already a
 * CalcError is treated as a malformed-expression failure rather than crashing.
 */
export function toCalcError(value: unknown): CalcError {
  if (value instanceof CalcError) {
    return value;
  }
  if (value instanceof Error) {
    return new CalcError('MALFORMED_EXPRESSION', CALC_ERROR_MESSAGES.MALFORMED_EXPRESSION);
  }
  return new CalcError('MALFORMED_EXPRESSION', CALC_ERROR_MESSAGES.MALFORMED_EXPRESSION);
}

/** Convenience predicates so callers never compare raw strings. */
export function isCalcError(value: unknown): value is CalcError {
  return value instanceof CalcError;
}

export function isCalcErrorCode(value: unknown): value is CalcErrorCode {
  return (
    value === 'DIVIDE_BY_ZERO' ||
    value === 'INVALID_DOMAIN' ||
    value === 'MALFORMED_EXPRESSION' ||
    value === 'OVERFLOW'
  );
}