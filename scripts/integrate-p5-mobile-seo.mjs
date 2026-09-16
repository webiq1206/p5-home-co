import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import sharp from 'sharp';
const read=p=>fs.readFileSync(p,'utf8');const write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);};
const brand=JSON.parse(read('lib/p5/brand.ts').match(/=\s*(\{[\s\S]*\})\s*as const/)[1]);
const changed=[];
function edit(p,fn){const s=read(p),next=fn(s);if(next!==s){write(p,next);changed.push(p);}}
// Keep the VisualViewport reference in effect scope for both measure and cleanup.
edit('hooks/use-mobile-action-visibility.ts',s=>s.includes('const viewport=window.visualViewport;\n    let frame')?s:s.replace('    let frame=0,hero:Element|null=null;','    const viewport=window.visualViewport;\n    let frame=0,hero:Element|null=null;'));
const nav=brand.id==='p5'?'components/MobileActionBar.tsx':'components/Navigation.tsx';
edit(nav,s=>{
 if(!s.includes("from '@/hooks/use-mobile-action-visibility'"))s=s.replace(/(import[^\n]*usePathname[^\n]*\n)/,'$1import {useMobileActionVisibility} from \'@/hooks/use-mobile-action-visibility\';\n');
 if(!s.includes('const mobileActionsVisible=')){
  const marker=brand.id==='p5'?'  const path=usePathname();':'  const pathname = usePathname();';if(!s.includes(marker))throw Error(`Navigation route hook missing in ${nav}`);
  s=s.replace(marker,marker+`\n  const mobileActionsVisible=useMobileActionVisibility(${brand.id==='p5'?'path':'pathname'});`);
 }
 if(brand.id==='p5'){
  s=s.replace('data-mobile-nav-bar="" aria-label="Quick contact"','data-mobile-nav-bar="" data-mobile-actions-version="2026-09-16.2" style={{display:mobileActionsVisible?undefined:\'none\'}} aria-label="Quick contact"');
  s=s.replace('</svg></a>','</svg><span>Call</span></a>');
 }else{
  s=s.replace('data-mobile-nav-bar=""','data-mobile-nav-bar=""\n        data-mobile-actions-version="2026-09-16.2"\n        style={{display:mobileActionsVisible?undefined:\'none\'}}');
  const blockStart=s.indexOf('      <div\n        data-mobile-nav-bar='),blockEnd=s.indexOf('\n    </>',blockStart);
  if(blockStart<0||blockEnd<0)throw Error('Mobile action bar bounds changed');
  let block=s.slice(blockStart,blockEnd);
  block=block.replace('w-14 shrink-0 items-center justify-center','w-[76px] shrink-0 flex-col gap-1 items-center justify-center');
  block=block.replace(/(<Phone[^>]*\/>)(\s*<\/a>)/,'$1<span className="text-xs font-medium">Call</span>$2');
  s=s.slice(0,blockStart)+block+s.slice(blockEnd);
  // Keep wide wordmarks inside narrow mobile headers without squeezing the menu.
  s=s.replaceAll('className="h-[26px] w-auto"','className="h-[26px] w-auto max-w-[calc(100vw-92px)] object-contain object-left"');
  if(brand.id==='cabinet'){
   const a=s.indexOf('  // Hide the sticky bar until the hero scrolls out of view.');const b=s.indexOf('  // Hide the sticky bar while an on-page final CTA',a);
   if(a>=0&&b>a)s=s.slice(0,a)+'  const pastHero=mobileActionsVisible;\n\n'+s.slice(b);
  }
 }
 return s;
});
if(brand.id==='p5')edit('app/globals.css',s=>s.includes('/* Readable secondary mobile call action. */')?s:s+'\n/* Readable secondary mobile call action. */\n.p5-mobile-call{min-width:76px;flex-direction:column;gap:4px}.p5-mobile-call span{font-size:12px;font-weight:600;line-height:1.2}\n');
// Remove the duplicate PDF card introduced beside the existing PDF attachment.
edit('components/P5Estimator.tsx',s=>s.replace(/<div className=\{styles\.card\} aria-label="Estimate PDF attachment">[\s\S]*?<\/button><\/div><\/div>/,''));
// Generate previews from the existing approved artwork, never invent a replacement logo.
const slug=brand.id==='p5'?'p5-home-co':`boise-${brand.id}-co`;
const sealCandidates=brand.id==='p5'?['public/brands/p5-home-co-icon-dark.svg','public/android-chrome-512x512.png']:[`public/brand/svg/seal/any/${slug}-seal-on-charcoal-accent.svg`,`public/brand/svg/seal/dark/${slug}-seal-bone-accent.svg`];
const iconCandidates=brand.id==='p5'?['public/android-chrome-512x512.png','public/brands/p5-home-co-icon-dark.svg']:[`public/brand/svg/icon/${slug}-icon-accent.svg`,`public/brand/png/icon/${slug}-icon-accent-512px.png`];
const seal=sealCandidates.find(fs.existsSync),icon=iconCandidates.find(fs.existsSync);if(!seal||!icon)throw Error(`Approved seal or icon unavailable for ${brand.id}`);
fs.mkdirSync('public/brand',{recursive:true});
const background=brand.id==='p5'?'#FBFAF6':'#1C1F1E';
const emblem=await sharp(seal).resize(470,470,{fit:'contain',background}).png().toBuffer();
await sharp({create:{width:1200,height:630,channels:4,background}}).composite([{input:emblem,left:365,top:80}]).png().toFile('public/brand/page-preview.png');
for(const size of [96,180])await sharp(icon).resize(size,size,{fit:'contain',background:brand.id==='p5'?'#FBFAF6':'#1C1F1E'}).png().toFile(`public/brand/search-icon-${size}.png`);
// Wrap only top-level metadata exports and generateMetadata returns. Never alter
// rendering functions, structured-data payloads, canonical policy or noindex.
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const wrapped=[];
for(const file of files('app').filter(p=>/(?:^|\/)(?:page|layout)\.tsx?$/.test(p)&&!/(?:^|\/)(?:api|admin|portal|login)(?:\/|$)/.test(p))){
 let source=read(file);if(source.includes('withBrandPageMetadata'))continue;
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const spans=[];
 const hint=/\/layout\./.test(file)?'__layout__':'/'+path.dirname(file).replace(/^app\/?/,'').split('/').filter(v=>v&&!/^\(.*\)$/.test(v)).join('/');
 const add=(expr,async=false)=>{if(expr&&!(ts.isObjectLiteralExpression(expr)&&expr.properties.length===0))spans.push({start:expr.getStart(ast),end:expr.getEnd(),async});};
 const exported=node=>node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword);
 const returnSpans=(fn)=>{const async=fn.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)||false;const visit=node=>{if(node!==fn&&ts.isFunctionLike(node))return;if(ts.isReturnStatement(node))add(node.expression,async);ts.forEachChild(node,visit);};if(fn.body){if(ts.isBlock(fn.body))visit(fn.body);else add(fn.body,async);}};
 for(const stmt of ast.statements){
  if(ts.isVariableStatement(stmt)&&exported(stmt))for(const declaration of stmt.declarationList.declarations){const name=declaration.name.getText(ast);if(name==='metadata')add(declaration.initializer);if(name==='generateMetadata'&&declaration.initializer&&ts.isFunctionLike(declaration.initializer))returnSpans(declaration.initializer);}
  if(ts.isFunctionDeclaration(stmt)&&exported(stmt)&&stmt.name?.text==='generateMetadata')returnSpans(stmt);
 }
 if(!spans.length)continue;
 for(const span of spans.sort((a,b)=>b.start-a.start)){const value=source.slice(span.start,span.end);source=source.slice(0,span.start)+`withBrandPageMetadata(${span.async?'await ':''}(${value}), ${JSON.stringify(hint)})`+source.slice(span.end);}
 source=`import {withBrandPageMetadata} from '@/lib/brand-page-metadata';\n`+source;
 write(file,source);wrapped.push(file);
}
fs.mkdirSync('p5-mobile-seo-verification',{recursive:true});
write('p5-mobile-seo-verification/implementation.json',JSON.stringify({brand:brand.id,changed,wrapped,seal,icon,generatedImages:['public/brand/page-preview.png','public/brand/search-icon-96.png','public/brand/search-icon-180.png']},null,2));
console.log(JSON.stringify({brand:brand.id,wrappedMetadataExports:wrapped.length,changed,seal,icon}));
