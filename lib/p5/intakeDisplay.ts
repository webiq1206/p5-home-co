export const intakeServiceLabel=(value:string)=>({kitchen:'Kitchen remodel',bathroom:'Bathroom remodel',remodel:'Interior remodel','whole-home':'Whole-home remodel',addition:'Home addition','new-construction':'New home','cabinet-product':'Cabinets, supply only','cabinet-install':'Cabinet installation',handyman:'Home repairs',re10:'Inspection repairs',adu:'ADU : team to confirm','change-order':'Change to an existing project',rush:'Urgent work : team to confirm'}[value]||value);
export const intakeContactLabel=(value:string)=>({either:'Email or phone',email:'Email',phone:'Phone'}[value]||value);
const choiceLabels:Record<string,string>={refresh:'Builder grade','mid-range':'Mid-range','high-end':'High-end',luxury:'Luxury',standard:'Standard',priority:'Priority',emergency:'Emergency',complex:'Complex',yes:'Yes',no:'No'};
export const intakeChoiceLabel=(field:string,value:string)=>field==='service'?intakeServiceLabel(value):choiceLabels[value]||value.replaceAll('-',' ');
export function intakeSavedAt(value:string):string {
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return value;
 return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',year:'numeric',month:'long',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:true}).format(date)+' UTC';
}
