import type { APIRoute } from 'astro';
import { runtime, validCron, errorResponse } from '../../../lib/meetings/http';
import { jsonResponse } from '../../../lib/orders/http';
export const prerender = false;
export const GET: APIRoute = async ({request}) => {
  if (!validCron(request)) return jsonResponse({error:'No autorizado.'},401);
  try { return jsonResponse({processed:await runtime().service.recover()}); }
  catch(error) { return errorResponse(error); }
};
