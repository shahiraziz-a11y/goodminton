// Render public/icons/logo.svg to the PNG app icons: node scripts/render-icons.js public/icons (needs Playwright).
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs');
(async () => {
  const [dir] = process.argv.slice(2);
  const svg = fs.readFileSync(dir + '/logo.svg', 'utf8');
  const b = await chromium.launch(); const p = await b.newPage();
  const render = async (name, size, pad = 0, bg = 'transparent', square = false) => {
    const inner = size - pad * 2;
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:${bg}"><div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">${(square ? svg.replace(/rx="4[56]"/g, 'rx="0"').replace(/<rect x="1" y="1"[^>]*\/>/, '') : svg).replace('width="200" height="200"', `width="${inner}" height="${inner}"`)}</div></body></html>`);
    await p.screenshot({ path: `${dir}/${name}`, omitBackground: bg === 'transparent' });
  };
  await render('favicon-32.png', 32); await render('icon-192.png', 192); await render('icon-512.png', 512);
  // iPhone and maskable icons fill the square (no rounded transparent corners); maskable keeps the logo in the safe zone.
  await render('apple-touch-icon.png', 180, 0, '#0A3E27', true);
  await render('icon-maskable-512.png', 512, 0, '#0E4A30', true);
  await b.close();
})();
