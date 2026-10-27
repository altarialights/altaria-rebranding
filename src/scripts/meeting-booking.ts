interface Slot { start: string; end: string; day: string; time: string }
interface Result { id: string; status: 'pending' | 'confirmed' | 'failed' | 'cancelled'; start: string; end: string; timezone: string; meetUrl: string | null }
const root = document.querySelector<HTMLElement>('[data-meeting-booking]');
if (root) initialize(root);

function initialize(root: HTMLElement) {
  const el = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const form = el<HTMLFormElement>('[data-form]');
  const storeKey = 'altaria-meeting-access-v1';
  let slots: Slot[] = []; let zone = 'Europe/Madrid'; let duration = 30;
  let month = ''; let selectedDay = ''; let selected: Slot | undefined;
  let credentials: {key: string; token: string} | null = null;
  let payload: Record<string,unknown> | null = null;
  let startedAt = Date.now(); let sending = false; let poll: ReturnType<typeof setTimeout> | undefined; let polls = 0;
  const setLive = (text: string) => { el('[data-live]').textContent = text; };
  const error = (text = '') => { const node=el('[data-error]'); node.hidden=!text; node.textContent=text; if(text)node.focus(); };
  const show = (step: string) => {
    root.querySelectorAll<HTMLElement>('[data-step]').forEach(n=>{n.hidden=n.dataset.step!==step;});
    const index = ['schedule','details','review'].indexOf(step);
    root.querySelectorAll<HTMLElement>('[data-progress]').forEach(n=>{
      if(Number(n.dataset.progress)===index)n.setAttribute('aria-current','step');else n.removeAttribute('aria-current');
    });
    el('.meeting-progress').hidden=step==='result';
    error();
    el(`[data-step="${step}"] h3`)?.focus({preventScroll:true});
    el('.meeting-workspace').scrollIntoView({block:'start',behavior:'instant'});
  };
  const dateText = (date: string) => new Intl.DateTimeFormat('es-ES',{timeZone:zone,weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(date));
  const timeText = (date: string) => new Intl.DateTimeFormat('es-ES',{timeZone:zone,hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(date));
  const selectedText = () => selected ? `${dateText(selected.start)} · ${timeText(selected.start)} · ${zone}` : '';
  const newCredentials = () => ({key:crypto.randomUUID(),token:Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('')});
  const save = () => { try { sessionStorage.setItem(storeKey,JSON.stringify(credentials)); } catch { /* in-memory recovery remains available */ } };
  const clear = () => { credentials=null;payload=null;try{sessionStorage.removeItem(storeKey);}catch{/* optional */} };
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(`/api/reuniones/${path}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(55_000)});
    const data = await response.json();
    if(!response.ok) throw Object.assign(new Error(data.error || 'No hemos podido conectar. Inténtalo de nuevo.'),{code:data.code,fields:data.fields});
    return data;
  };
  function addDetail(list: HTMLElement, key: string, value: string) {
    const term=document.createElement('dt'), description=document.createElement('dd');
    term.textContent=key;description.textContent=value;list.append(term,description);
  }
  async function load() {
    el('[data-calendar-area]').hidden=true;el('[data-unavailable]').hidden=true;setLive('Consultando la agenda…');error();
    try {
      const data=await request('disponibilidad');slots=data.slots;zone=data.timezone;duration=data.duration;
      el('[data-duration]').textContent=`${duration} minutos`;
      el('[data-zone]').textContent=`Horas en ${zone}. El horario se ajusta automáticamente al cambio de hora.`;
      if(!slots.length) {el('[data-unavailable]').hidden=false;el('[data-unavailable] strong').textContent='No quedan huecos disponibles en este periodo.';setLive('No hay disponibilidad.');return;}
      month=slots[0].day.slice(0,7);selectedDay=slots[0].day;selected=undefined;
      el<HTMLButtonElement>('[data-to-form]').disabled=true;
      el('[data-calendar-area]').hidden=false;setLive('');renderCalendar();renderTimes();
    }catch(e){el('[data-unavailable]').hidden=false;setLive('');el('[data-unavailable] strong').textContent='La agenda online no está disponible ahora.';}
  }
  function renderCalendar() {
    const [year,m]=month.split('-').map(Number);
    el('[data-month]').textContent=new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(year,m-1,1)));
    const months=[...new Set(slots.map(s=>s.day.slice(0,7)))];
    el<HTMLButtonElement>('[data-prev]').disabled=months.indexOf(month)<=0;
    el<HTMLButtonElement>('[data-next]').disabled=months.indexOf(month)>=months.length-1;
    const grid=el('[data-days]');grid.replaceChildren();
    const offset=(new Date(Date.UTC(year,m-1,1)).getUTCDay()+6)%7;
    for(let i=0;i<offset;i++)grid.append(document.createElement('span'));
    const total=new Date(Date.UTC(year,m,0)).getUTCDate();
    for(let d=1;d<=total;d++) {
      const day=`${month}-${String(d).padStart(2,'0')}`; const button=document.createElement('button');
      button.type='button';button.textContent=String(d);button.disabled=!slots.some(s=>s.day===day);
      button.setAttribute('aria-label',new Intl.DateTimeFormat('es-ES',{dateStyle:'full',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`)));
      button.setAttribute('aria-pressed',String(day===selectedDay));button.dataset.day=day;
      button.addEventListener('click',()=>{selectedDay=day;selected=undefined;el<HTMLButtonElement>('[data-to-form]').disabled=true;
        renderCalendar();renderTimes();grid.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)?.focus();setLive(`Horas disponibles para el día ${d}.`);});
      grid.append(button);
    }
  }
  function renderTimes() {
    const times=el('[data-times]');times.replaceChildren();
    const daily=slots.filter(s=>s.day===selectedDay);
    el('[data-day-title]').textContent=new Intl.DateTimeFormat('es-ES',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${selectedDay}T12:00:00Z`));
    for(const slot of daily) {
      const button=document.createElement('button');button.type='button';button.textContent=slot.time;button.setAttribute('aria-pressed',String(slot.start===selected?.start));
      button.addEventListener('click',()=>{selected=slot;times.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
        el('[data-selection]').textContent=selectedText();el<HTMLButtonElement>('[data-to-form]').disabled=false;setLive(`Has elegido las ${slot.time}.`);});times.append(button);
    }
    el('[data-selection]').textContent='Selecciona una hora para continuar.';
  }
  for(const [selector,delta] of [['[data-prev]',-1],['[data-next]',1]] as const) el(selector).addEventListener('click',()=>{
    const months=[...new Set(slots.map(s=>s.day.slice(0,7)))];month=months[months.indexOf(month)+delta]||month;
    selectedDay=slots.find(s=>s.day.startsWith(month))!.day;selected=undefined;el<HTMLButtonElement>('[data-to-form]').disabled=true;renderCalendar();renderTimes();
  });
  el('[data-days]').addEventListener('keydown',event=>{
    if(!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    const buttons=Array.from(el('[data-days]').querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index=buttons.indexOf(document.activeElement as HTMLButtonElement); if(index<0)return;
    event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:index+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1);
    buttons[Math.max(0,Math.min(buttons.length-1,next))]?.focus();
  });
  el('[data-to-form]').addEventListener('click',()=>{if(!selected)return;el('[data-chosen]').textContent=selectedText();show('details');});
  el('[data-back-calendar]').addEventListener('click',()=>show('schedule'));
  el('[data-back-form]').addEventListener('click',()=>show('details'));
  el('[data-reload]').addEventListener('click',()=>void load());
  form.addEventListener('input',event=>{
    const field=event.target;
    if(!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement))return;
    field.removeAttribute('aria-invalid');
    const hint=root.querySelector(`[data-field-error="${field.name}"]`);
    if(hint)hint.textContent='';
  });
  form.addEventListener('submit',event=>{
    event.preventDefault();error();if(!selected)return;
    root.querySelectorAll<HTMLElement>('[data-field-error]').forEach(n=>n.textContent='');
    form.querySelectorAll('[aria-invalid]').forEach(n=>n.removeAttribute('aria-invalid'));
    let first: HTMLElement | null=null;
    for(const field of Array.from(form.elements)) {
      if(!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement))continue;
      if(!field.checkValidity()) {
        field.setAttribute('aria-invalid','true'); const target=root.querySelector(`[data-field-error="${field.name}"]`);
        if(target)target.textContent=field.name==='privacy'?'Confirma que has leído la política de privacidad.':field.name==='email'?'Introduce un correo electrónico válido.':'Completa este campo con al menos dos caracteres.';
        first ||= field;
      }
    }
    const data=Object.fromEntries(new FormData(form));
    if(!/^(\+|00)[\d\s().-]{7,38}$/.test(String(data.phone).trim())) {
      const input=form.elements.namedItem('phone') as HTMLInputElement;input.setAttribute('aria-invalid','true');
      el('[data-field-error="phone"]').textContent='Incluye el prefijo internacional, por ejemplo +34.';first ||= input;
    }
    if(first){first.focus();return;}
    payload={...data,privacy:true,start:selected.start,startedAt};
    const list=el('[data-review]');list.replaceChildren();
    for(const [label,value] of [['Cuándo',selectedText()],['Duración',`${duration} minutos`],['Nombre',String(data.name)],['Negocio',String(data.business)],['Email',String(data.email)],['Teléfono',String(data.phone)],['Comentario',String(data.comment || 'Sin comentario')]])addDetail(list,label,value);
    show('review');
  });
  function displayResult(booking: Result) {
    zone=booking.timezone;show('result');setLive('');
    const confirmed=booking.status==='confirmed' && !!booking.meetUrl;
    const failed=booking.status==='failed'||booking.status==='cancelled';
    el('[data-result-icon]').textContent=confirmed?'✓':failed?'↺':'◷';
    el('[data-result-title]').textContent=confirmed?'Tu reunión está reservada':failed?'No hemos podido completar la reserva':'Estamos preparando tu reunión';
    el('[data-result-copy]').textContent=confirmed?'El hueco ya es tuyo. Hemos solicitado la invitación a tu correo. Te escribiremos por WhatsApp para confirmar tu asistencia.':failed?'El hueco se ha liberado. Puedes elegir otra hora o contactar directamente con nosotros.':'El hueco está retenido mientras generamos el enlace. Todavía no está confirmada. No reserves otra vez; puedes consultar su estado aquí.';
    const list=el('[data-result-details]');list.replaceChildren();
    addDetail(list,'Fecha',dateText(booking.start));addDetail(list,'Hora',`${timeText(booking.start)} · ${booking.timezone}`);addDetail(list,'Duración',`${(Date.parse(booking.end)-Date.parse(booking.start))/60000} minutos`);addDetail(list,'Referencia',booking.id);
    const link=el<HTMLAnchorElement>('[data-meet]');link.hidden=!confirmed;
    if(confirmed){try{const url=new URL(booking.meetUrl!);if(url.protocol==='https:'&&url.hostname==='meet.google.com')link.href=url.href;else link.hidden=true;}catch{link.hidden=true;}}
    el('[data-status]').hidden=confirmed||failed;el('[data-restart]').hidden=!failed;
    if (booking.status==='cancelled') {
      el('[data-result-title]').textContent='Esta reunión se ha cancelado';
      el('[data-result-copy]').textContent='Puedes elegir otra fecha o contactar con nosotros para acordar una nueva reunión.';
    }
    if(!confirmed&&!failed&&polls<90){clearTimeout(poll);poll=setTimeout(()=>void status(),10_000);}
  }
  async function status() {
    if(!credentials||sending)return;sending=true;polls++;setLive('Consultando el estado…');
    try{displayResult((await request('estado',credentials)).booking);}
    catch(e){setLive('');error(e instanceof Error?e.message:'No podemos consultar el estado ahora.');
      if((e as {code?:string}).code==='not_found'){el('[data-result-copy]').textContent='No se ha registrado ninguna reserva con esta referencia. Puedes volver a elegir un hueco.';el('[data-restart]').hidden=false;}
      else if(polls<90){clearTimeout(poll);poll=setTimeout(()=>void status(),15_000);}
    }finally{sending=false;}
  }
  el('[data-submit]').addEventListener('click',async()=>{
    if(sending||!payload)return;sending=true;error();
    const button=el<HTMLButtonElement>('[data-submit]');button.disabled=true;button.textContent='Preparando tu reunión…';setLive('Estamos revalidando el hueco.');
    credentials ||= newCredentials();save();
    try{displayResult((await request('reservar',{...payload,...credentials})).booking);}
    catch(e){const failure=e as Error & {code?:string;fields?:Record<string,string>};
      if(['validation','invalid_body','invalid_slot','slot_taken','test_attendee'].includes(failure.code||'')){
        clear();if(failure.code==='validation'){show('details');for(const key of Object.keys(failure.fields||{})){const node=root.querySelector(`[data-field-error="${key}"]`);if(node)node.textContent=key==='phone'?'Introduce un teléfono internacional válido.':'Revisa este campo.';}}
        else if(failure.code==='slot_taken'||failure.code==='invalid_slot'){show('schedule');await load();}
        error(failure.message);
      }else{show('result');el('[data-result-title]').textContent='Vamos a comprobar tu solicitud';el('[data-result-copy]').textContent='Se ha interrumpido la conexión. Conservamos tu referencia para comprobar si la reserva se registró antes de intentarlo de nuevo.';el('[data-status]').hidden=false;error(failure.message);clearTimeout(poll);poll=setTimeout(()=>void status(),10_000);}
    }finally{sending=false;button.disabled=false;button.textContent='Confirmar reserva →';setLive('');}
  });
  el('[data-status]').addEventListener('click',()=>void status());
  el('[data-restart]').addEventListener('click',()=>{clearTimeout(poll);clear();polls=0;startedAt=Date.now();form.reset();show('schedule');void load();});
  try { const cached=JSON.parse(sessionStorage.getItem(storeKey)||'null');if(cached && /^[a-f0-9-]{36}$/.test(cached.key)&&/^[a-f0-9]{64}$/.test(cached.token))credentials=cached; } catch {/* no stored reservation */}
  if(credentials){show('result');void status();}else void load();
  window.addEventListener('pagehide',()=>clearTimeout(poll));
}
