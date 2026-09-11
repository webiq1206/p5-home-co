import {estimateSections,scopeBullets} from '../lib/p5/presentation';
import styles from './P5Estimator.module.css';
export default function P5EstimateDetails({result}:{result:any}){
 return <div className={styles.estimateSections}>{estimateSections(result).map((section,index)=><section className={styles.estimateSection} key={index} aria-labelledby={`estimate-section-${index}`}>
  <h3 id={`estimate-section-${index}`}>{section.title}</h3>
  {section.text&&<p className={styles.sectionLead}>{section.text}</p>}
  {Boolean(section.bullets?.length)&&<ul>{section.bullets!.map((item,i)=><li key={i}>{item}</li>)}</ul>}
  {Boolean(section.rows?.length)&&<dl>{section.rows!.map(([label,value],i)=><div key={i}><dt>{label}</dt><dd>{scopeBullets(value).length>1?<ul>{scopeBullets(value).map((text,j)=><li key={j}>{text}</li>)}</ul>:value}</dd></div>)}</dl>}
 </section>)}</div>;
}
