// Compiles design/tokens.json into app/tokens.css.
// The design system is the source of truth; re-run after pulling a new tokens.json.
import { readFileSync, writeFileSync } from 'node:fs';

const t = JSON.parse(readFileSync(new URL('../design/tokens.json', import.meta.url)));
const themes = t.color.themes.map((x) => x.id);
const [first, ...rest] = themes;

const resolve = (v, theme) =>
  typeof v === 'string' ? v : v[theme] ?? v[first];
const cssVal = (s) =>
  /^\{.+\}$/.test(s) ? `var(--${s.slice(1, -1)})` : s;

const themeBlock = (theme) =>
  [...t.color.tokens, ...(t.shadow?.tokens ?? [])]
    .map((tok) => `  --${tok.name}: ${cssVal(resolve(tok.value, theme))};`)
    .join('\n');

const flat = (fam) =>
  (t[fam]?.tokens ?? []).map((tok) => `  --${tok.name}: ${tok.value};`).join('\n');

const families = Object.entries(t.type.families)
  .map(([k, v]) => `  --font-${k}: ${v};`)
  .join('\n');

const styles = t.type.groups
  .flatMap((g) =>
    g.styles.map((s) => {
      const lines = [
        `  font-family: var(--font-${s.family ?? g.family});`,
        `  font-size: ${s.fontSize};`,
      ];
      if (s.lineHeight) lines.push(`  line-height: ${s.lineHeight};`);
      if (s.fontWeight) lines.push(`  font-weight: ${s.fontWeight};`);
      if (s.letterSpacing) lines.push(`  letter-spacing: ${s.letterSpacing};`);
      return `.${s.name} {\n${lines.join('\n')}\n}`;
    })
  )
  .join('\n\n');

const out = `/* GENERATED from design/tokens.json by scripts/tokens-to-css.mjs — do not edit by hand. */

:root,
[data-theme='${first}'] {
${themeBlock(first)}
}

${rest.map((th) => `[data-theme='${th}'] {\n${themeBlock(th)}\n}`).join('\n\n')}

:root {
${flat('spacing')}
${flat('radius')}
${families}
}

${styles}
`;

writeFileSync(new URL('../app/tokens.css', import.meta.url), out);
console.log('app/tokens.css written');
