// Ponto único de entrada da API. O vercel.json reescreve /api/* para aqui (ver `resolvePath` em lib/handler.js).
import { handle } from '../lib/handler.js';
export default handle;
