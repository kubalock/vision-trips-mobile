// Extracts the static `icon` data for the Lucide components named in lucide-icon.ts.
import { readFileSync, writeFileSync } from 'node:fs';
const [, , iconModule, lucideBundle, outFile] = process.argv;
const source = readFileSync(iconModule, 'utf8');
const names = [...new Set([...source.matchAll(/\bIcons\.([A-Za-z0-9]+)\b/g)].map((m) => `Lucide${m[1]}`))];
const bundle = readFileSync(lucideBundle, 'utf8');
const entries = names.map((name) => {
  const alias = bundle.match(new RegExp(`const ${name} = (Lucide[A-Za-z0-9]+);`))?.[1];
  const className = bundle.includes(`var ${name} = class ${name} extends`) ? name : alias ?? name;
  const start = bundle.indexOf(`var ${className} = class ${className} extends LucideIconBase {`);
  if (start < 0) throw new Error(`missing ${name}`);
  const iconStart = bundle.indexOf('static icon = ', start) + 'static icon = '.length;
  let depth = 0, i = iconStart;
  for (; i < bundle.length; i++) { if (bundle[i] === '{') depth++; else if (bundle[i] === '}') { depth--; if (depth === 0) break; } }
  const value = Function(`return (${bundle.slice(iconStart, i + 1)})`)();
  return `export const ${name.replace(/^Lucide/, '')}: LucideIconData = ${JSON.stringify(value)};`;
});
writeFileSync(outFile, `// Generated from @lucide/angular (ISC licence, https://lucide.dev). Only the icons the app uses.
// Icon shape data only: importing the Lucide icon components pulls in a compiled template per icon (~3 kB each).
// To add an icon, reference it as Icons.<LucideName without the Lucide prefix> in lucide-icon.ts, then run: npm run icons
import type { LucideIconData } from '@lucide/angular';

${entries.join('\n')}
`);
console.log(`${entries.length} icons`);
