import {P5Estimator} from "@/components/P5Estimator";
export const metadata={title:"Upload or describe your project",robots:{index:false,follow:false}};
export default function ScopeEstimator(){return <>
  <header style={{maxWidth:900,margin:"24px auto",padding:"0 20px",display:"flex",flexWrap:"wrap",alignItems:"center",justifyContent:"space-between",gap:20}}>
    <a href="/" aria-label="P5 Home Co, home"><img src="/brands/p5-home-co-lockup-dark.svg" alt="P5 Home Co, The Home Company" style={{width:200,height:56,objectFit:"contain"}}/></a>
    <a href="tel:+12084771169" style={{minHeight:44,display:"inline-flex",alignItems:"center"}}>(208) 477-1169</a>
  </header>
  <main style={{padding:"20px 0 40px",minWidth:0}}><P5Estimator/></main>
</>;}
