"use client";
import {useEffect,useState} from 'react';

/** Hidden until the current page's entire introductory region passes the header.
 * Geometry, not a timer or fixed pixel threshold, governs every page and device. */
export function useMobileActionVisibility(pathname:string|null){
  const [state,setState]=useState<{path:string|null;visible:boolean}>({path:null,visible:false});
  useEffect(()=>{
    const viewport=window.visualViewport;
    let frame=0,hero:Element|null=null;
    const visibleElement=(element:Element)=>{const rect=element.getBoundingClientRect();const style=getComputedStyle(element);return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0';};
    const findHero=()=>{
      const explicit=document.querySelector('[data-page-hero], main [data-hero], main #hero, main .hero, section.hero');
      if(explicit)return explicit;
      const title=document.querySelector('main h1')||document.querySelector('h1');
      return title?.closest('section')||title?.closest('header')||title?.parentElement||null;
    };
    const measure=()=>{
      frame=0;
      if(!hero||!hero.isConnected)hero=findHero();
      const viewport=window.visualViewport;
      const top=viewport?.offsetTop||0,bottom=top+(viewport?.height||innerHeight);
      const headerBottom=[...document.querySelectorAll('header')].filter(e=>{const r=e.getBoundingClientRect();return ['fixed','sticky'].includes(getComputedStyle(e).position)&&r.top<=top+1&&r.bottom<innerHeight/3;}).reduce((n,e)=>Math.max(n,e.getBoundingClientRect().bottom),top);
      const pastHero=Boolean(hero&&visibleElement(hero)&&scrollY>0&&hero.getBoundingClientRect().bottom<=headerBottom+1);
      const estimatorActive=document.body.dataset.p5EstimatorActive==='true'||Boolean(document.querySelector('[data-p5-estimator][data-expanded="true"]'));
      const dialogOpen=[...document.querySelectorAll('[role="dialog"][data-state="open"], [role="dialog"][aria-modal="true"],#mobile-menu[aria-hidden="false"]')].some(visibleElement);
      const field=document.activeElement;const typing=field instanceof HTMLElement&&(field.matches('input:not([type=checkbox]):not([type=radio]),textarea,select')||field.isContentEditable);
      const formVisible=[...document.querySelectorAll('main form,[data-suppress-sticky-cta]')].some(e=>{const r=e.getBoundingClientRect();return visibleElement(e)&&r.top<bottom&&r.bottom>headerBottom;});
      const visible=pastHero&&!estimatorActive&&!dialogOpen&&!typing&&!formVisible;
      setState(previous=>previous.path===pathname&&previous.visible===visible?previous:{path:pathname,visible});
    };
    const queue=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    setState({path:pathname,visible:false});queue();
    const resize=new ResizeObserver(queue);resize.observe(document.body);
    const mutations=new MutationObserver(queue);mutations.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-hidden','aria-modal','data-state','data-p5-estimator-active','data-expanded']});
    window.addEventListener('scroll',queue,{passive:true});window.addEventListener('resize',queue);
    document.addEventListener('focusin',queue);document.addEventListener('focusout',queue);
    viewport?.addEventListener('resize',queue);viewport?.addEventListener('scroll',queue);
    return()=>{cancelAnimationFrame(frame);resize.disconnect();mutations.disconnect();window.removeEventListener('scroll',queue);window.removeEventListener('resize',queue);document.removeEventListener('focusin',queue);document.removeEventListener('focusout',queue);viewport?.removeEventListener('resize',queue);viewport?.removeEventListener('scroll',queue);};
  },[pathname]);
  return state.path===pathname&&state.visible;
}
