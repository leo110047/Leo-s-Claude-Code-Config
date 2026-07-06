#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  CLAUDE_DESKTOP_EXTENSION_PACKAGE_PATH,
  CLAUDE_DESKTOP_EXTENSION_ROOT_PATH,
} from './lib/app-support-distribution.mjs';

const outputArgIndex = process.argv.indexOf('--output');
const outputPath =
  outputArgIndex === -1
    ? CLAUDE_DESKTOP_EXTENSION_PACKAGE_PATH
    : path.resolve(process.argv[outputArgIndex + 1] || '');

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

main();

function main() {
  if (!fs.existsSync(CLAUDE_DESKTOP_EXTENSION_ROOT_PATH)) {
    console.error(
      `Claude Desktop extension source missing: ${CLAUDE_DESKTOP_EXTENSION_ROOT_PATH}`,
    );
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  writeZip(outputPath, collectFiles(CLAUDE_DESKTOP_EXTENSION_ROOT_PATH));
  console.log(`[OK] Claude Desktop MCPB package built: ${outputPath}`);
}

function collectFiles(rootDir) {
  return listFiles(rootDir).map((filePath) => ({
    name: toZipPath(path.relative(rootDir, filePath)),
    data: fs.readFileSync(filePath),
  }));
}

function listFiles(rootDir) {
  const files = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') {
      continue;
    }
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function toZipPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function writeZip(filePath, files) {
  const localRecords = [];
  const centralRecords = [];
  let offset = 0;

  for (const file of files) {
    const record = buildZipRecord(file, offset);
    localRecords.push(record.local, record.name, record.data);
    centralRecords.push(record.central, record.name);
    offset += record.local.length + record.name.length + record.data.length;
  }

  const centralStart = offset;
  const centralSize = centralRecords.reduce(
    (total, record) => total + record.length,
    0,
  );
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);

  fs.writeFileSync(
    filePath,
    Buffer.concat([...localRecords, ...centralRecords, end]),
  );
}

function buildZipRecord(file, offset) {
  const name = Buffer.from(file.name);
  const data = file.data;
  const crc = crc32(data);
  return {
    name,
    data,
    local: buildLocalHeader(name, data, crc),
    central: buildCentralHeader(name, data, crc, offset),
  };
}

function buildLocalHeader(name, data, crc) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function buildCentralHeader(name, data, crc, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
