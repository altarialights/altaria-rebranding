export const assertSameOrigin = (request: Request): boolean => {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
};

export const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

export const acceptsJsonBody = (request: Request, maximumBytes = 20_000): boolean => {
  const contentType = request.headers.get('content-type') ?? '';
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  return contentType.toLowerCase().includes('application/json')
    && (!contentLength || (Number.isFinite(contentLength) && contentLength <= maximumBytes));
};
