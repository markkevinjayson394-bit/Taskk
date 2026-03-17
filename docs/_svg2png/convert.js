const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const srcDir = 'C:/Users/miptac/time-management-app/docs/mockups';
const outDir = 'C:/Users/miptac/time-management-app/docs/mockups-png';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.svg'));

(async () => {
  for (const file of files) {
    const inPath = path.join(srcDir, file);
    const base = path.basename(file, '.svg');
    const outPath = path.join(outDir, base + '.png');
    try {
      await sharp(inPath, { density: 300 })
        .resize({ width: 720 })
        .png({ compressionLevel: 9 })
        .toFile(outPath);
      console.log('OK', file);
    } catch (err) {
      console.log('FAIL', file, err.message);
    }
  }
})();
