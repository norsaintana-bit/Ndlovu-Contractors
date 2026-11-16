import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('index.html', 'dist/index.html');
await cp('styles.css', 'dist/styles.css');
await cp('script.js', 'dist/script.js');
await cp('admin.html', 'dist/admin.html');
await cp('admin.js', 'dist/admin.js');
await cp('admin.css', 'dist/admin.css');
await cp('favicon.svg', 'dist/favicon.svg');
await cp('public/ndlovu-logo-chrome.png', 'dist/ndlovu-logo-chrome.png');
await cp('public/manus-routes.json', 'dist/manus-routes.json');
await cp('public/portfolio', 'dist/portfolio', { recursive: true });
console.log('Built static site to dist/');
