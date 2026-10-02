import { ARTWORK_MAX_BYTES, ARTWORK_MAX_PIXELS, ARTWORK_TYPES, assessArtwork, artworkPath, type CardArtwork, type ArtworkLayout } from '../lib/orders/artwork';
export function initCardsArtwork(onSaved: (file: CardArtwork | undefined) => void, currentFile: () => CardArtwork | undefined) {
  const modal = document.querySelector<HTMLDialogElement>('[data-artwork-modal]')!;
  const q = <T extends HTMLElement>(s:string) => modal.querySelector<T>(s)!;
  const input = q<HTMLInputElement>('[data-artwork-input]'), preview = q<HTMLImageElement>('[data-artwork-preview]');
  const status = q('[data-artwork-status]'), save = q<HTMLButtonElement>('[data-artwork-save]'), remove = q<HTMLButtonElement>('[data-artwork-remove]');
  let selected: File | null = null, objectUrl = '', opener: HTMLElement | null = null, overflow = '', revision = 0, busy = false;
  const layout = (): ArtworkLayout => ({fit:q<HTMLInputElement>('[name="artworkFit"]:checked').value as 'contain'|'cover',x:Number(q<HTMLInputElement>('[data-artwork-x]').value),y:Number(q<HTMLInputElement>('[data-artwork-y]').value)});
  const setBusy = (value:boolean) => { busy=value; save.disabled=value||!selected; input.disabled=value; remove.disabled=value; modal.setAttribute('aria-busy',String(value)); };
  const render = () => {
    if (!selected) return;
    const view=layout(), result=assessArtwork(preview.naturalWidth,preview.naturalHeight,view);
    preview.style.objectFit=view.fit === 'contain'?'scale-down':'cover'; preview.style.objectPosition=`${view.x}% ${view.y}%`;
    q('[data-artwork-position]').hidden=view.fit!=='cover';
    status.textContent=`${selected.name} · ${preview.naturalWidth} × ${preview.naturalHeight} px. ${result.warnings.join(' ')}`;
    save.textContent=result.status==='review'?'Enviar para revisión':'Guardar diseño';
    save.disabled=busy;
  };
  const show = async (file:File) => {
    const version=++revision; selected=null; save.disabled=true; q('[data-artwork-frame]').hidden=true;q('[data-artwork-layout]').hidden=true;
    if(objectUrl)URL.revokeObjectURL(objectUrl);
    if(!ARTWORK_TYPES.includes(file.type)||file.size>ARTWORK_MAX_BYTES){status.textContent='Elige un PNG, JPG o WebP de máximo 2 MB.';return;}
    objectUrl=URL.createObjectURL(file);preview.src=objectUrl;
    try {await preview.decode();if(version!==revision)return;
      if(preview.naturalWidth*preview.naturalHeight>ARTWORK_MAX_PIXELS)throw new Error();
      selected=file;q('[data-artwork-frame]').hidden=false;q('[data-artwork-layout]').hidden=false;render();
    }catch{if(version===revision)status.textContent='No se puede abrir esta imagen o supera 40 megapíxeles.';}
  };
  const close=()=>{if(!busy)modal.close();};
  modal.querySelectorAll('[data-artwork-close]').forEach(b=>b.addEventListener('click',close));
  modal.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  modal.addEventListener('close',()=>{document.body.style.overflow=overflow;opener?.focus();});
  modal.querySelectorAll('[name="artworkFit"], [data-artwork-x], [data-artwork-y]').forEach(el=>el.addEventListener('input',render));
  input.addEventListener('change',()=>{const file=input.files?.[0];if(file)void show(file);});
  remove.addEventListener('click',async()=>{
    const file=currentFile();if(!file||busy)return;setBusy(true);
    try{const response=await fetch(artworkPath(file.token),{method:'DELETE',credentials:'same-origin'});if(!response.ok)throw new Error((await response.json()).error);
      onSaved(undefined);selected=null;input.value='';q('[data-artwork-frame]').hidden=true;q('[data-artwork-layout]').hidden=true;remove.hidden=true;status.textContent='Diseño eliminado. Adjunta otro archivo o elige diseño por Altaria.';
    }catch(error){status.textContent=error instanceof Error?error.message:'No se ha podido eliminar.';}finally{setBusy(false);}
  });
  save.addEventListener('click',async()=>{
    if(!selected||busy)return;setBusy(true);status.textContent='Guardando el original…';
    try{const old=currentFile();const body=new FormData();body.append('file',selected);body.append('layout',JSON.stringify(layout()));
      const response=await fetch('/api/tarjetas/diseno',{method:'POST',body,credentials:'same-origin'});const result=await response.json();
      if(!response.ok)throw new Error(result.error||'No se ha podido guardar el diseño.');
      if(!/^[a-f0-9]{64}$/.test(result.token)||typeof result.filename!=='string')throw new Error('Respuesta de subida no válida.');
      onSaved(result);remove.hidden=false;
      if(old&&old.token!==result.token)await fetch(artworkPath(old.token),{method:'DELETE',credentials:'same-origin'}).catch(()=>undefined);
      setBusy(false);close();
    }catch(error){status.textContent=error instanceof Error?error.message:'No se ha podido guardar.';}finally{setBusy(false);}
  });
  return { async open(trigger:HTMLElement){opener=trigger;overflow=document.body.style.overflow;document.body.style.overflow='hidden';modal.showModal();input.focus();
    const file=currentFile();remove.hidden=!file;
    if(file){setBusy(true);try{const response=await fetch(artworkPath(file.token),{credentials:'same-origin'});if(!response.ok)throw new Error('No se puede recuperar este diseño. La sesión puede haber caducado; vuelve a adjuntarlo.');
      const saved=file.layout??{fit:'contain',x:50,y:50};q<HTMLInputElement>(`[name="artworkFit"][value="${saved.fit==='cover'?'cover':'contain'}"]`).checked=true;q<HTMLInputElement>('[data-artwork-x]').value=String(saved.x);q<HTMLInputElement>('[data-artwork-y]').value=String(saved.y);
      await show(new File([await response.blob()],file.filename,{type:response.headers.get('content-type')??'image/png'}));
    }catch(error){status.textContent=(error as Error).message;}finally{setBusy(false);}}
  } };
}
