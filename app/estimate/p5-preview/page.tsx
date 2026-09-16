import {withBrandPageMetadata} from '@/lib/brand-page-metadata';
import {P5Estimator} from "@/components/P5Estimator";
export const metadata=withBrandPageMetadata(({title:"Project estimator review",robots:{index:false,follow:false}}), "/estimate/p5-preview");
/** The estimator as a dedicated screen: its own top bar carries the brand and Exit, so no site header is needed here. */
export default function EstimatorPreview(){return <main style={{minWidth:0,minHeight:'100dvh'}}><P5Estimator layout="page"/></main>;}
