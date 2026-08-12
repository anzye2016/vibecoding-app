const fs = require("fs");
const zlib = require("zlib");

const W = 1024, H = 1024;

function crc32(buf) {
  let c;
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

// Build RGBA pixel data: black background with white "O"
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  const row = y * (W * 4 + 1);
  raw[row] = 0; // filter byte
  for (let x = 0; x < W; x++) {
    const cx = (x - W / 2);
    const cy = (y - H / 2);
    const r = Math.sqrt(cx * cx + cy * cy);
    const outer = W * 0.42;
    const inner = W * 0.30;
    const onCircle = r <= outer && r >= inner;
    const offset = row + 1 + x * 4;
    if (onCircle) {
      raw[offset] = 255;
      raw[offset + 1] = 255;
      raw[offset + 2] = 255;
      raw[offset + 3] = 255;
    } else {
      raw[offset] = 10;
      raw[offset + 1] = 10;
      raw[offset + 2] = 10;
      raw[offset + 3] = 255;
    }
  }
}

const compressed = zlib.deflateSync(raw);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", compressed),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.writeFileSync(process.argv[2] || "icon.png", png);
console.log("icon created: " + ((png.length / 1024) | 0) + " KB");
