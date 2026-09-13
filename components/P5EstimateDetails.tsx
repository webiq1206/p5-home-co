import {categoryBreakdown,estimateSections,money,scopeBullets,type EstimateSection} from '../lib/p5/presentation';
import styles from './P5Estimator.module.css';

type Kind='included'|'excluded'|'allowance'|'assumption'|'';
const KIND_BY_TITLE:Record<string,Kind>={'Exclusions':'excluded','Excluded work':'excluded','Allowances':'allowance','Included preliminary allowances':'allowance','Allowances & selections':'allowance','Planning assumptions':'assumption','Items to verify before a firm proposal':'assumption','Factors that may change the range':'assumption','Scope questions requiring clarification':'assumption','Requested estimating scope':'included','Pricing basis':'assumption','Document review coverage':'assumption','Separate building prices':'included'};
const KIND_LABEL:Record<Kind,string>={included:'Included',excluded:'Excluded',allowance:'Allowance',assumption:'To confirm','':''};
const STATUS_LABEL:Record<string,string>={'verified-cost':'Verified cost','owner-planning-rate':'Planning rate','estimated-allowance':'Allowance'};
const range=(low?:number,high?:number)=>low!==undefined&&high!==undefined?`${money(low)} to ${money(high)}`:'';
const unitPrice=(n:number)=>n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});

function Section({section,open,kind}:{section:EstimateSection;open?:boolean;kind:Kind}){
 const count=(section.bullets?.length||0)+(section.rows?.length||0);
 return <details className={styles.accordion} open={open}>
  <summary><span className={styles.accordionTitle}>{section.title}</span>{kind&&<span className={styles.badge} data-kind={kind}>{KIND_LABEL[kind]}</span>}{count>0&&<span className={styles.accordionMeta}>{count} {count===1?'item':'items'}</span>}</summary>
  <div className={styles.accordionBody}>
   {section.text&&<p className={styles.hint} style={{marginBottom:10}}>{section.text}</p>}
   {Boolean(section.bullets?.length)&&<ul className={styles.bullets}>{section.bullets!.map((item,i)=><li key={i}>{item}</li>)}</ul>}
   {Boolean(section.rows?.length)&&<dl className={styles.rows}>{section.rows!.map(([label,value],i)=><div key={i}><dt>{label}</dt><dd>{scopeBullets(value).length>1?<ul className={styles.bullets}>{scopeBullets(value).map((text,j)=><li key={j}>{text}</li>)}</ul>:value}</dd></div>)}</dl>}
  </div>
 </details>;
}

/**
 * Customer-facing estimate detail. Priced categories are accordions with a
 * subtotal and itemized lines; exclusions, allowances and assumptions are
 * labeled so a reader can tell what is in the price and what is not.
 */
export default function P5EstimateDetails({result,openFirst=true}:{result:any;openFirst?:boolean}){
 const sections=estimateSections(result);
 const breakdown=categoryBreakdown(result);
 const categoryTitles=new Set(breakdown.map(b=>b.category));
 const priced=Boolean(result?.range);
 const glance=sections.find(s=>s.title==='Project at a glance');
 const intro=sections.find(s=>s.title==='Included scope by category'||s.title==='Requested scope by category');
 const remaining=sections.filter(s=>s!==glance&&s!==intro&&!categoryTitles.has(s.title));
 const leading=remaining.filter(s=>['Requested estimating scope','Project brief'].includes(s.title));
 const trailing=remaining.filter(s=>!leading.includes(s));
 return <div className={styles.result}>
  {glance&&<Section section={glance} open={openFirst} kind=""/>}
  {leading.map((s,i)=><Section key={s.title+i} section={s} kind={KIND_BY_TITLE[s.title]||''}/>)}
  {breakdown.length>0&&<>
   <p className={styles.sectionLabel}>{priced?'What is included, by category':'Requested work, by category'}</p>
   {intro?.text&&<p className={styles.hint} style={{marginBottom:10}}>{intro.text}</p>}
   {breakdown.map(group=><details key={group.category} className={styles.accordion}>
    <summary><span className={styles.accordionTitle}>{group.category}</span><span className={styles.badge} data-kind="included">Included</span>{priced&&group.low!==undefined&&<span className={styles.accordionMeta}>{range(group.low,group.high)}</span>}{!priced&&<span className={styles.accordionMeta}>{group.tasks.length} {group.tasks.length===1?'item':'items'}</span>}</summary>
    <div className={styles.accordionBody}>
     {group.tasks.length>0&&<ul className={styles.bullets} style={{marginBottom:group.items.length?12:0}}>{group.tasks.map((task,i)=><li key={i}>{task}</li>)}</ul>}
     {group.items.length>0&&<ul className={styles.lineItems}>{group.items.map(item=><li key={item.id} className={styles.lineItem}>
      <strong>{item.label}</strong>
      <span className={styles.qty}>{item.quantity.toLocaleString('en-US')} {item.unit}{item.quantityRange?` (modeled: ${item.quantityRange.low.toLocaleString('en-US')} to ${item.quantityRange.high.toLocaleString('en-US')} ${item.unit} to verify)`:''}{item.quantity!==1||item.quantityRange?` · ${unitPrice(item.unitLow)} to ${unitPrice(item.unitHigh)} per ${item.unit}`:''}</span>
      <span className={styles.total}>{range(item.low,item.high)}</span>
      <span className={styles.note}><span className={styles.badge} data-kind={item.status==='estimated-allowance'?'allowance':item.status==='owner-planning-rate'?'assumption':'included'}>{STATUS_LABEL[item.status]||item.status}</span>{item.verification?` ${item.verification}`:''}{item.rateLocation?` Cost location: ${item.rateLocation}.`:''}{item.rateDate?` Researched ${item.rateDate}.`:''}</span>
     </li>)}</ul>}
     {priced&&group.low!==undefined&&group.items.length>1&&<div className={styles.subtotal}><span>{group.category} subtotal</span><span>{range(group.low,group.high)}</span></div>}
    </div>
   </details>)}
  </>}
  {trailing.length>0&&<p className={styles.sectionLabel}>Exclusions, allowances and assumptions</p>}
  {trailing.map((s,i)=><Section key={s.title+i} section={s} kind={KIND_BY_TITLE[s.title]||''}/>)}
 </div>;
}
