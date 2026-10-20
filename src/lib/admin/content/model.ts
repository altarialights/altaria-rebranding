import type {AdminPrincipal,ContentGrant} from '../access';

export type ContentCapability='read'|'edit'|'review'|'recordPublication'|'manageBrand';
export type ContentStage='idea'|'script'|'visuals'|'editing'|'review'|'ready';
export const contentStages:ContentStage[]=['idea','script','visuals','editing','review','ready'];
export const stageLabels:Record<ContentStage,string>={
  idea:'Idea',script:'Guion',visuals:'Visuales',editing:'Edición',review:'Revisión',ready:'Lista',
};
export const channelLabels={instagram:'Instagram',linkedin:'LinkedIn'} as const;
export const publicationLabels={none:'Sin programar',scheduled:'Programada',
  published:'Publicada · TEST simulado',analyzed:'Analizada · TEST',
  archived:'Archivada'} as const;
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class ContentError extends Error {
  constructor(public code:string,public status=400){super(code);}
}
export function grantFor(principal:AdminPrincipal,brandId:string):ContentGrant|undefined{
  if(principal.roles.includes('owner'))return {brandId,read:true,edit:true,review:true,
    recordPublication:true,manageBrand:true};
  return principal.contentGrants?.find(grant=>grant.brandId===brandId);
}
export function requireBrand(principal:AdminPrincipal,brandId:string,capability:ContentCapability){
  if(!brandId||!grantFor(principal,brandId)?.[capability])throw new ContentError('forbidden',403);
}
export function requiredText(value:unknown,max:number,min=1){
  const text=String(value??'').trim();
  if(text.length<min||text.length>max)throw new ContentError('invalid_input');
  return text;
}
export function optionalText(value:unknown,max:number){
  const text=String(value??'').trim();
  if(text.length>max)throw new ContentError('invalid_input');
  return text;
}
export function optionalDate(value:unknown){
  if(!value)return null;
  const date=new Date(String(value));
  if(!Number.isFinite(date.getTime()))throw new ContentError('invalid_date');
  return date.toISOString();
}
