const LATEX_SYMBOLS = [
  ['\\leftrightarrow', '\u2194'], ['\\longrightarrow', '\u2192'],
  ['\\rightarrow', '\u2192'], ['\\Rightarrow', '\u21D2'],
  ['\\leftarrow', '\u2190'], ['\\Leftarrow', '\u21D0'],
  ['\\mapsto', '\u21A6'], ['\\to', '\u2192'], ['\\gets', '\u2190'],
  ['\\uparrow', '\u2191'], ['\\downarrow', '\u2193'],
  ['\\alpha', '\u03B1'], ['\\beta', '\u03B2'], ['\\gamma', '\u03B3'],
  ['\\delta', '\u03B4'], ['\\varepsilon', '\u03B5'], ['\\epsilon', '\u03B5'],
  ['\\zeta', '\u03B6'], ['\\eta', '\u03B7'], ['\\theta', '\u03B8'],
  ['\\vartheta', '\u03D1'], ['\\iota', '\u03B9'], ['\\kappa', '\u03BA'],
  ['\\lambda', '\u03BB'], ['\\mu', '\u03BC'], ['\\nu', '\u03BD'],
  ['\\omicron', '\u03BF'], ['\\xi', '\u03BE'],
  ['\\pi', '\u03C0'], ['\\varpi', '\u03D6'], ['\\rho', '\u03C1'],
  ['\\sigma', '\u03C3'], ['\\varsigma', '\u03C2'],
  ['\\tau', '\u03C4'], ['\\upsilon', '\u03C5'], ['\\phi', '\u03C6'],
  ['\\varphi', '\u03D5'], ['\\chi', '\u03C7'], ['\\psi', '\u03C8'],
  ['\\omega', '\u03C9'],
  ['\\Gamma', '\u0393'], ['\\Delta', '\u0394'], ['\\Theta', '\u0398'],
  ['\\Lambda', '\u039B'], ['\\Xi', '\u039E'], ['\\Pi', '\u03A0'],
  ['\\Sigma', '\u03A3'], ['\\Phi', '\u03A6'], ['\\Psi', '\u03A8'],
  ['\\Omega', '\u03A9'],
  ['\\mathbb{N}', '\u2115'], ['\\mathbb{Z}', '\u2124'],
  ['\\mathbb{Q}', '\u211A'], ['\\mathbb{R}', '\u211D'],
  ['\\mathbb{C}', '\u2102'], ['\\mathbb{P}', '\u2119'],
  ['\\in', '\u2208'], ['\\notin', '\u2209'],
  ['\\subseteq', '\u2286'], ['\\subset', '\u2282'],
  ['\\supseteq', '\u2287'], ['\\supset', '\u2283'],
  ['\\forall', '\u2200'], ['\\exists', '\u2203'], ['\\nexists', '\u2204'],
  ['\\cup', '\u222A'], ['\\cap', '\u2229'], ['\\emptyset', '\u2205'],
  ['\\varnothing', '\u2205'], ['\\wedge', '\u2227'], ['\\vee', '\u2228'],
  ['\\neg', '\u00AC'], ['\\lnot', '\u00AC'],
  ['\\times', '\u00D7'], ['\\div', '\u00F7'], ['\\pm', '\u00B1'],
  ['\\mp', '\u2213'], ['\\cdot', '\u00B7'], ['\\circ', '\u2218'],
  ['\\ast', '\u2217'], ['\\star', '\u22C6'],
  ['\\sum', '\u2211'], ['\\prod', '\u220F'], ['\\int', '\u222B'],
  ['\\iint', '\u222C'], ['\\iiint', '\u222D'], ['\\oint', '\u222E'],
  ['\\partial', '\u2202'], ['\\nabla', '\u2207'],
  ['\\infty', '\u221E'], ['\\prime', '\u2032'],
  ['\\diamond', '\u25C7'], ['\\triangle', '\u25B3'],
  ['\\neq', '\u2260'], ['\\ne', '\u2260'],
  ['\\geq', '\u2265'], ['\\geqslant', '\u2265'],
  ['\\leq', '\u2264'], ['\\leqslant', '\u2264'],
  ['\\gg', '\u226B'], ['\\ll', '\u226A'],
  ['\\sim', '\u223C'], ['\\approx', '\u2248'], ['\\cong', '\u2245'],
  ['\\equiv', '\u2261'], ['\\propto', '\u221D'],
  ['\\parallel', '\u2225'], ['\\perp', '\u22A5'],
  ['\\mid', '\u2223'], ['\\nmid', '\u2224'],
  ['\\angle', '\u2220'], ['\\measuredangle', '\u2221'],
  ['\\square', '\u25A1'], ['\\odot', '\u2299'],
  ['\\cdots', '\u2026'], ['\\ldots', '\u2026'],
  ['\\vdots', '\u22EE'], ['\\ddots', '\u22F1'],
  ['\\therefore', '\u2234'], ['\\because', '\u2235'],
  ['\\langle', '\u27E8'], ['\\rangle', '\u27E9'],
  ['\\lfloor', '\u230A'], ['\\rfloor', '\u230B'],
  ['\\lceil', '\u2308'], ['\\rceil', '\u2309'],
  ['\\{', '{'], ['\\}', '}'],
  ['\\qquad', '    '], ['\\quad', '  '],
  ['\\;', ' '], ['\\,', ' '], ['\\!', ''],
  ['\\ ', ''],
  ['\\sin', 'sin'], ['\\cos', 'cos'], ['\\tan', 'tan'],
  ['\\cot', 'cot'], ['\\sec', 'sec'], ['\\csc', 'csc'],
  ['\\sinh', 'sinh'], ['\\cosh', 'cosh'], ['\\tanh', 'tanh'],
  ['\\log', 'log'], ['\\ln', 'ln'], ['\\lg', 'lg'],
  ['\\lim', 'lim'], ['\\max', 'max'], ['\\min', 'min'],
  ['\\det', 'det'], ['\\arg', 'arg'], ['\\deg', 'deg'],
  ['\\arcsin', 'arcsin'], ['\\arccos', 'arccos'],
  ['\\arctan', 'arctan'], ['\\arctg', 'arctg'],
  ['\\limsup', 'lim sup'], ['\\liminf', 'lim inf'],
  ['\\Pr', 'Pr'], ['\\exp', 'exp'], ['\\var', 'Var'],
  ['\\cov', 'Cov'], ['\\corr', 'Corr'],
  ['\\hbar', '\u210F'], ['\\ell', '\u2113'],
  ['\\Re', '\u211C'], ['\\Im', '\u2111'],
  ['\\top', '\u22A4'], ['\\bot', '\u22A5'],
  ['\\boxempty', '\u25A1'], ['\\blacksquare', '\u25A0'],
];

function extractBraces(text, start) {
  if (start >= text.length || text[start] !== '{') return ['', start];
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return [text.slice(start + 1, i), i + 1]; }
  }
  return [text.slice(start + 1), text.length];
}

function replaceFrac(text) {
  let i = 0, res = [];
  while (i < text.length) {
    if (text.slice(i, i + 5) === '\\frac' && i + 5 < text.length && text[i + 5] === '{') {
      const [arg1, e1] = extractBraces(text, i + 5);
      if (e1 < text.length && text[e1] === '{') {
        const [arg2, e2] = extractBraces(text, e1);
        const a1 = replaceFrac(arg1), a2 = replaceFrac(arg2);
        const needsParen = /[+\-/]/.test(a1) && !a1.startsWith('-');
        res.push(needsParen ? '(' + a1 + ') / (' + a2 + ')' : a1 + ' / ' + a2);
        i = e2;
      } else { res.push(text.slice(i, i + 5)); i += 5; }
    } else { res.push(text[i]); i++; }
  }
  return res.join('');
}

function replaceSqrt(text) {
  let i = 0, res = [];
  while (i < text.length) {
    const m = text.slice(i).match(/^\\sqrt(?:\[([^\]]+)\])?/);
    if (m) {
      const after = i + m[0].length;
      const nth = m[1];
      if (after < text.length && text[after] === '{') {
        const [inner, end] = extractBraces(text, after);
        const inn = replaceSqrt(inner);
        res.push(nth ? nth + '\u221A(' + inn + ')' : '\u221A(' + inn + ')');
        i = end;
      } else { res.push(text[i]); i++; }
    } else { res.push(text[i]); i++; }
  }
  return res.join('');
}

function formatSubscript(content) {
  return '[' + content + ']';
}

export function latexToText(latex) {
  if (!latex) return latex;
  let result = latex.trim();

  if (result.startsWith('$$') && result.endsWith('$$')) result = result.slice(2, -2);
  else if (result.startsWith('$') && result.endsWith('$')) result = result.slice(1, -1);
  else if (result.startsWith('\\(') && result.endsWith('\\)')) result = result.slice(2, -2);
  result = result.trim();

  result = result.replace(/\\limits/g, '').replace(/\\nolimits/g, '');
  result = result.replace(/\\mathrm\{([^}]*)\}/g, '$1');
  result = result.replace(/\\mathbf\{([^}]*)\}/g, '$1');
  result = result.replace(/\\mathbb\{([^}]*)\}/g, '$1');
  result = result.replace(/\\mathcal\{([^}]*)\}/g, '$1');
  result = result.replace(/\\text\{([^}]*)\}/g, (_, c) => c.replace(/_/g, '\x00UNDERSCORE\x00'));

  result = replaceFrac(result);
  result = replaceSqrt(result);

  for (const [cmd, sym] of LATEX_SYMBOLS) {
    while (result.includes(cmd)) result = result.replace(cmd, sym);
  }

  result = result.replace(/\{([^}]*)\}/g, (_, c) => formatSubscript(c));
  result = result.replace(/_([a-zA-Z0-9])/g, (_, c) => formatSubscript(c));

  result = result.replace(/\^\{([^}]*)\}/g, (_, c) => {
    return '^(' + c + ')';
  });
  result = result.replace(/\^([a-zA-Z0-9-])/g, '^$1');

  result = result.replace(/\x00UNDERSCORE\x00/g, '_');
  result = result.replace(/\\circ/g, '\u00B0');
  result = result.replace(/\\[a-zA-Z]+/g, '');

  result = result.replace(/\s+/g, ' ').trim();
  result = result.replace(/\(\)/g, '');

  return result;
}

export function convertLatexInText(text) {
  return text.replace(/\$\$([\s\S]*?)\$\$|\$([^$\n]*?)\$/g, (_, block, inline) => {
    const raw = block || inline || '';
    if (!raw.trim()) return _;
    // Only convert if content looks like LaTeX (contains \, ^, _, {, or })
    if (!/[\\^{}_]/.test(raw)) return _;
    try { return latexToText(raw); } catch { return _; }
  });
}
