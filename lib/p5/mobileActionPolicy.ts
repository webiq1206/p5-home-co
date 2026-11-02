/** Cabinet's approved first-screen CTA; other sites retain after-hero actions. */
export function mobileActionsVisible(brandId:string,pastHero:boolean,editing:boolean,suppressed:boolean){
  return (brandId==='cabinet'||pastHero)&&!editing&&!suppressed;
}

