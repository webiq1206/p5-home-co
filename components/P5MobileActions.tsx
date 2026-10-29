'use client';
import {useEffect,useState} from 'react';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';

import {mobileActionsVisible} from '../lib/p5/mobileActionPolicy.ts';

/** Keep fixed marketing actions below the hero and away from a focused field. */
export function useP5MobileActions(pathname:string|null){
  const [state,setState]=useState({path:pathname,visible:mobileActionsVisible(ESTIMATOR_BRAND.id,false,false,false)});
  useEffect(()=>{
    let frame=0;
    const update=()=>{
      frame=0;
      // A marked hero wins. Pages without one (articles, categories, sitemap) fall
      // back to the H1's section, unless that section wraps the whole article, in
      // which case the H1 itself is the hero; otherwise the bar stayed hidden for
      // most of every long post.
      const marked=document.querySelector('[data-p5-hero],.f-hero,.cabinet-approved .hero,.interior-hero');
      const h1=marked?null:document.querySelector('main h1');
      const h1Section=h1?.closest('section')??null;
      const hero=marked
        ||(h1Section&&h1Section.getBoundingClientRect().height>window.innerHeight*1.5?h1:h1Section);
      const active=document.activeElement;
      const editing=active instanceof HTMLElement&&active.matches('input,textarea,select,[contenteditable=true]');
      const footerVisible=[...document.querySelectorAll('[data-suppress-sticky-cta]')].some(el=>{
        const rect=el.getBoundingClientRect();return rect.bottom>0&&rect.top<window.innerHeight;
      });
      const pastHero=hero?hero.getBoundingClientRect().bottom<=100:window.scrollY>240;
      setState({path:pathname,visible:mobileActionsVisible(ESTIMATOR_BRAND.id,pastHero,editing,footerVisible)});
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    update();
    window.addEventListener('scroll',schedule,{passive:true});
    window.addEventListener('resize',schedule);
    document.addEventListener('focusin',schedule);
    document.addEventListener('focusout',schedule);
    const resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);
    if(resize)resize.observe(document.body);
    return ()=>{
      cancelAnimationFrame(frame);resize?.disconnect();
      window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);
      document.removeEventListener('focusin',schedule);document.removeEventListener('focusout',schedule);
    };
  },[pathname]);
  return state.path===pathname&&state.visible;
}
