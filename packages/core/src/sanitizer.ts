/**
 * Input sanitizer — protection contre prompt injection, zero-width, RTL,
 * homoglyphes, caracteres de controle.
 *
 * Source : adapté du sanitizer de CloddsBot (une de ses bonnes parties), avec :
 *  - perf ameliorée : Set pour les homoglyphes au lieu de Array.includes (O(1))
 *  - API typée strictement (zéro any)
 *  - position tracking pour chaque menace
 */

export type ThreatType =
  | 'zero_width'
  | 'rtl_override'
  | 'homoglyph'
  | 'prompt_injection'
  | 'control_char';

export interface SanitizeThreat {
  type: ThreatType;
  description: string;
  position: number;
}

export interface SanitizeResult {
  clean: string;
  threats: SanitizeThreat[];
  modified: boolean;
}

const ZERO_WIDTH: Readonly<Record<number, string>> = {
  0x200b: 'zero-width space',
  0x200c: 'zero-width non-joiner',
  0x200d: 'zero-width joiner',
  0x2060: 'word joiner',
  0xfeff: 'BOM / zero-width no-break space',
  0x00ad: 'soft hyphen',
  0x034f: 'combining grapheme joiner',
  0x061c: 'Arabic letter mark',
  0x180e: 'Mongolian vowel separator',
};

const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\u2060\uFEFF\u00AD\u034F\u061C\u180E]/g;

const RTL_RE = /[\u202A-\u202E\u2066-\u2069]/g;

const HOMOGLYPHS: Readonly<Record<string, string>> = {
  '\u0410': 'A', '\u0430': 'a',
  '\u0412': 'B', '\u0432': 'b',
  '\u0421': 'C', '\u0441': 'c',
  '\u0415': 'E', '\u0435': 'e',
  '\u041D': 'H', '\u043D': 'h',
  '\u041A': 'K', '\u043A': 'k',
  '\u041C': 'M', '\u043C': 'm',
  '\u041E': 'O', '\u043E': 'o',
  '\u0420': 'P', '\u0440': 'p',
  '\u0422': 'T', '\u0442': 't',
  '\u0425': 'X', '\u0445': 'x',
  '\u0423': 'Y', '\u0443': 'y',
  '\u0417': '3',
  '\u0406': 'I', '\u0456': 'i',
  '\u0408': 'J',
  '\u0405': 'S', '\u0455': 's',
  '\u03bf': 'o',
  '\u03b1': 'a',
};

// Set pour lookup O(1).
const HOMOGLYPH_SET: ReadonlySet<string> = new Set(Object.keys(HOMOGLYPHS));

const PROMPT_INJECTION_PATTERNS: ReadonlyArray<{ re: RegExp; desc: string }> = [
  { re: /ignore\s+(all\s+)?previous\s+(instructions?|prompts?|rules?)/i, desc: 'instruction override' },
  { re: /\[INST\]/i, desc: '[INST] tag injection' },
  { re: /<\|im_start\|>/i, desc: 'ChatML tag injection' },
  { re: /system\s*:\s*(you are|override|new instructions)/i, desc: 'system role override' },
  { re: /DAN\s+(mode|jailbreak|prompt)/i, desc: 'DAN mode attempt' },
  { re: /do\s+anything\s+now/i, desc: 'DAN activation phrase' },
  { re: /forget\s+(everything|all|your)\s+(you|rules|instructions)/i, desc: 'memory wipe attempt' },
  { re: /pretend\s+(you\s+are|to\s+be)\s+(a\s+)?(different|new|unrestricted)/i, desc: 'persona swap' },
  { re: /\bact\s+as\s+(an?\s+)?(unrestricted|uncensored|evil|malicious)/i, desc: 'uncensored mode' },
  { re: /bypass\s+(safety|content|filter|restriction)/i, desc: 'filter bypass' },
  { re: /developer\s+mode\s+(enabled|activated|on)/i, desc: 'developer mode injection' },
  { re: /\bsudo\s+(mode|prompt|override)\b/i, desc: 'sudo mode injection' },
  { re: /you\s+must\s+(obey|follow|comply|listen)/i, desc: 'coercion pattern' },
  { re: /\bsimulate\s+(a\s+)?(jailbreak|unrestricted|evil)/i, desc: 'jailbreak simulation' },
  { re: /reveal\s+(your\s+)?(system|hidden|secret)\s+(prompt|instructions)/i, desc: 'prompt leak attempt' },
];

const CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function sanitizeInput(input: string): SanitizeResult {
  const threats: SanitizeThreat[] = [];
  let clean = input;

  const zeroWidthRe = new RegExp(ZERO_WIDTH_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = zeroWidthRe.exec(input)) !== null) {
    const code = m[0].codePointAt(0)!;
    threats.push({
      type: 'zero_width',
      description: `Caractere cache: ${ZERO_WIDTH[code] ?? `U+${code.toString(16).toUpperCase()}`}`,
      position: m.index,
    });
  }
  clean = clean.replace(ZERO_WIDTH_RE, '');

  const rtlRe = new RegExp(RTL_RE.source, 'g');
  while ((m = rtlRe.exec(input)) !== null) {
    const code = m[0].codePointAt(0)!;
    threats.push({
      type: 'rtl_override',
      description: `RTL override: U+${code.toString(16).toUpperCase()}`,
      position: m.index,
    });
  }
  clean = clean.replace(RTL_RE, '');

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (HOMOGLYPH_SET.has(ch)) {
      threats.push({
        type: 'homoglyph',
        description: `Confusable: "${ch}" ressemble a "${HOMOGLYPHS[ch]!}" (U+${ch.codePointAt(0)!.toString(16).toUpperCase()})`,
        position: i,
      });
    }
  }

  for (const pat of PROMPT_INJECTION_PATTERNS) {
    const match = pat.re.exec(input);
    if (match) {
      threats.push({ type: 'prompt_injection', description: pat.desc, position: match.index });
    }
  }

  const ctrlRe = new RegExp(CONTROL_RE.source, 'g');
  while ((m = ctrlRe.exec(input)) !== null) {
    threats.push({
      type: 'control_char',
      description: `Caractere de controle: 0x${m[0].charCodeAt(0).toString(16).padStart(2, '0')}`,
      position: m.index,
    });
  }
  clean = clean.replace(CONTROL_RE, '');

  return { clean, threats, modified: clean !== input };
}

export function hasThreats(input: string): boolean {
  return sanitizeInput(input).threats.length > 0;
}
