// Dirección del Worker. La da Cloudflare al desplegar.
export const API = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'http://localhost:8787'
  : 'https://tenfe.SUBDOMINIO.workers.dev';
