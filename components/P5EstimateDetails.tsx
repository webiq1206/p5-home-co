'use client';
import {categoryBreakdown,estimateSections,groupSections,scopeBullets,type EstimateSection,type SectionKind} from '../lib/p5/presentation';
import styles from './P5Estimator.module.css';

type Kind='included'|'excluded'|'allowance'|'assumption'|'';
const badgeKind=(kind?:SectionKind):Kind=>kind==='included'||kind==='category'?'included':kind==='excluded'?'excluded':kind==='allowance'?'allowance':kind==='assumption'?'assumption':'';
const STATUS_LABEL:Record<string,string>={'verified-cost':'Included','owner-planning-rate':'Planning price','estimated-allowance':'Budget allowance'};

function Section({section,open}:{section:EstimateSection;open?:boolean}){
 const kind=badgeKind(section.kind);
 const count=(section.bullets?.length||0)+(section.rows?.length||0);
 return <details className={styles.accordion} open={open} data-kind={kind||undefined}>
  <summary><span className={styles.accordionTitle}>{section.title}</span>{count>0&&<span className={styles.accordionMeta}>{count} {count===1?'item':'items'}</span>}</summary>
  <div className={styles.accordionBody}>
   {section.text&&<p className={styles.hint} style={{marginBottom:count?10:0}}>{section.text}</p>}
   {Boolean(section.bullets?.length)&&<ul className={styles.bullets}>{section.bullets!.map((item,i)=><li key={i}>{item}</li>)}</ul>}
   {Boolean(section.rows?.length)&&<dl className={styles.rows}>{section.rows!.map(([label,value],i)=><div key={i}><dt>{label}</dt><dd>{scopeBullets(value).length>1?<ul className={styles.bullets}>{scopeBullets(value).map((text,j)=><li key={j}>{text}</li>)}</ul>:value}</dd></div>)}</dl>}
  </div>
 </details>;
}

/**
 * Customer-facing estimate detail, in reading order: what the project is,
 * what is included (by category, with every line of work and its quantity),
 * what is excluded, what is carried as an allowance, and what still needs
 * confirming. The only price is the project total shown above this component:
 * no category, line or unit carries one (owner decision, 16 November 2026).
 * Each group has its own labeled heading so excluded work never reads as work
 * covered by the estimate. Detail groups start collapsed so the result stays
 * readable on a phone while every item remains one tap away.
 */
export default function P5EstimateDetails({result,openFirst=false,showGlance=true}:{result:any;openFirst?:boolean;showGlance?:boolean}){
 const sections=estimateSections(result);
 const grouped=groupSections(sections);
 const breakdown=categoryBreakdown(result);
 const priced=Boolean(result?.range);
 const hasCategories=breakdown.length>0;
 const checks=[...new Set(grouped.assumptions.flatMap(section=>section.bullets||[]))];
 return <div className={styles.result}>
  {priced&&checks.length>0&&<section className={styles.card} aria-label="Estimate highlights">
   {checks.length>0&&<><h3>Start by checking these assumptions</h3><ul className={styles.bullets}>{checks.slice(0,3).map(item=><li key={item}>{item}</li>)}</ul>{checks.length>3&&<p className={styles.hint}>{checks.length-3} more assumptions are listed below. Review all of them before planning the work.</p>}</>}
  </section>}
  {showGlance&&grouped.glance&&<Section section={grouped.glance} open={openFirst}/>}
  {grouped.brief&&<Section section={grouped.brief}/>}
  {(grouped.included.length>1||hasCategories)&&<p className={styles.sectionLabel}>{priced?'What is included':'Requested work'}</p>}
  {grouped.included.map((s,i)=><Section key={s.title+i} section={s} open={!priced}/>)}
  {hasCategories&&<>
   {grouped.categoriesIntro?.text&&<p className={styles.hint} style={{marginBottom:10}}>{grouped.categoriesIntro.text}</p>}
   {breakdown.map(group=><details key={group.category} className={styles.accordion} data-kind="included">
    <summary className={styles.categorySummary}><span className={styles.accordionTitle}>{group.category}</span><span className={styles.badge} data-kind="included">Included</span><span className={styles.accordionMeta}>{group.tasks.length||group.items.length} {(group.tasks.length||group.items.length)===1?'item':'items'}</span></summary>
    <div className={styles.accordionBody}>
     {group.tasks.length>0&&<ul className={styles.bullets} style={{marginBottom:group.items.length?12:0}}>{group.tasks.map((task,i)=><li key={i}>{task}</li>)}</ul>}
     {group.items.length>0&&<ul className={styles.lineItems}>{group.items.map(item=><li key={item.id} className={styles.lineItem}>
      <strong>{item.label}</strong>
      <span className={styles.qty}>{item.quantity.toLocaleString('en-US')} {item.unit}{item.quantityRange?` (modeled: ${item.quantityRange.low.toLocaleString('en-US')} to ${item.quantityRange.high.toLocaleString('en-US')} ${item.unit} to verify)`:''}</span>
      <span className={styles.note}><span className={styles.badge} data-kind={item.status==='estimated-allowance'?'allowance':item.status==='owner-planning-rate'?'assumption':'included'}>{STATUS_LABEL[item.status]||item.status}</span>{item.verification?` ${item.verification}`:''}</span>
     </li>)}</ul>}
    </div>
   </details>)}
  </>}
  {grouped.excluded.length>0&&<>{grouped.excluded.length>1&&<p className={styles.sectionLabel}>Not included</p>}{grouped.excluded.map((s,i)=><Section key={s.title+i} section={s}/>)}</>}
  {grouped.allowances.length>0&&<>{grouped.allowances.length>1&&<p className={styles.sectionLabel}>Allowances</p>}{grouped.allowances.map((s,i)=><Section key={s.title+i} section={s}/>)}</>}
  {grouped.assumptions.length>0&&<>{grouped.assumptions.length>1&&<p className={styles.sectionLabel}>Assumptions and items to confirm</p>}{grouped.assumptions.map((s,i)=><Section key={s.title+i} section={s}/>)}</>}
  {grouped.info.length>0&&<>{grouped.info.length>1&&<p className={styles.sectionLabel}>Supporting details</p>}{grouped.info.map((s,i)=><Section key={s.title+i} section={s}/>)}</>}
 </div>;
}
