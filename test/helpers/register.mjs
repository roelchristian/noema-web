import {register} from 'node:module';
// Component behavior runs in JSDOM; actual styles are exercised by browser checks.
register('./styles-loader.mjs',import.meta.url);
