import { vi } from 'vitest';

vi.stubGlobal('fetch', () => Promise.reject(new Error('Las pruebas unitarias no permiten red externa.')));
