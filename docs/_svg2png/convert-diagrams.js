const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const srcDir = 'C:/Users/miptac/time-management-app/docs/diagrams';
const outDir = 'C:/Users/miptac/time-management-app/docs/diagrams-png';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.svg'));

(async () => {
  for (const file of files) {
    const inPath = path.join(srcDir, file);
    const base = path.basename(file, '.svg');
    const outPath = path.join(outDir, base + '.png');
    await sharp(inPath, { density: 200 })
      .png({ compressionLevel: 9 })
      .toFile(outPath);
    console.log('Converted', file, '->', outPath);
  }
})();
