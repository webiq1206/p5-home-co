/** Repair guidance only. These excerpts never make an invalid quote valid.
 * Keep the rejected text and nearby original wording together so a bounded
 * correction does not repeat an ellipsis or paraphrase against a long source. */
export function quotationFeedback(quote:string,source:string|undefined):string{
 const direction='Copy one continuous verbatim excerpt, including intervening words. Do not abbreviate with ellipses, combine separated phrases, or repeat a verb that only appears earlier in a compound sentence. Different work items may cite the same complete sentence.';
 if(source===undefined)return `The identified source does not exist. ${direction}`;
 if(source.length<=2400)return `${direction} Rejected quote: ${JSON.stringify(quote)}. Original source: ${JSON.stringify(source)}`;
 const words=[...new Set((quote.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).filter(word=>word.length>2))];
 const lower=source.toLowerCase();let best={score:-1,start:0};
 // Location hints are deliberately not an evidence-matching algorithm.
 // Literal source validation and independent meaning review remain mandatory.
 for(const word of words){let at=lower.indexOf(word),visited=0;
  while(at>=0&&visited++<40){
   const start=Math.max(0,at-350),window=lower.slice(start,start+1000);
   const score=words.reduce((n,term)=>n+(window.includes(term)?(/\d/.test(term)?3:1):0),0);
   if(score>best.score)best={score,start};at=lower.indexOf(word,at+word.length);
  }
 }
 return `${direction} Rejected quote: ${JSON.stringify(quote)}. Nearby original source excerpt (location hint only, not proof of the assertion): ${JSON.stringify(source.slice(best.start,best.start+1400))}`;
}
