/**
 * Evaluator — stage 3 of the domain pipeline (tokenizer → parser → evaluator).
 *
 * Layer: domain (pure, no React / DOM / storage imports).
 *
 * Walks the AST produced by ./parser.ts and returns a `Decimal`. All arithmetic
 * goes through ./functionLibrary.ts so there is exactly one place where precision
 * and domain rules live.
 *
 * Percentage semantics (per spec §4, five rules):
 *
 *   | Input        | Result          | Rule                         |
 *   |--------------|-----------------|------------------------------|
 *   | `200+10%`    | 220             | a + (a × p/100)              |
 *   | `200−10%`    | 180             | a − (a × p/100)              |
 *   | `200×10%`    | 20              | a × (p/100)                  |
 *   | `200÷10%`    | 2000            | a ÷ (p/100)                  |
 *   | `10%` (lone) | 0.1             | p/100                        |
 *
 * The rule depends on the *parent* binary operator, so `%` cannot be resolved by
 * the `percent` node alone. This evaluator therefore resolves percent nodes in
 * `evalBinary` (where the parent operator is known) and only falls back to the
 * lone `p/100` rule when a `percent` node is reached with no such context.
 */

import Decimal from 'decimal.js';
import { CalcError } from './errors';
import type { AstNode, BinaryOperator, FunctionName } from './parser';
import * as lib from './functionLibrary';
import type { AngleMode } from './functionLibrary';

const ONE_HUNDRED = new Decimal(100);
const ZERO = new Decimal(0);

export interface EvaluateOptions {
  angleMode: AngleMode;
}

/** Is this node a `percent` wrapper? */
function isPercentNode(node: AstNode): node is Extract<AstNode, { kind: 'percent' }> {
  return node.kind === 'percent';
}

/**
 * Collapse nested percent wrappers (`50%%`) to the underlying operand and a
 * count. Extra `%` signs are rare but must not crash; the count is applied as
 * repeated division by 100 in the lone-percent path.
 */
function unwrapPercent(node: AstNode): { operand: AstNode; percentCount: number } {
  let operand = node;
  let percentCount = 0;
  while (isPercentNode(operand)) {
    percentCount += 1;
    operand = operand.operand;
  }
  return { operand, percentCount };
}

/** Result of evaluating the right-hand side of a binary operator. */
interface RightOperand {
  /** The evaluated value with the *normal* (non-percent) reading. */
  value: Decimal;
  /** True when the right-hand side was a `%` expression and the parent op is one of + - * /. */
  isPercent: boolean;
  /** The inner percentage value p (before /100), when isPercent is true. */
  percentInner: Decimal | undefined;
}

function evaluateRightOperand(node: AstNode, options: EvaluateOptions): RightOperand {
  if (isPercentNode(node)) {
    const { operand, percentCount } = unwrapPercent(node);
    const inner = evaluateNode(operand, options);
    // Repeated percents compound via division: `10%%` reads as (10/100)/100.
    let scaled = inner;
    for (let i = 0; i < percentCount; i += 1) {
      scaled = lib.divide(scaled, ONE_HUNDRED);
    }
    return {
      value: scaled,
      isPercent: true,
      percentInner: inner,
    };
  }
  return { value: evaluateNode(node, options), isPercent: false, percentInner: undefined };
}

// --- function dispatch ----------------------------------------------------

function callFunction(name: FunctionName, argument: Decimal, options: EvaluateOptions): Decimal {
  switch (name) {
    case 'sin':
      return lib.sin(argument, options.angleMode);
    case 'cos':
      return lib.cos(argument, options.angleMode);
    case 'tan':
      return lib.tan(argument, options.angleMode);
    case 'log':
      return lib.log10(argument);
    case 'ln':
      return lib.ln(argument);
    case 'sqrt':
      return lib.sqrt(argument);
    case 'sqr':
      return lib.square(argument);
    case 'cube':
      return lib.cube(argument);
    default: {
      // Exhaustiveness guard: unknown FunctionName can never reach here, but a
      // future addition to the union without a case would be caught at compile
      // time and, defensively, at runtime.
      throw new CalcError('MALFORMED_EXPRESSION', `Unknown function “${String(name)}”.`);
    }
  }
}

// --- binary operator dispatch --------------------------------------------

function applyBinary(
  operator: BinaryOperator,
  left: Decimal,
  right: RightOperand,
): Decimal {
  switch (operator) {
    case '+': {
      if (right.isPercent && right.percentInner !== undefined) {
        // a + (a × p/100)
        const delta = lib.divide(lib.multiply(left, right.percentInner), ONE_HUNDRED);
        return lib.add(left, delta);
      }
      return lib.add(left, right.value);
    }
    case '-': {
      if (right.isPercent && right.percentInner !== undefined) {
        // a − (a × p/100)
        const delta = lib.divide(lib.multiply(left, right.percentInner), ONE_HUNDRED);
        return lib.subtract(left, delta);
      }
      return lib.subtract(left, right.value);
    }
    case '*': {
      if (right.isPercent && right.percentInner !== undefined) {
        // a × (p/100)
        const scaled = lib.divide(right.percentInner, ONE_HUNDRED);
        return lib.multiply(left, scaled);
      }
      return lib.multiply(left, right.value);
    }
    case '/': {
      if (right.isPercent && right.percentInner !== undefined) {
        // a ÷ (p/100)
        const scaled = lib.divide(right.percentInner, ONE_HUNDRED);
        return lib.divide(left, scaled);
      }
      return lib.divide(left, right.value);
    }
    case '^': {
      return lib.power(left, right.value);
    }
    default: {
      throw new CalcError('MALFORMED_EXPRESSION');
    }
  }
}

// --- AST walk -------------------------------------------------------------

function evaluateNode(node: AstNode, options: EvaluateOptions): Decimal {
  switch (node.kind) {
    case 'number': {
      try {
        return new Decimal(node.value);
      } catch {
        throw new CalcError('MALFORMED_EXPRESSION');
      }
    }
    case 'constant': {
      if (node.name === 'pi') {
        return lib.pi();
      }
      throw new CalcError('MALFORMED_EXPRESSION');
    }
    case 'unary': {
      const operand = evaluateNode(node.operand, options);
      return operand.isZero() ? ZERO : operand.negated();
    }
    case 'binary': {
      // Resolve `%` on the right-hand side with knowledge of *this* operator.
      const left = evaluateNode(node.left, options);
      const right = evaluateRightOperand(node.right, options);
      return applyBinary(node.operator, left, right);
    }
    case 'call': {
      const argument = evaluateNode(node.argument, options);
      return callFunction(node.name, argument, options);
    }
    case 'percent': {
      // Lone percent (no enclosing binary operator): p/100. Nested percents compound.
      const { operand, percentCount } = unwrapPercent(node);
      let value = evaluateNode(operand, options);
      for (let i = 0; i < percentCount; i += 1) {
        value = lib.divide(value, ONE_HUNDRED);
      }
      return value;
    }
    default: {
      throw new CalcError('MALFORMED_EXPRESSION');
    }
  }
}

/**
 * Evaluate an AST into a `Decimal`.
 *
 * Only ever throws `CalcError`. Any other exception is converted so the
 * no-crash guarantee holds even in the presence of an internal bug.
 */
export function evaluateAst(node: AstNode, options: EvaluateOptions): Decimal {
  try {
    return evaluateNode(node, options);
  } catch (error) {
    throw error instanceof CalcError ? error : new CalcError('MALFORMED_EXPRESSION');
  }
}