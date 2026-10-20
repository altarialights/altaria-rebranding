export function contentFormError(request:Request,code:string,status:number,message:string):Response{
  if(request.headers.get('accept')?.includes('text/html')){
    const source=request.headers.get('referer');
    let destination=new URL('/admin/contenido/produccion',request.url);
    if(source){try{const candidate=new URL(source);
      if(candidate.origin===destination.origin&&candidate.pathname.startsWith('/admin/contenido/'))
        destination=candidate;
    }catch{ /* The fixed local destination remains in use. */ }
    }
    destination.searchParams.set('error',code);
    return Response.redirect(destination,303);
  }
  return Response.json({error:message,code},{status});
}
