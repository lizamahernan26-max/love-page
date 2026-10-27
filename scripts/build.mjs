import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isPublicFile } from './serve.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function ensureDirectory(path) {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Build destination is not a regular directory: ${path}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(path);
  }
}

export async function build(root = projectRoot) {
  const destination = join(root, 'dist');
  await ensureDirectory(destination);
  async function validateOutput(relative = '') {
    for (const entry of await readdir(join(destination, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Unexpected link in dist; move it before building: ${path}`);
      if (entry.isDirectory()) await validateOutput(path);
      else if (!entry.isFile() || !isPublicFile(path)) throw new Error(`Unexpected file in dist; move it before building: ${path}`);
    }
  }
  // Never delete an existing file to make a build pass, and never package a secret accidentally.
  await validateOutput();
  const files = ['index.html', 'pianai.mp3'];
  async function collect(relative) {
    const source = join(root, relative);
    const info = await lstat(source);
    if (info.isSymbolicLink()) throw new Error(`Symbolic links are excluded from the build: ${relative}`);
    if (info.isDirectory()) {
      for (const entry of await readdir(source)) {
        if (!entry.startsWith('.')) await collect(`${relative}/${entry}`);
      }
    } else if (info.isFile() && isPublicFile(relative)) files.push(relative);
  }
  for (const directory of ['js', 'styles', 'assets']) await collect(directory);
  for (const file of files) {
    const input = join(root, file);
    const info = await lstat(input);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Not a regular source file: ${file}`);
    let folder = destination;
    for (const part of file.split('/').slice(0, -1)) {
      folder = join(folder, part);
      await ensureDirectory(folder);
    }
    const output = join(destination, file);
    try {
      const target = await lstat(output);
      if (!target.isFile() || target.isSymbolicLink()) throw new Error(`Not a regular destination file: ${file}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await copyFile(input, output);
  }
  return { directory: destination, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await build();
    console.log(`Built ${result.files.length} public files into ${result.directory}`);
    console.log('Local static output only. Nothing has been published.');
  } catch (error) {
    console.error(`Build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
