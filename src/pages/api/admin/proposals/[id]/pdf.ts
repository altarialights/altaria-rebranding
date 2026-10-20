import type { APIRoute } from 'astro';
import { getProposal, ProposalError } from '../../../../../lib/admin/proposals/service';
import { renderProposalPdf } from '../../../../../lib/admin/proposals/pdf';
export const prerender = false;
export const GET: APIRoute = async (context) => {
  const principal = context.locals.admin;
  if (!principal) return new Response('Acceso denegado.', { status: 403 });
  try {
    const detail = await getProposal(principal, context.params.id || '');
    const requested = Number(context.url.searchParams.get('version') || detail.proposal.current_version);
    const version = detail.versions.find((row) => Number(row.version_number) === requested);
    if (!version) return new Response('Versión no encontrada.', { status: 404 });
    const bytes = await renderProposalPdf({ title: String(detail.proposal.title),
      organizationName: String(detail.proposal.organization_name), versionNumber: requested,
      createdAt: String(version.created_at), snapshot: JSON.parse(String(version.snapshot_json)) });
    return new Response(Buffer.from(bytes), { headers: { 'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="altaria-propuesta-v${requested}.pdf"`,
      'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  } catch (error) {
    return new Response('No se pudo generar el PDF.', { status: error instanceof ProposalError ? error.status : 503 });
  }
};
