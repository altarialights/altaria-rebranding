import {describe,expect,it} from 'vitest';
import {contentFormError} from './http';

describe('errores de formularios editoriales',()=>{
  const url='http://127.0.0.1:4321/api/admin/content/upload';
  it('devuelve JSON a clientes API y redirige formularios HTML a una ruta propia',()=>{
    const api=contentFormError(new Request(url), 'unsupported_media',400,'Formato no admitido');
    expect(api.status).toBe(400);
    const form=contentFormError(new Request(url,{headers:{accept:'text/html',
      referer:'http://127.0.0.1:4321/admin/contenido/biblioteca?marca=altaria-cards'}}),
    'unsupported_media',400,'Formato no admitido');
    expect(form.status).toBe(303);
    expect(form.headers.get('location')).toContain('/admin/contenido/biblioteca?marca=altaria-cards&error=unsupported_media');
  });
  it('ignora referencias externas o malformadas',()=>{
    for(const referer of ['https://example.com/admin/contenido/piezas/x','not a URL']){
      const result=contentFormError(new Request(url,{headers:{accept:'text/html',referer}}),
        'forbidden',403,'Denegado');
      expect(result.headers.get('location')).toBe('http://127.0.0.1:4321/admin/contenido/produccion?error=forbidden');
    }
  });
});
