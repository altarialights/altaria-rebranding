const messages:Record<string,string>={
  forbidden:'No tienes permiso para esta acción o esta marca.',
  invalid_input:'Revisa los campos indicados y vuelve a intentarlo.',
  invalid_date:'Revisa la fecha indicada.',
  invalid_asset:'El recurso seleccionado no es válido.',
  invalid_upload_request:'La carga no es válida. Recarga la ficha y prueba de nuevo.',
  upload_request_conflict:'Este intento ya se usó con otro archivo. Selecciona el archivo de nuevo.',
  piece_unavailable:'Esta pieza ya no admite adjuntos.',
  version_reviewed_create_new:'La versión ya está en revisión. Crea una versión nueva para adjuntar material.',
  media_too_large:'El archivo supera el límite de 20 MiB del entorno TEST.',
  unsupported_media:'Formato no admitido o el contenido no coincide con el tipo de archivo.',
  storage_path_unsafe:'El almacenamiento local no está disponible de forma segura.',
  asset_integrity:'No se pudo verificar la integridad del archivo.',
  version_conflict:'La pieza cambió. Recarga la ficha antes de continuar.',
  review_required:'Falta una aprobación vigente para avanzar.',
  review_stale:'La revisión ya no corresponde a esta versión.',
  invalid_transition:'Esta transición no está permitida.',
};

function showError(form:HTMLFormElement,code:string,fallback?:string){
  let alert=form.querySelector<HTMLElement>('[data-content-error]');
  if(!alert){alert=document.createElement('p');alert.dataset.contentError='';
    alert.className='content-form-error';alert.setAttribute('role','alert');form.append(alert);}
  alert.textContent=messages[code]??fallback??'No se pudo completar la acción. Reintenta más tarde.';
  const field=code==='media_too_large'||code==='unsupported_media'
    ?form.querySelector<HTMLInputElement>('input[type=file]')
    :form.querySelector<HTMLInputElement|HTMLTextAreaElement>(':invalid');
  if(field){field.setAttribute('aria-invalid','true');field.focus();}else alert.focus();
}
function clearError(form:HTMLFormElement){
  form.querySelector('[data-content-error]')?.remove();
  form.querySelectorAll('[aria-invalid=true]').forEach(field=>field.removeAttribute('aria-invalid'));
}
function setBusy(form:HTMLFormElement,busy:boolean){
  form.querySelectorAll<HTMLButtonElement>('button[type=submit]').forEach(button=>button.disabled=busy);
  form.setAttribute('aria-busy',String(busy));
}
function navigateOnSuccess(url:string){
  const destination=new URL(url,location.href);
  if(destination.origin!==location.origin)throw new Error('cross_origin_redirect');
  location.assign(destination.href);
}
function upload(form:HTMLFormElement){
  const file=form.querySelector<HTMLInputElement>('input[type=file]')?.files?.[0];
  if(!file){showError(form,'invalid_input','Selecciona un archivo.');return;}
  if(file.size>20*1024*1024){showError(form,'media_too_large');return;}
  const progress=form.querySelector<HTMLProgressElement>('progress');
  const cancel=form.querySelector<HTMLButtonElement>('[data-upload-cancel]');
  const xhr=new XMLHttpRequest();
  setBusy(form,true);if(progress){progress.hidden=false;progress.value=0;}
  if(cancel){cancel.hidden=false;cancel.onclick=()=>xhr.abort();}
  xhr.upload.onprogress=event=>{if(progress&&event.lengthComputable)
    progress.value=Math.round(event.loaded/event.total*100);};
  xhr.onload=()=>{
    if(xhr.status>=200&&xhr.status<300){navigateOnSuccess(xhr.responseURL);return;}
    let payload:{code?:string;error?:string}={};
    try{payload=JSON.parse(xhr.responseText);}catch{}
    showError(form,payload.code??(xhr.status===413?'media_too_large':'storage_error'),payload.error);
    setBusy(form,false);if(cancel)cancel.hidden=true;
  };
  xhr.onerror=()=>{showError(form,'temporary_error','No se pudo completar la carga. Puedes reintentar.');
    setBusy(form,false);if(cancel)cancel.hidden=true;};
  xhr.onabort=()=>{showError(form,'cancelled','Carga cancelada. Puedes reintentar el mismo archivo.');
    setBusy(form,false);if(cancel)cancel.hidden=true;if(progress)progress.hidden=true;};
  xhr.open('POST',form.action);xhr.send(new FormData(form));
}
document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!(form instanceof HTMLFormElement)||!form.action.includes('/api/admin/content/'))return;
  event.preventDefault();clearError(form);
  if(form.dataset.contentUpload!==undefined){upload(form);return;}
  setBusy(form,true);
  try{
    const body=new URLSearchParams();
    for(const [key,value] of new FormData(form))body.append(key,String(value));
    const response=await fetch(form.action,{method:'POST',body,credentials:'same-origin'});
    if(response.ok){navigateOnSuccess(response.url);return;}
    const payload=await response.json().catch(()=>({}));
    showError(form,String(payload.code??'content_error'),String(payload.error??''));
  }catch{showError(form,'temporary_error','No se pudo completar la acción. Puedes reintentar.');}
  finally{setBusy(form,false);}
});
document.addEventListener('change',event=>{
  const input=event.target;
  if(!(input instanceof HTMLInputElement)||input.type!=='file')return;
  const form=input.closest<HTMLFormElement>('form[data-content-upload]');
  const key=form?.querySelector<HTMLInputElement>('input[name=requestKey]');
  if(key)key.value=crypto.randomUUID();
});
