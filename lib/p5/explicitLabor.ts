/** A visitor's explicit complete labor total is authoritative, even without a page ledger. */
export function explicitLaborTotal(answer:string):string|undefined {
  const totals=new Set<number>();
  for(const clause of answer.split(/[;\n]+|[.!?](?:\s|$)/)){
    if(/\b(?:exclude|excluded|excluding|without|do not|don't|not included|subtotal|partial)\b/i.test(clause))continue;
    const patterns=[
      /\b(\d+(?:\.\d+)?)\s+(?:total|overall|complete(?:\s+project)?)\s+labor\s+hours?\b/gi,
      /\b(?:total|overall|complete(?:\s+project)?)\s+labor(?:\s+hours?)?(?:\s+(?:of|is|are))?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:labor\s+)?hours?\b/gi,
      /\btotal(?:ing|s|ed)?(?:\s+(?:of|is))?\s*(\d+(?:\.\d+)?)\s+labor\s+hours?\b/gi,
      /=\s*(\d+(?:\.\d+)?)\s*(?:total\s+)?labor\s+hours?\b/gi,
    ];
    for(const pattern of patterns)for(const match of clause.matchAll(pattern)){
      const value=Number(match[1]);
      if(Number.isFinite(value)&&value>=0&&value<=1000000)totals.add(value);
    }
  }
  if(totals.size>1)throw new Error('Your answer contains different complete labor totals. Confirm one total to continue.');
  return totals.size===1?String([...totals][0]):undefined;
}
