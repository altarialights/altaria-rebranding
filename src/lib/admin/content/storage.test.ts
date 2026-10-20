import {randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {mockLocalStorage} from './storage';

describe('Content OS, almacenamiento local privado TEST',()=>{
  it('guarda, verifica lectura y elimina bytes sintéticos con clave opaca',async()=>{
    const key=`${randomUUID()}/${randomUUID()}.png`;
    const bytes=new Uint8Array([137,80,78,71,13,10,26,10,0]);
    await mockLocalStorage.put(key,bytes);
    try{
      expect(Array.from(await mockLocalStorage.read(key))).toEqual(Array.from(bytes));
      await expect(mockLocalStorage.put(key,bytes)).rejects.toThrow();
    }finally{await mockLocalStorage.remove(key);}
    await expect(mockLocalStorage.read(key)).rejects.toThrow();
    await expect(mockLocalStorage.read('../.env')).rejects.toMatchObject({code:'invalid_storage_key'});
  });
});
