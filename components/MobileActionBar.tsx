"use client";
import {usePathname} from 'next/navigation';
import {useMobileActionVisibility} from '@/hooks/use-mobile-action-visibility';
import {useEffect,useState} from 'react';

export default function MobileActionBar(){
  const path=usePathname();
  const visible=useMobileActionVisibility(path);
  // Contextual: the bar steps aside while an on-page call to action (hero, final band) is in view, so two never compete.
  const [suppressed,setSuppressed]=useState(false);
  useEffect(()=>{const targets=document.querySelectorAll('[data-suppress-mobile-bar]');if(!targets.length||typeof IntersectionObserver==='undefined'){setSuppressed(false);return;}const obs=new IntersectionObserver(entries=>setSuppressed(entries.some(e=>e.isIntersecting)),{threshold:0.2});targets.forEach(t=>obs.observe(t));return()=>obs.disconnect();},[path]);
  if(!path||/^\/(admin|api|portal|login|quote|estimate)(\/|$)/.test(path))return null;
  return <nav className="p5-mobile-actionbar" data-mobile-nav-bar="" style={{display:visible?undefined:"none"}} data-suppressed={suppressed?"true":undefined} aria-label="Quick contact">
    <a className="p5-mobile-call" href="tel:+12084771169" aria-label="Call (208) 477-1169"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"/></svg><span>Call</span></a>
    <a className="p5-mobile-estimate" href="/quote">Get an Estimate</a>
  </nav>;
}
