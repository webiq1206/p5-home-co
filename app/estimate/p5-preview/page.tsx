import {withBrandPageMetadata} from '@/lib/brand-page-metadata';
import {P5Estimator} from "@/components/P5Estimator";
import {LandingContactBar} from "@/components/LandingContactBar";
import PublicIdentity from "@/components/PublicIdentity";
import {EstimateDocumentTitle} from "../EstimateDocumentTitle";
export const metadata=withBrandPageMetadata(({title:"Project estimator review",robots:{index:false,follow:false}}), "/estimate/p5-preview");
/** The estimator as a dedicated screen: its own top bar carries the brand and Exit, so no site header is needed here. */
export default function EstimatorPreview(){return <><LandingContactBar /><main style={{minWidth:0,minHeight:'100dvh'}}><EstimateDocumentTitle /><P5Estimator layout="page"/></main><footer className="estimator-identity"><PublicIdentity tone="ink" /></footer></>;}
