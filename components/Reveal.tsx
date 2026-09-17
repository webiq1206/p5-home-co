"use client";
import {useEffect,useRef,useState,type CSSProperties,type ReactNode} from "react";

/** Gentle once-only reveal: content fades in with a small rise as it enters view.
 *  Server HTML carries the content in full; the hidden state applies only once
 *  the `js` class is on <html>, and reduced-motion readers see it at once. */
export default function Reveal({children,className="",style,delay=0,as:Tag="div"}:{children:ReactNode;className?:string;style?:CSSProperties;delay?:number;as?:"div"|"section"}){
  const ref=useRef<HTMLDivElement>(null);const [shown,setShown]=useState(false);
  useEffect(()=>{
    const el=ref.current;if(!el)return;
    // Reduced motion, or content already scrolled past (a page opened at an anchor): shown at once.
    if(window.matchMedia("(prefers-reduced-motion: reduce)").matches||el.getBoundingClientRect().bottom<0){setShown(true);return;}
    const obs=new IntersectionObserver(([entry])=>{if(entry.isIntersecting){setShown(true);obs.disconnect();}},{threshold:[0,0.1],rootMargin:"0px 0px -6% 0px"});
    obs.observe(el);return()=>obs.disconnect();
  },[]);
  const Element=Tag as "div";
  return <Element ref={ref} className={`p5-reveal ${shown?"p5-reveal-in":""} ${className}`.trim()} style={{...style,transitionDelay:delay?`${delay}ms`:undefined}}>{children}</Element>;
}
