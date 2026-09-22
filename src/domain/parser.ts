/**
 * Parser — stage 2 of the domain pipeline (tokenizer → parser → evaluator).
 *
 * Layer: domain (pure, no React / DOM / storage imports).
 *
 * Recursive-descent parser producing an AST. Grammar / precedence, loosest
 * binding first:
 *
 *   expression  := additive
 *   additive    := multiplicative (('+' | '-') multiplicative)*
 *   multiplicative := unary (('*' | '/') unary)*
 *   unary       := '-' unary | power
 *   power       := postfix ('^' unary)?          // right-associative
 *   postfix     := primary '%'*                  // percent binds tightest of all
 *   primary     := number
 *                | constant
 *                | function '(' expression ')'
 *                | '(' expression ')'
 *
 * Notes:
 *  - `^` is right-associative: `2^3^2` parses as `2^(3^2)` → 512.
 *  - Unary minus is non-associative with `^` on its right, so `-2^2` is
 *    `-(2^2)` → -4.
 *  - `%` is handled at AST level: the node carries no operator context. The
 *    evaluator resolves the five contextual percentage rules by walking the
 *    tree, because the rule depends on the parent binary operator.
 */

import { CalcError } from './errors';
import { FUNCTION_NAMES, tokenize, type Token } from './tokenizer';

export type BinaryOperator = '+' | '-' | '*' | '/' | '^';

export type FunctionName =
  | 'sin'
  | 'cos'
  | 'tan'
  | 'log'
  | 'ln'
  | 'sqrt'
  | 'sqr'
  | 'cube';

export type AstNode =
  | { kind: 'number'; value: string }
  | { kind: 'constant'; name: 'pi' }
  | { kind: 'unary'; operator: '-'; operand: AstNode }
  | { kind: 'binary'; operator: BinaryOperator; left: AstNode; right: AstNode }
  | { kind: 'call'; name: FunctionName; argument: AstNode }
  | { kind: 'percent'; operand: AstNode };

class Parser {
  private readonly tokens: Token[];
  private position = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  public parseProgram(): AstNode {
    if (this.tokens.length === 0) {
      throw new CalcError('MALFORMED_EXPRESSION');
    }

    const node = this.parseAdditive();

    if (!this.isAtEnd()) {
      const token = this.peek();
      throw new CalcError(
        'MALFORMED_EXPRESSION',
        token.type === 'rparen'
          ? 'Unbalanced parenthesis.'
          : `Unexpected “${token.value}”.`,
        token.offset,
      );
    }

    return node;
  }

  // --- grammar rules ------------------------------------------------------

  private parseAdditive(): AstNode {
    let left = this.parseMultiplicative();

    while (this.matchOperator('+', '-')) {
      const operator = this.previousOperator();
      const right = this.parseMultiplicative();
      left = { kind: 'binary', operator: operator as BinaryOperator, left, right };
    }

    return left;
  }

  private parseMultiplicative(): AstNode {
    let left = this.parseUnary();

    while (this.matchOperator('*', '/')) {
      const operator = this.previousOperator();
      const right = this.parseUnary();
      left = { kind: 'binary', operator: operator as BinaryOperator, left, right };
    }

    return left;
  }

  private parseUnary(): AstNode {
    if (this.matchOperator('-')) {
      const operand = this.parseUnary();
      return { kind: 'unary', operator: '-', operand };
    }
    // A leading unary plus is accepted and ignored.
    if (this.matchOperator('+')) {
      return this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): AstNode {
    const base = this.parsePostfix();

    if (this.matchOperator('^')) {
      // Right-associative: recurse into parseUnary so `2^-3` and `2^3^2`
      // both behave correctly.
      const exponent = this.parseUnary();
      return { kind: 'binary', operator: '^', left: base, right: exponent };
    }

    return base;
  }

  private parsePostfix(): AstNode {
    let node = this.parsePrimary();

    while (this.matchPercent()) {
      node = { kind: 'percent', operand: node };
    }

    return node;
  }

  private parsePrimary(): AstNode {
    const token = this.peek();

    if (token === undefined) {
      throw new CalcError('MALFORMED_EXPRESSION');
    }

    if (token.type === 'number') {
      this.advance();
      return { kind: 'number', value: token.value };
    }

    if (token.type === 'constant') {
      if (token.value !== 'pi') {
        throw new CalcError('MALFORMED_EXPRESSION', undefined, token.offset);
      }
      this.advance();
      return { kind: 'constant', name: 'pi' };
    }

    if (token.type === 'function') {
      if (!FUNCTION_NAMES.has(token.value)) {
        throw new CalcError('MALFORMED_EXPRESSION', undefined, token.offset);
      }
      this.advance();

      const open = this.peek();
      if (open === undefined || open.type !== 'lparen') {
        throw new CalcError(
          'MALFORMED_EXPRESSION',
          `“${token.value}” needs a parenthesised argument.`,
          open?.offset ?? token.offset,
        );
      }
      this.advance(); // consume '('

      const argument = this.parseAdditive();

      const close = this.peek();
      if (close === undefined || close.type !== 'rparen') {
        throw new CalcError('MALFORMED_EXPRESSION', 'Unbalanced parenthesis.', close?.offset ?? token.offset);
      }
      this.advance(); // consume ')'

      return { kind: 'call', name: token.value as FunctionName, argument };
    }

    if (token.type === 'lparen') {
      this.advance();
      const inner = this.parseAdditive();

      const close = this.peek();
      if (close === undefined || close.type !== 'rparen') {
        throw new CalcError('MALFORMED_EXPRESSION', 'Unbalanced parenthesis.', close?.offset ?? token.offset);
      }
      this.advance(); // consume ')'

      return inner;
    }

    if (token.type === 'rparen') {
      throw new CalcError('MALFORMED_EXPRESSION', 'Unbalanced parenthesis.', token.offset);
    }

    // operator / percent where a value was expected (e.g. trailing `+`, `*3+`)
    throw new CalcError('MALFORMED_EXPRESSION', undefined, token.offset);
  }

  // --- token cursor helpers -----------------------------------------------

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private advance(): void {
    this.position += 1;
  }

  private isAtEnd(): boolean {
    return this.position >= this.tokens.length;
  }

  private matchOperator(...candidates: string[]): boolean {
    const token = this.peek();
    if (token !== undefined && token.type === 'operator' && candidates.includes(token.value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private previousOperator(): string {
    const token = this.tokens[this.position - 1];
    return token.value;
  }

  private matchPercent(): boolean {
    const token = this.peek();
    if (token !== undefined && token.type === 'percent') {
      this.advance();
      return true;
    }
    return false;
  }
}

/**
 * Parse an expression string into an AST.
 *
 * @throws {CalcError} MALFORMED_EXPRESSION for any syntactically invalid input.
 */
export function parse(source: string): AstNode {
  const tokens = tokenize(source);
  return new Parser(tokens).parseProgram();
}