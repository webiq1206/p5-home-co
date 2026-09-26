'use client';
import {useEffect,useState} from 'react';

/** Keep fixed marketing actions below the hero and away from a focused field. */
export function useP5MobileActions(pathname:string|null){
  const [state,setState]=useState({path:pathname,visible:false});
  useEffect(()=>{
    let frame=0;
    const update=()=>{
      frame=0;
      const hero=document.querySelector('.f-hero,.cabinet-approved .hero,.interior-hero')
        ||document.querySelector('main h1')?.closest('section');
      const active=document.activeElement;
      const editing=active instanceof HTMLElement&&active.matches('input,textarea,select,[contenteditable=true]');
      const footerVisible=[...document.querySelectorAll('[data-suppress-sticky-cta]')].some(el=>{
        const rect=el.getBoundingClientRect();return rect.bottom>0&&rect.top<window.innerHeight;
      });
      const pastHero=hero?hero.getBoundingClientRect().bottom<=100:window.scrollY>240;
      setState({path:pathname,visible:pastHero&&!editing&&!footerVisible});
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
