// Rebuild the pinned browser engines without React or a runtime CDN.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = 'static/vendor/libraries-motion/999866f';
for (const [name, entry] of [['orbs', 'orbs.ts'], ['metal', 'metal.ts']]) {
  await build({ absWorkingDir: root, entryPoints: [`${vendor}/src/${entry}`],
    outfile: `${vendor}/${name}.js`, bundle: true, format: 'esm', target: 'es2022',
    minify: true, legalComments: 'eof',
    banner: {js: '// Libraries.dev @ 999866f — see adjacent LICENSE / NOTICE files.'},
  });
}
