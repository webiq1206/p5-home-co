"use client";
type Props={configuration:string;onChange:(value:string)=>void;onSave:()=>void;busy:boolean;rate:number;warnings:{message:string}[]};
export function P5OverheadReview({configuration,onChange,onSave,busy,rate,warnings}:Props){
  let parsed:any;try{parsed=JSON.parse(configuration);}catch{return <p>Correct the detailed configuration below to use the overhead fields.</p>;}
  const finance=parsed.finance;
  const update=(key:string,value:unknown)=>onChange(JSON.stringify({...parsed,finance:{...finance,[key]:value}},null,2));
  const control={display:"block",width:"100%",maxWidth:"100%",minHeight:44,fontSize:16,color:"#17201b",background:"#fff",padding:12,boxSizing:"border-box" as const,margin:"8px 0 16px"};
  return <section aria-label="Overhead recovery policy"><h2>Overhead recovery</h2>
    <p><strong>Standard rate: 20% of contract revenue.</strong> This one amount covers both owner salaries, employer payroll costs, advertising, social media, insurance, accounting, software and the remaining company overhead. Advertising is counted once.</p>
    <p>Current applied rate: <strong>{(rate*100).toFixed(2)}%</strong>. Overhead and profit are included within each priced item. Project-specific materials, outside trades and field labor remain direct costs. Do not enter overhead-funded owner salaries again as job labor.</p>
    <fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}>
      <label>Annual overhead budget ($)<input type="number" min="420000" step="1" style={control} value={finance.annualOverhead??""} onChange={e=>update("annualOverhead",e.target.value===""?null:Number(e.target.value))}/></label>
      <label>Conservative annual earned-revenue forecast, optional ($)<input type="number" min="1" step="1" style={control} value={finance.annualRevenue??""} onChange={e=>update("annualRevenue",e.target.value===""?null:Number(e.target.value))}/></label>
      <label>Forecast source and review period<input style={control} value={finance.forecastSource||""} onChange={e=>update("forecastSource",e.target.value)}/></label>
      <p>At the $2.4 million sales goal, the budget needs 17.5%. The standard remains 20%. A conservative forecast below $2.1 million raises the applied rate automatically. A reduction below 20% requires documented earned-revenue and overhead results in the financial configuration.</p>
      <button style={{minHeight:44,padding:12}} onClick={onSave}>Save quarterly overhead review</button>
    </fieldset>
    {warnings.length>0&&<ul>{warnings.map((w,i)=><li key={i}>{w.message}</li>)}</ul>}
  </section>;
}
