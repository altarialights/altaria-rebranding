import type { APIRoute } from 'astro';
import { bookingSchema } from '../../../lib/meetings/validation';
import { publicBooking } from '../../../lib/meetings/service';
import { MeetingError } from '../../../lib/meetings/repository';
import { runtime, rateLimit, readBody, errorResponse } from '../../../lib/meetings/http';
import { jsonResponse } from '../../../lib/orders/http';
export const prerender = false;
export const POST: APIRoute = async ({request,clientAddress}) => {
  try {
    const result = bookingSchema.safeParse(await readBody(request));
    if (!result.success) return jsonResponse({error:'Revisa los campos señalados.',code:'validation',fields:Object.fromEntries(result.error.issues.map(i=>[i.path[0],i.message]))},400);
    const input = result.data;
    const {repo,config,service} = runtime();
    await rateLimit(repo,config.rateSecret,clientAddress,'submit',20,60);
    const prior = await repo.get(input.key);
    if (!prior) {
      const elapsed = Date.now()-input.startedAt;
      if (elapsed < 2500 || elapsed > 86_400_000) throw new MeetingError('invalid_body',400);
      if (!(process.env.VERCEL==='1' && process.env.VERCEL_ENV==='production')
        && input.email !== process.env.BOOKING_TEST_ATTENDEE_EMAIL?.toLowerCase()) throw new MeetingError('test_attendee',400);
      await rateLimit(repo,config.rateSecret,clientAddress,'new_booking',5,60);
      await rateLimit(repo,config.rateSecret,input.email,'email',3,1440);
      await rateLimit(repo,config.rateSecret,'all','global',100,60);
    }
    const booking = await service.reserve(input);
    return jsonResponse({booking:publicBooking(booking)},booking.status==='confirmed' ? 200 : 202);
  } catch(error) { return errorResponse(error); }
};
