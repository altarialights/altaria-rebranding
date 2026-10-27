import type { APIRoute } from 'astro';
import { accessSchema } from '../../../lib/meetings/validation';
import { publicBooking } from '../../../lib/meetings/service';
import { MeetingError } from '../../../lib/meetings/repository';
import { runtime, rateLimit, readBody, errorResponse } from '../../../lib/meetings/http';
import { jsonResponse } from '../../../lib/orders/http';
export const prerender = false;
export const POST: APIRoute = async ({request,clientAddress}) => {
  try {
    const result = accessSchema.safeParse(await readBody(request));
    if (!result.success) throw new MeetingError('invalid_body',400);
    const {repo,config,service} = runtime();
    await rateLimit(repo,config.rateSecret,clientAddress,'status',150,15);
    return jsonResponse({booking:publicBooking(await service.status(result.data.key,result.data.token))});
  } catch(error) { return errorResponse(error); }
};
