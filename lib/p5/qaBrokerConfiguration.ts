type Environment=Readonly<Record<string,string|undefined>>;
/** Only the server-marked QA broker calls this resolver. Cohosting already
 * provisions P5's tenant key; legacy document routing must remain unchanged. */
export function qaBrokerEnvironment(env:Environment,tenant:string):Environment{
 if(env.P5_DOCUMENT_HOST_ENABLED!=='true'||tenant!=='p5homeco.com'||env.P5_DOCUMENT_SERVICE_URL)return env;
 if(env.P5_DOCUMENT_SERVICE_TENANT&&env.P5_DOCUMENT_SERVICE_TENANT!==tenant)return env;
 let key=env.P5_DOCUMENT_SERVICE_KEY;
 if(!key){try{key=JSON.parse(env.P5_DOCUMENT_TENANTS_JSON||'{}')[tenant];}catch{return env;}}
 if(typeof key!=='string'||key.length<32)return env;
 return {...env,P5_DOCUMENT_SERVICE_URL:'https://p5homeco.com/api/p5-documents',P5_DOCUMENT_SERVICE_KEY:key,P5_DOCUMENT_SERVICE_TENANT:tenant};
}
