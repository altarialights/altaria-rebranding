import type { APIRoute } from 'astro';
import { hasAdminPermission } from '../../../../../lib/admin/access';
export const prerender=false;
export const GET:APIRoute=async({locals})=>{
  const principal=locals.admin;
  if (!principal || !hasAdminPermission(principal,'cards:write')) return new Response(null,{status:403});
  // The local QA address must never become production print material.
  return new Response('El manifiesto imprimible requiere una URL canónica pública aprobada.',{status:409});
};
