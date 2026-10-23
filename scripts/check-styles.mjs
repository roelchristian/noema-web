// Deliberately small policy guard: no lint framework or CSS parser dependency.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
const root=new URL('../src/client/',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const strip=text=>text.replace(/\/\*[\s\S]*?\*\//g,'');
const entry=strip(await read('styles.css'));
const imports=[...entry.matchAll(/@import "\.\/styles\/(.+?)";/g)].map(match=>match[1]);
assert.deepEqual(imports,['primitives.css','layout.css','features/editor.css','features/library.css','features/knowledge.css','features/sources.css','features/settings.css','features/dialogs.css','features/menus.css','features/tagging.css','features/calendar.css','semantics.css','controls.css'],'Keep the documented cascade order; update the ownership contract when adding a module');
assert.equal(entry.replace(/@import[^;]+;/g,'').trim(),'','styles.css is only the entrypoint; put rules in their owner');
const files=['styles/tokens.css','styles/fonts.css','search/archive-search.css',...imports.map(path=>'styles/'+path)];
// Explicit budgets preserve existing art/editor colours while stopping growth.
const budgets=JSON.parse(await read('styles/literal-color-budget.json'));
let total=0;
for(const path of files){const css=strip(await read(path));const count=(css.match(/#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/gi)??[]).length;total+=count;
 assert.ok(count<=budgets[path],`${path}: ${count} literal colours exceeds ${budgets[path]}; reuse semantic tokens`);
 assert.doesNotMatch(css,/var\(--danger\s*,/,'Use the defined status token, without a local danger fallback');
 if(path!=='styles/tokens.css')assert.doesNotMatch(css,/--status-(?:danger|warning|success|info)-(?:text|bg|border)\s*:/,'Status palette definitions belong to tokens.css');
 if(['styles/controls.css','styles/semantics.css'].includes(path))assert.equal(count,0,'Shared contracts must reuse tokens');
}
const features=(await readdir(new URL('styles/features/',root))).filter(path=>path.endsWith('.css')).map(path=>'features/'+path);
for(const path of features)assert.ok(imports.includes(path),`Unimported feature module: ${path}`);
console.log(`CSS ownership and semantic contracts passed (${files.length} modules; ${total} colour literals within recorded budgets).`);
