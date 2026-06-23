import fs from 'fs';
const content = fs.readFileSync('e:/ASAT(Main)/frontend/src/pages/master/MasterProducts.jsx', 'utf8');
const lines = content.split('\n');
console.log(lines.slice(80, 130).join('\n'));
