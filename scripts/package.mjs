import { readdir, readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import path from "node:path";
// Portable ZIP (stored entries): no shell zip utility, credentials, workspace, or node_modules.
const allowed = [
  "dist",
  "web-dist",
  "plugin",
  "docs",
  "scripts",
  "README.md",
  "LICENSE",
  "THIRD-PARTY-NOTICES.txt",
  "package.json",
  "package-lock.json",
  ".nvmrc",
];
const entries = [];
async function walk(name) {
  const portable = name.split(path.sep).join("/");
  if (portable === "plugin/mod/config.json" || portable === "plugin/mod/tsconfig.json" || portable.startsWith("plugin/mod/.claude-plugin/types") || portable.endsWith("/.testforce-install.json")) return;
  const stat = await lstat(name);
  if (stat.isSymbolicLink()) throw Error(`Symlink forbidden: ${name}`);
  if (stat.isDirectory()) {
    for (const child of await readdir(name)) await walk(path.join(name, child));
    return;
  }
  entries.push({
    name: "salesforce-sandbox-workbench/" + name.split(path.sep).join("/"),
    data: await readFile(name),
  });
}
for (const name of allowed) await walk(name);
const table = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let n = 0xffffffff;
  for (const b of bytes) n = table[(n ^ b) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
const locals = [],
  central = [];
let offset = 0;
for (const entry of entries) {
  const name = Buffer.from(entry.name),
    crc = crc32(entry.data),
    local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(entry.data.length, 18);
  local.writeUInt32LE(entry.data.length, 22);
  local.writeUInt16LE(name.length, 26);
  locals.push(local, name, entry.data);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x800, 8);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(entry.data.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(offset, 42);
  central.push(header, name);
  offset += local.length + name.length + entry.data.length;
}
const directory = Buffer.concat(central),
  end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
await mkdir("artifacts", { recursive: true });
const target = "artifacts/salesforce-sandbox-workbench-0.1.0.zip";
await writeFile(target, Buffer.concat([...locals, directory, end]));
console.log(
  `${target}: ${entries.length} files; dependencies are installed locally with npm ci --omit=dev`,
);
