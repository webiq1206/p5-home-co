import {withBrandPageMetadata} from '@/lib/brand-page-metadata';
import {P5Estimator} from "@/components/P5Estimator";
import {LandingContactBar} from "@/components/LandingContactBar";
import PublicIdentity from "@/components/PublicIdentity";
export const metadata=withBrandPageMetadata(({title:"Upload or describe your project",robots:{index:false,follow:false}}), "/estimate/scope");
export default function ScopeEstimator(){return <><LandingContactBar /><main style={{minWidth:0,minHeight:'100dvh'}}><P5Estimator layout="page"/></main><footer className="estimator-identity"><PublicIdentity tone="ink" /></footer></>;}
