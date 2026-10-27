import type { APIRoute } from 'astro';
import { jsonResponse } from '../../../lib/orders/http';
import { runtime, rateLimit, errorResponse } from '../../../lib/meetings/http';
export const prerender = false;
export const GET: APIRoute = async ({clientAddress}) => {
  try {
    const {repo,config,service} = runtime();
    await rateLimit(repo,config.rateSecret,clientAddress,'availability',60,15);
    return jsonResponse(await service.availability());
  } catch(error) { return errorResponse(error); }
};
