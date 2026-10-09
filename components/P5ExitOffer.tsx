'use client';
import {forwardRef,useCallback,useEffect,useId,useImperativeHandle,useRef,useState} from 'react';
import {ESTIMATOR_BRAND as brand} from '../lib/p5/brand';
import {callbackContext,callbackPhone,EXIT_CALLBACK_FLOW,EXIT_OFFER_SESSION_KEY} from '../lib/p5/exitCallback';
import styles from './P5ExitOffer.module.css';

export interface ExitOfferHandle {requestExit: (leave: () => void, trigger?: HTMLElement) => void}
interface Props {
  enabled: boolean;
  engaged: boolean;
  onLeave: () => void;
  draft: {id: string; revision: number; answers: {service?: string}};
}
let shownThisPage = false;

/** Never intercepts browser history or unload. Leaving never requires a submission. */
export const P5ExitOffer = forwardRef<ExitOfferHandle, Props>(function P5ExitOffer({enabled,engaged,draft,onLeave}, ref) {
  const dialog = useRef<HTMLDialogElement>(null), stayButton = useRef<HTMLButtonElement>(null), phoneInput = useRef<HTMLInputElement>(null);
  const leaveRef = useRef(onLeave);leaveRef.current = onLeave;
  const previousFocus = useRef<HTMLElement|null>(null), pendingLeave = useRef<(()=>void)|null>(null);
  const [open,setOpen] = useState(false);
  const [phone,setPhone] = useState(''), [state,setState] = useState<'idle'|'sending'|'saved'|'error'>('idle');
  const [error,setError] = useState(''), [notified,setNotified] = useState(false);
  const submitting = useRef(false), requestPhone = useRef<string|null>(null), requestBody = useRef<string|null>(null), id = useId();
  const show = useCallback((leave?: () => void, trigger?: HTMLElement) => {
    let seen = shownThisPage;
    try {seen ||= sessionStorage.getItem(EXIT_OFFER_SESSION_KEY) === '1';} catch { /* In-memory fallback; never block navigation. */ }
    if (!enabled || seen) return false;
    shownThisPage = true;
    try {sessionStorage.setItem(EXIT_OFFER_SESSION_KEY,'1');} catch { /* optional */ }
    previousFocus.current = trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    pendingLeave.current = leave || (()=>leaveRef.current()); setOpen(true); return true;
  },[enabled]);
  useImperativeHandle(ref,()=>({requestExit: (leave,trigger)=>{if(!show(leave,trigger))leave();}}),[show]);
  const stay = () => {pendingLeave.current = null;setOpen(false);};
  const leave = () => {const next = pendingLeave.current; pendingLeave.current = null;setOpen(false);next?.();};
  useEffect(()=>{
    const node = dialog.current;
    if(open && node && !node.open){node.showModal();stayButton.current?.focus();}
    if(!open && node?.open){node.close();previousFocus.current?.isConnected && previousFocus.current.focus();}
  },[open]);
  useEffect(()=>{
    if(!enabled)return;
    const click = (event: MouseEvent) => {
      if(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if(!link || dialog.current?.contains(link) || link.hasAttribute('download') || (link.target && link.target !== '_self'))return;
      const url = new URL(link.href,location.href);
      if(url.origin !== location.origin || !/^https?:$/.test(url.protocol) || (url.pathname === location.pathname && url.search === location.search))return;
      if(show(()=>location.assign(url.href),link)){event.preventDefault();event.stopPropagation();}
    };
    document.addEventListener('click',click,true);
    return()=>document.removeEventListener('click',click,true);
  },[enabled,show]);
  useEffect(()=>{
    if(!enabled || !engaged || !matchMedia('(hover: hover) and (pointer: fine)').matches)return;
    const started = Date.now();
    const exitIntent = (event: MouseEvent) => {
      if(event.relatedTarget === null && event.clientY <= 0 && document.visibilityState === 'visible' && Date.now()-started >= 20000)show();
    };
    document.documentElement.addEventListener('mouseleave',exitIntent);
    return()=>document.documentElement.removeEventListener('mouseleave',exitIntent);
  },[enabled,engaged,show]);
  async function requestCallback(event: React.FormEvent) {
    event.preventDefault();
    if(submitting.current || state==='saved')return;
    const normalized = callbackPhone(phone);
    if(!normalized){setError('Enter a valid 10-digit US phone number, without an extension.');setState('error');phoneInput.current?.focus();return;}
    // Reuse the same payload after an uncertain response. The server freezes the first request too.
    requestPhone.current ||= normalized;
    submitting.current = true;setState('sending');setError('');
    const controller = new AbortController();const timeout = setTimeout(()=>controller.abort(),15000);
    try {
      requestBody.current ||= JSON.stringify({
        sessionId:draft.id,flow:EXIT_CALLBACK_FLOW,phone:requestPhone.current,callbackConsent:true,
        note:callbackContext(draft),pagePath:location.pathname,device:matchMedia('(pointer: coarse)').matches?'phone':'desktop',
      });
      const response = await fetch('/api/recovery/callback',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:requestBody.current});
      const result = await response.json();
      if(!response.ok || result.ok!==true)throw new Error('Request not confirmed');
      setNotified(result.notified===true);setState('saved');
    } catch {setState('error');setError('We could not confirm your callback request. Retry with the same number, or call us directly. You can still continue or leave.');}
    finally {clearTimeout(timeout);submitting.current=false;}
  }
  const number = callbackPhone(brand.phone);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-desc`} onCancel={event=>{event.preventDefault();stay();}} onClick={event=>{if(event.target===dialog.current){const rect=dialog.current.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)stay();}}}>
    <h2 id={`${id}-title`}>Prefer to talk about your project?</h2>
    <p id={`${id}-desc`}>Call us, or leave your number and we’ll call you.</p>
    {number && <a href={`tel:+1${number}`} aria-label={`Call ${brand.name} at ${brand.phone}`}>Call us</a>}
    {state==='saved' ? <p role="status">Your callback request is saved. {notified?'The team notification was accepted.':'The team notification has not been confirmed.'} You can continue your form or leave.</p> : <form onSubmit={event=>void requestCallback(event)} noValidate>
      <label htmlFor={`${id}-phone`}>Your phone number</label>
      <input ref={phoneInput} id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="tel" value={phone} readOnly={Boolean(requestPhone.current)} onChange={event=>{setPhone(event.target.value);setError('');}} aria-invalid={Boolean(error)} aria-describedby={`${id}-consent${error?` ${id}-error`:''}`} required maxLength={30}/>
      <p id={`${id}-consent`} className={styles.consent}>By requesting a call, you ask {brand.name} to call this number about your project. This does not sign you up for marketing.</p>
      {error&&<p id={`${id}-error`} className={styles.error} role="alert">{error}</p>}
      <button type="submit" disabled={state==='sending'}>{state==='sending'?'Saving request…':requestPhone.current?'Retry callback request':'Request a callback'}</button>
    </form>}
    <div className={styles.actions}><button ref={stayButton} type="button" onClick={stay}>Continue form</button><button type="button" onClick={leave}>Leave without finishing</button></div>
  </dialog>;
});
