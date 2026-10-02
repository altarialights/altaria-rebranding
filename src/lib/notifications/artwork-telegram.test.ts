import {describe,it,expect,vi,beforeEach} from 'vitest';
const db=vi.hoisted(()=>({get:vi.fn()}));
vi.mock('../db/client',()=>({getDatabase:()=>db}));
import {createHash} from 'node:crypto';
import {findPaidOrderArtwork} from '../db/card-artwork.repository';
import {sendTelegramMessage} from './telegram.service';
import {notifyPaidCardOrder} from './notification.service';
import type {PedidoTarjetas} from '../orders/types';
const bytes=Buffer.from('original-bytes');
const row={content_base64:bytes.toString('base64'),size_bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),filename:'original.png',mime_type:'image/png',validation_status:'review'};
const order={id:'order-1',numeroPedido:'ALT-1',stripeEntorno:'test',productoNombre:'Tarjeta',negocioNombre:'Prueba',cantidad:1,totalCentimos:2490,clienteNombre:'Prueba',clienteTelefono:'600000000',clienteEmail:'test@example.com',envioDireccion:'Prueba',envioCodigoPostal:'28001',envioCiudad:'Madrid',envioProvincia:'Madrid',personalizacion:{configuracion:{artworkFile:{filename:'original.png',token:'a'.repeat(64),status:'review'}}}} as PedidoTarjetas;
beforeEach(()=>{vi.clearAllMocks();db.get.mockResolvedValue(row);});
describe('Telegram original artwork',()=>{
 it('uploads unchanged bytes as document replying to the order message',async()=>{
 const fetchImplementation=vi.fn<typeof fetch>().mockResolvedValue(Response.json({ok:true,result:{message_id:2}}));
 await sendTelegramMessage('Original',{environment:{botToken:'test',chatId:'private'},fetchImplementation},{bytes,filename:'original.png',mime:'image/png',replyTo:1});
 expect(fetchImplementation.mock.calls[0][0]).toBe('https://api.telegram.org/bottest/sendDocument');
 const form=fetchImplementation.mock.calls[0][1]!.body as FormData;
 expect(form.get('chat_id')).toBe('private');expect(form.get('reply_parameters')).toBe('{"message_id":1}');
 const file=form.get('document') as File;expect(file.name).toBe('original.png');expect(Buffer.from(await file.arrayBuffer()).equals(bytes)).toBe(true);
 });
 it('looks up by paid order relationship and rejects corrupted bytes',async()=>{
 expect(await findPaidOrderArtwork('order-1')).toMatchObject({filename:'original.png'});
 expect(db.get.mock.calls[0][0]).toContain('p.pagado_en IS NOT NULL');expect(db.get.mock.calls[0][1]).toBe('order-1');
 db.get.mockResolvedValue({...row,sha256:'wrong'});await expect(findPaidOrderArtwork('order-1')).rejects.toThrow('integrity');
 });
 it('records attachment failure without throwing after the message is sent',async()=>{
 const fetchImplementation=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ok:true,result:{message_id:1}})).mockResolvedValueOnce(new Response('',{status:500}));
 expect(await notifyPaidCardOrder(order,{environment:{botToken:'test',chatId:'private'},fetchImplementation})).toMatchObject({status:'failed',reason:'http_error'});
 expect(fetchImplementation).toHaveBeenCalledTimes(2);
 });
 it('does not retrieve or send an attachment if the message fails',async()=>{
 const fetchImplementation=vi.fn<typeof fetch>().mockResolvedValue(new Response('',{status:500}));
 await notifyPaidCardOrder(order,{environment:{botToken:'test',chatId:'private'},fetchImplementation});expect(db.get).not.toHaveBeenCalled();
 });
});
