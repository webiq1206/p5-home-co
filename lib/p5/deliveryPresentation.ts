type Receipt={channel:string;status:string};
export const DELIVERY_LABEL={sent:'Sent',review:'Being checked by our team',pending:'Sending',notRequested:'Not requested',suppressed:'Not sent (test estimate)',partial:'Partially sent'} as const;
export function estimateDeliveryStates(delivery:Receipt[],hasEmail:boolean){
 const customer=delivery.find(item=>item.channel==='customer');
 const staff=delivery.filter(item=>item.channel==='admin'||item.channel.startsWith('admin'));
 const suppressed=delivery.some(item=>item.channel==='suppressed'&&item.status==='suppressed');
 const staffState=!staff.length?(suppressed?'suppressed':'pending'):staff.every(item=>item.status==='sent')?'sent'
  :staff.every(item=>item.status==='suppressed')?'suppressed':staff.some(item=>item.status==='suppressed')&&staff.some(item=>item.status==='sent')?'partial'
  :staff.some(item=>item.status==='needs-review')?'review':'pending';
 const customerState=customer?.status==='sent'?'sent':customer?.status==='suppressed'?'suppressed':customer?.status==='needs-review'?'review'
  :!hasEmail&&!customer?'notRequested':suppressed&&!customer?'suppressed':'pending';
 return {staffState,customerState} as const;
}
