/**
 * Tokenizer — stage 1 of the domain pipeline (tokenizer → parser → evaluator).
 *
 * Layer: domain (pure, no React / DOM / storage imports).
 *
 * Translates a raw expression string into a flat token list. All malformed
 * input is rejected here with a typed CalcError('MALFORMED_EXPRESSION') so the
 * parser can assume a well-formed token stream.
 *
 * Accepted input symbols (per the keymap / keypad surface):
 *   - decimal numbers: `12`, `1.5`, `.5`
 *   - binary operators: `+` `-` `*` `/` `^` and the Unicode display forms `×` `÷` `−`
 *   - grouping: `(` `)`
 *   - postfix: `%`
 *   - named functions: `sin cos tan log ln sqrt sqr cube`
 *   - constant: `π` (and the ASCII fallback `pi`)
 *   - whitespace: ignored
 */

import { CalcError } from './errors';

export type TokenType =
  | 'number'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'percent'
  | 'function'
  | 'constant';

export interface Token {
  type: TokenType;
  /** Normalised text: Unicode operators folded to ASCII, `π` folded to `pi`. */
  value: string;
  /** Character index of the first character of this token in the source string. */
  offset: number;
}

/** Function names understood by the engine. Kept here so tokenizer and parser agree. */
export const FUNCTION_NAMES: ReadonlySet<string> = new Set([
  'sin',
  'cos',
  'tan',
  'log',
  'ln',
  'sqrt',
  'sqr',
  'cube',
]);

/** Binary operators in canonical ASCII form. */
export const OPERATORS: ReadonlySet<string> = new Set(['+', '-', '*', '/', '^']);

/** Maps the Unicode operator glyphs shown on the keypad onto ASCII. */
const OPERATOR_ALIASES: Readonly<Record<string, string>> = {
  '×': '*',
  '÷': '/',
  '−': '-', // U+2212 MINUS SIGN
  '–': '-', // U+2013 EN DASH (defensive)
  '—': '-', // U+2014 EM DASH (defensive)
};

/** Maps the constant glyphs onto the ASCII name `pi`. */
const CONSTANT_ALIASES: Readonly<Record<string, string>> = {
  'π': 'pi',
};

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isAsciiLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

/**
 * Tokenize an expression.
 *
 * @throws {CalcError} MALFORMED_EXPRESSION for unknown characters, a misplaced
 * decimal point, a number with more than one decimal point, or an unknown
 * identifier.
 */
export function tokenize(source: string): Token[] {
  if (typeof source !== 'string') {
    throw new CalcError('MALFORMED_EXPRESSION');
  }

  const tokens: Token[] = [];
  const input = source.normalize('NFKC');
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // --- whitespace -------------------------------------------------------
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }

    // --- numbers ----------------------------------------------------------
    if (isDigit(ch) || ch === '.') {
      const start = i;
      let sawDigit = false;
      let sawDot = false;

      while (i < input.length) {
        const c = input[i];
        if (isDigit(c)) {
          sawDigit = true;
          i += 1;
          continue;
        }
        if (c === '.') {
          if (sawDot) {
            throw new CalcError('MALFORMED_EXPRESSION', undefined, i);
          }
          sawDot = true;
          i += 1;
          continue;
        }
        break;
      }

      if (!sawDigit) {
        // A lone "." is not a number.
        throw new CalcError('MALFORMED_EXPRESSION', undefined, start);
      }

      tokens.push({ type: 'number', value: input.slice(start, i), offset: start });
      continue;
    }

    // --- identifiers: functions and the pi constant ------------------------
    if (isAsciiLetter(ch)) {
      const start = i;
      while (i < input.length && isAsciiLetter(input[i])) {
        i += 1;
      }
      const raw = input.slice(start, i);
      const name = raw.toLowerCase();

      if (name === 'pi') {
        tokens.push({ type: 'constant', value: 'pi', offset: start });
        continue;
      }
      if (FUNCTION_NAMES.has(name)) {
        tokens.push({ type: 'function', value: name, offset: start });
        continue;
      }
      throw new CalcError(
        'MALFORMED_EXPRESSION',
        `Unknown name “${raw}”.`,
        start,
      );
    }

    // --- constant glyph ---------------------------------------------------
    if (CONSTANT_ALIASES[ch] !== undefined) {
      tokens.push({ type: 'constant', value: CONSTANT_ALIASES[ch], offset: i });
      i += 1;
      continue;
    }

    // --- operators --------------------------------------------------------
    const alias = OPERATOR_ALIASES[ch];
    if (alias !== undefined) {
      tokens.push({ type: 'operator', value: alias, offset: i });
      i += 1;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^') {
      tokens.push({ type: 'operator', value: ch, offset: i });
      i += 1;
      continue;
    }

    // --- parens / percent -------------------------------------------------
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: '(', offset: i });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ')', offset: i });
      i += 1;
      continue;
    }
    if (ch === '%') {
      tokens.push({ type: 'percent', value: '%', offset: i });
      i += 1;
      continue;
    }

    // --- anything else is a bad token -------------------------------------
    throw new CalcError(
      'MALFORMED_EXPRESSION',
      `Unexpected character “${ch}”.`,
      i,
    );
  }

  return tokens;
}