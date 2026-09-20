import {existsSync} from 'node:fs';
import path from 'node:path';

/** Where pdf.js finds its fonts, character maps and decoders on this host.
 *
 * This is a plain directory search on purpose. `require.resolve` looks
 * equivalent, but the production bundler rewrites it into a numeric module id,
 * so the lookup threw on every deployed site while passing every local test:
 * text layers and drawing detail silently fell back for every customer PDF.
 *
 * The standalone server runs from `.next/standalone`, the development server
 * and the tests from the repository root; both keep `node_modules/pdfjs-dist`
 * beside them, and the estimator routes trace that package into the build. */
let cached:Record<string,unknown>|undefined;
export function pdfjsAssetOptions():Record<string,unknown>{
  if(cached)return cached;
  const roots=[process.cwd(),path.join(process.cwd(),'.next','standalone'),path.join(process.cwd(),'..','..')];
  const found=roots.map(root=>path.join(root,'node_modules','pdfjs-dist')).find(directory=>existsSync(path.join(directory,'package.json')));
  if(!found){
    // pdf.js still opens and reads most files without these; say so once for the host log.
    console.error('[p5-analysis] pdfjs-dist assets were not found beside the server; reading continues without bundled fonts and character maps.');
    return cached={useSystemFonts:true};
  }
  const base=found.split(path.sep).join('/');
  const options:Record<string,unknown>={useSystemFonts:true};
  if(existsSync(path.join(found,'standard_fonts')))options.standardFontDataUrl=`${base}/standard_fonts/`;
  if(existsSync(path.join(found,'cmaps'))){options.cMapUrl=`${base}/cmaps/`;options.cMapPacked=true;}
  if(existsSync(path.join(found,'wasm')))options.wasmUrl=`${base}/wasm/`;
  return cached=options;
}
