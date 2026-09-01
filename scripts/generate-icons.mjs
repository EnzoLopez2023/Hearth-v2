import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "src/client/public");
const MASTER_PATH = path.join(PUBLIC_DIR, "app-icon-1024.png");
const MASTER_HASH = "acafb62175cd3742a2b8c988249b62934e3d5de7a192a9732248b4fcff8ebdf7";
const MASTER_SIZE = 1024;
const CHECK_MODE = process.argv.includes("--check");
const UNKNOWN_ARGUMENTS = process.argv.slice(2).filter((argument) => argument !== "--check");

const DERIVATIVE_SIZES = new Map([
  ["apple-touch-icon.png", 180],
  ["favicon-32x32.png", 32],
  ["icon-192.png", 192],
  ["icon-512.png", 512]
]);

const MANIFEST = `${JSON.stringify({
  name: "Hearth",
  short_name: "Hearth",
  start_url: "/",
  display: "standalone",
  background_color: "#f7f1e8",
  theme_color: "#5c2a4a",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" }
  ]
}, null, 2)}\n`;

const EXPECTED_REFERENCES = new Map([
  ["src/client/App.tsx", new Set(["/icon-192.png"])],
  ["src/client/index.html", new Set([
    "/apple-touch-icon.png",
    "/favicon-32x32.png",
    "/favicon.ico",
    "/site.webmanifest"
  ])],
  ["src/client/public/site.webmanifest", new Set(["/icon-192.png", "/icon-512.png"])]
]);

const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".jsx", ".ts", ".tsx", ".webmanifest"]);
const IDENTITY_FILE_PATTERN = /brand|favicon|icon|logo|wordmark|(?:^|[-_.])mark(?:[-_.0-9]|$)/i;
const IDENTITY_REFERENCE_PATTERN = /(?<![A-Za-z0-9_./-])(?:https?:\/\/[A-Za-z0-9_.:-]+)?(?:\.\.?\/|\/)?(?:[A-Za-z0-9_./-]*(?:brand|favicon|icon|logo|mark|wordmark)[A-Za-z0-9_./-]*\.(?:avif|ico|jpe?g|png|svg|webp)|[A-Za-z0-9_./-]+\.webmanifest)(?:\?[A-Za-z0-9_=&%.-]*)?(?![A-Za-z0-9_./?=&%-])/gi;
const SKIPPED_DIRECTORIES = new Set([".git", "coverage", "dist", "node_modules", "storage"]);

if (UNKNOWN_ARGUMENTS.length > 0) {
  throw new Error(`Unknown argument${UNKNOWN_ARGUMENTS.length === 1 ? "" : "s"}: ${UNKNOWN_ARGUMENTS.join(", ")}`);
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function zlibStore(bytes) {
  const parts = [Buffer.from([0x78, 0x01])];
  for (let offset = 0; offset < bytes.length; offset += 65535) {
    const length = Math.min(65535, bytes.length - offset);
    const header = Buffer.alloc(5);
    header[0] = offset + length === bytes.length ? 0x01 : 0x00;
    header.writeUInt16LE(length, 1);
    header.writeUInt16LE((~length) & 0xffff, 3);
    parts.push(header, bytes.subarray(offset, offset + length));
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(adler32(bytes), 0);
  parts.push(checksum);
  return Buffer.concat(parts);
}

function encodePng(width, height, pixels) {
  const rowLength = width * 3;
  const scanlines = Buffer.alloc((rowLength + 1) * height);
  for (let y = 0; y < height; y += 1) {
    Buffer.from(pixels.buffer, pixels.byteOffset + y * rowLength, rowLength)
      .copy(scanlines, y * (rowLength + 1) + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlibStore(scanlines)),
    pngChunk("IEND")
  ]);
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodePng(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!bytes.subarray(0, signature.length).equals(signature)) {
    throw new Error("Canonical app icon is not a PNG");
  }

  let offset = signature.length;
  let header;
  let hasTransparency = false;
  const compressedParts = [];

  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([typeBytes, data])) !== expectedCrc) {
      throw new Error(`Canonical app icon has an invalid ${type} checksum`);
    }
    if (type === "IHDR") header = data;
    if (type === "IDAT") compressedParts.push(data);
    if (type === "tRNS") hasTransparency = true;
    offset += length + 12;
    if (type === "IEND") break;
  }

  if (!header || compressedParts.length === 0) {
    throw new Error("Canonical app icon is missing required PNG chunks");
  }

  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bitDepth = header[8];
  const colorType = header[9];
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || header[10] !== 0 || header[11] !== 0 || header[12] !== 0) {
    throw new Error("Canonical app icon must be a non-interlaced 8-bit RGB or RGBA PNG");
  }

  const channels = colorType === 2 ? 3 : 4;
  const rowLength = width * channels;
  const filtered = inflateSync(Buffer.concat(compressedParts));
  if (filtered.length !== (rowLength + 1) * height) {
    throw new Error("Canonical app icon pixel data has an unexpected length");
  }

  const unfiltered = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[y * (rowLength + 1)];
    if (filter > 4) throw new Error(`Canonical app icon uses unsupported PNG filter ${filter}`);
    for (let x = 0; x < rowLength; x += 1) {
      const raw = filtered[y * (rowLength + 1) + x + 1];
      const outputIndex = y * rowLength + x;
      const left = x >= channels ? unfiltered[outputIndex - channels] : 0;
      const above = y > 0 ? unfiltered[outputIndex - rowLength] : 0;
      const upperLeft = y > 0 && x >= channels ? unfiltered[outputIndex - rowLength - channels] : 0;
      const prediction = filter === 1
        ? left
        : filter === 2
          ? above
          : filter === 3
            ? Math.floor((left + above) / 2)
            : filter === 4
              ? paeth(left, above, upperLeft)
              : 0;
      unfiltered[outputIndex] = (raw + prediction) & 0xff;
    }
  }

  const pixels = new Uint8Array(width * height * 3);
  let opaque = !hasTransparency;
  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < unfiltered.length; sourceIndex += channels, targetIndex += 3) {
    pixels[targetIndex] = unfiltered[sourceIndex];
    pixels[targetIndex + 1] = unfiltered[sourceIndex + 1];
    pixels[targetIndex + 2] = unfiltered[sourceIndex + 2];
    if (channels === 4 && unfiltered[sourceIndex + 3] !== 255) opaque = false;
  }

  return { width, height, opaque, pixels };
}

function contributions(sourceSize, targetSize) {
  return Array.from({ length: targetSize }, (_, targetIndex) => {
    const start = targetIndex * sourceSize;
    const end = (targetIndex + 1) * sourceSize;
    const firstSource = Math.floor(start / targetSize);
    const lastSource = Math.ceil(end / targetSize);
    const values = [];
    for (let sourceIndex = firstSource; sourceIndex < lastSource; sourceIndex += 1) {
      const overlap = Math.min(end, (sourceIndex + 1) * targetSize) - Math.max(start, sourceIndex * targetSize);
      if (overlap > 0) values.push([sourceIndex, overlap]);
    }
    return values;
  });
}

function resizeRgb(image, size) {
  const horizontal = contributions(image.width, size);
  const vertical = contributions(image.height, size);
  const denominator = image.width * image.height;
  const output = new Uint8Array(size * size * 3);

  for (let targetY = 0; targetY < size; targetY += 1) {
    for (let targetX = 0; targetX < size; targetX += 1) {
      const outputIndex = (targetY * size + targetX) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        let weighted = 0;
        for (const [sourceY, verticalWeight] of vertical[targetY]) {
          for (const [sourceX, horizontalWeight] of horizontal[targetX]) {
            const sourceIndex = (sourceY * image.width + sourceX) * 3 + channel;
            weighted += image.pixels[sourceIndex] * verticalWeight * horizontalWeight;
          }
        }
        output[outputIndex + channel] = Math.floor((weighted + denominator / 2) / denominator);
      }
    }
  }
  return output;
}

function encodeIco(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 32;
  header[7] = 32;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);
  return Buffer.concat([header, png]);
}

async function loadMaster() {
  const bytes = await readFile(MASTER_PATH);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== MASTER_HASH) {
    throw new Error(`Canonical app icon SHA-256 drifted: expected ${MASTER_HASH}, received ${actualHash}`);
  }

  const image = decodePng(bytes);
  if (image.width !== MASTER_SIZE || image.height !== MASTER_SIZE) {
    throw new Error(`Canonical app icon must be ${MASTER_SIZE}x${MASTER_SIZE}, received ${image.width}x${image.height}`);
  }
  if (!image.opaque) throw new Error("Canonical app icon must be fully opaque");
  return image;
}

function createOutputs(image) {
  const outputs = new Map();
  for (const [file, size] of DERIVATIVE_SIZES) {
    outputs.set(file, encodePng(size, size, resizeRgb(image, size)));
  }
  outputs.set("favicon.ico", encodeIco(outputs.get("favicon-32x32.png")));
  outputs.set("site.webmanifest", Buffer.from(MANIFEST));
  return outputs;
}

async function walk(directory, relativeDirectory = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

async function verifyGeneratedBytes(outputs) {
  const errors = [];
  for (const [file, expected] of outputs) {
    try {
      const actual = await readFile(path.join(PUBLIC_DIR, file));
      if (!actual.equals(expected)) errors.push(`${file} does not match its deterministic derivative`);
    } catch (error) {
      if (error?.code === "ENOENT") errors.push(`${file} is missing`);
      else throw error;
    }
  }
  return errors;
}

async function verifyIdentityFiles(outputs) {
  const allowed = new Set([
    "src/client/public/app-icon-1024.png",
    ...Array.from(outputs.keys(), (file) => `src/client/public/${file}`)
  ]);
  const files = await walk(ROOT);
  return files
    .filter((file) => {
      const extension = path.extname(file).toLowerCase();
      return extension === ".webmanifest"
        || [".avif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp"].includes(extension)
          && IDENTITY_FILE_PATTERN.test(path.basename(file));
    })
    .filter((file) => !allowed.has(file))
    .map((file) => `${file} is an undeclared alternate identity file`);
}

async function verifyReferences() {
  const errors = [];
  const seen = new Map();
  const clientRoot = path.join(ROOT, "src/client");
  for (const relativeFile of await walk(clientRoot)) {
    if (!TEXT_EXTENSIONS.has(path.extname(relativeFile).toLowerCase())) continue;
    const repositoryFile = `src/client/${relativeFile}`;
    const contents = await readFile(path.join(clientRoot, relativeFile), "utf8");
    const references = new Set(contents.match(IDENTITY_REFERENCE_PATTERN) ?? []);
    if (references.size === 0) continue;
    seen.set(repositoryFile, references);
    const allowed = EXPECTED_REFERENCES.get(repositoryFile) ?? new Set();
    for (const reference of references) {
      if (!allowed.has(reference)) errors.push(`${repositoryFile} contains undeclared identity reference ${reference}`);
    }
  }

  for (const [file, expected] of EXPECTED_REFERENCES) {
    const actual = seen.get(file) ?? new Set();
    for (const reference of expected) {
      if (!actual.has(reference)) errors.push(`${file} is missing required identity reference ${reference}`);
    }
  }
  return errors;
}

async function verifyManagedState(outputs) {
  const errors = [
    ...await verifyGeneratedBytes(outputs),
    ...await verifyIdentityFiles(outputs),
    ...await verifyReferences()
  ];
  if (errors.length > 0) {
    throw new Error(`Icon drift detected:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

const image = await loadMaster();
const outputs = createOutputs(image);

if (!CHECK_MODE) {
  await mkdir(PUBLIC_DIR, { recursive: true });
  await Promise.all(Array.from(outputs, ([file, bytes]) => writeFile(path.join(PUBLIC_DIR, file), bytes)));
}

await verifyManagedState(outputs);
console.log(CHECK_MODE ? "Hearth icon system is canonical and drift-free." : "Generated Hearth icon derivatives.");
