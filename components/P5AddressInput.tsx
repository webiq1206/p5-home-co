'use client';
import {useEffect,useRef,useState} from 'react';
import styles from './P5AddressInput.module.css';

export interface AddressSuggestion {id:string;address:string}
export interface AddressSuggestionsProvider {
 /** Activation requires a reviewed provider adapter, billing cap and privacy/attribution configuration. */
 suggest:(text:string,signal:AbortSignal)=>Promise<AddressSuggestion[]>;
 attribution:string;
 privacyUrl:string;
}
/** No provider has been approved for these five public intake sites. No network
 * implementation, credential lookup or implicit free-service fallback exists. */
export const INTAKE_ADDRESS_PROVIDER:AddressSuggestionsProvider|null=null;
export function retainAddressUnit(address:string,typed:string){
 const unit=typed.match(/(?:\b(?:apt\.?|apartment|unit|suite|ste\.?)|#)\s*[\w-]+/i)?.[0];
 return unit&&!/(?:\b(?:apt\.?|apartment|unit|suite|ste\.?)|#)\s*[\w-]+/i.test(address)?`${address}, ${unit}`:address;
}
export function P5AddressInput({id,value,onChange,label='Project address, city or ZIP code',disabled=false,provider=INTAKE_ADDRESS_PROVIDER}:{id:string;value:string;onChange:(value:string)=>void;label?:string;disabled?:boolean;provider?:AddressSuggestionsProvider|null}){
 const [suggestions,setSuggestions]=useState<AddressSuggestion[]>([]),[active,setActive]=useState(-1),[focused,setFocused]=useState(false),[status,setStatus]=useState(''),[resultQuery,setResultQuery]=useState('');
 const generation=useRef(0),request=useRef<AbortController|null>(null),selected=useRef<string|null>(null),dismissed=useRef<string|null>(null);
 const open=Boolean(provider)&&!disabled&&focused&&suggestions.length>0&&resultQuery===value;
 const cancel=()=>{generation.current++;request.current?.abort();setSuggestions([]);setActive(-1);};
 useEffect(()=>{
  const version=++generation.current;request.current?.abort();
  if(!provider||!focused||disabled||value.trim().length<3||value===selected.current||value===dismissed.current)return;
  const controller=new AbortController();request.current=controller;
  const timer=setTimeout(()=>{
   setSuggestions([]);setActive(-1);setStatus('Looking for addresses…');
   void provider.suggest(value.trim(),controller.signal).then(items=>{
    if(controller.signal.aborted||generation.current!==version)return;
    const valid=items.filter(item=>item&&typeof item.id==='string'&&typeof item.address==='string'&&item.address.trim()).slice(0,5);
    setResultQuery(value);setSuggestions(valid);setStatus(valid.length?`${valid.length} address suggestions. Use the arrow keys to explore, or keep your own entry.`:'No matching suggestions. You can keep typing and use your own address.');
   }).catch(()=>{if(!controller.signal.aborted&&generation.current===version)setStatus('Address suggestions are unavailable. You can enter the address yourself.');});
  },300);
  return()=>{clearTimeout(timer);controller.abort();};
 },[value,focused,disabled,provider]);
 useEffect(()=>{if(active>=0)document.getElementById(`${id}-option-${active}`)?.scrollIntoView({block:'nearest'});},[active,id]);
 const choose=(item:AddressSuggestion)=>{const next=retainAddressUnit(item.address,value);selected.current=next;cancel();onChange(next);setStatus('Address selected. You can edit it, including the apartment or unit.');};
 return <div className={styles.root}>
  <label htmlFor={id}>{label}</label>
  <input id={id} type="text" autoComplete="street-address" value={value} disabled={disabled}
   role={provider?'combobox':undefined} aria-autocomplete={provider?'list':undefined} aria-expanded={provider?open:undefined} aria-controls={provider?`${id}-suggestions`:undefined} aria-activedescendant={open&&active>=0?`${id}-option-${active}`:undefined} aria-describedby={`${id}-help ${id}-status`}
   onFocus={()=>setFocused(true)} onBlur={()=>{setFocused(false);cancel();}}
   onChange={event=>{selected.current=null;dismissed.current=null;cancel();onChange(event.target.value);}}
   onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismissed.current=value;cancel();setStatus('Suggestions closed. Your entry is unchanged.');}
    else if(open&&(event.key==='ArrowDown'||event.key==='ArrowUp')){event.preventDefault();event.stopPropagation();setActive(previous=>previous<0?(event.key==='ArrowDown'?0:suggestions.length-1):(previous+(event.key==='ArrowDown'?1:-1)+suggestions.length)%suggestions.length);}
    else if(open&&event.key==='Enter'&&active>=0){event.preventDefault();event.stopPropagation();choose(suggestions[active]);}
   }}/>
  {open&&<div className={styles.panel}><ul id={`${id}-suggestions`} role="listbox" aria-label="Address suggestions">{suggestions.map((item,index)=><li key={`${item.id}-${index}`}><button type="button" id={`${id}-option-${index}`} role="option" aria-selected={active===index} tabIndex={-1} onPointerDown={event=>event.preventDefault()} onClick={()=>choose(item)}>{item.address}</button></li>)}</ul><p className={styles.attribution}>{provider?.attribution}</p></div>}
  <p id={`${id}-help`} className={styles.help}>A city or ZIP code is enough for now. You can enter your own address, include a unit, or leave this unknown.{provider&&<> Suggestions use an address service. <a href={provider.privacyUrl}>Privacy details</a>.</>}</p>
  <p id={`${id}-status`} role="status" aria-live="polite" className={styles.help}>{status}</p>
 </div>;
}
