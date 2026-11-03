import { closeSync, fsyncSync, openSync, readFileSync, statSync, writeSync } from 'node:fs';
import { LmcodeError } from '../core/errors.mjs';
import { makeHandle } from './collections.mjs';

const host = (message) => { throw new LmcodeError('RUN_HOST', message); };
const textPath = (value, functionName) => {
  if (value.includes('\0')) host(`${functionName}: ${value}: invalid path`);
  const bytes = Buffer.from(value, 'latin1');
  if (process.platform !== 'win32') return bytes;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { host(`${functionName}: ${value}: invalid path`); }
};
function regularPath(name, functionName, allowMissing = false) {
  const path = textPath(name, functionName);
  try {
    const stat = statSync(path);
    if (!stat.isFile()) host(`${functionName}: ${name}: invalid argument`);
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return path;
    if (error instanceof LmcodeError) throw error;
    host(`${functionName}: ${name}: ${error.message || 'file operation failed'}`);
  }
  return path;
}

export function registerFile(reg) {
  const fileRead = (name) => {
    const p = regularPath(name, 'file_read');
    return readFileSync(p).toString('latin1');
  };
  reg.fn('fn file_read(string) -> string', fileRead, { internal: true, dry: fileRead });
  reg.fn('fn file_write(string, string) -> void', (name, content) => {
    const p = regularPath(name, 'file_write', true);
    let fd;
    try {
      fd = openSync(p, 'w');
      const data = Buffer.from(content, 'latin1');
      let offset = 0;
      while (offset < data.length) {
        const wrote = writeSync(fd, data, offset, data.length - offset);
        if (wrote <= 0) throw new Error('short write');
        offset += wrote;
      }
      fsyncSync(fd);
    } catch (error) {
      if (error instanceof LmcodeError) throw error;
      host(`file_write: ${name}: ${error.message || 'file operation failed'}`);
    } finally { if (fd !== undefined) closeSync(fd); }
  }, { internal: true });
  reg.fn('fn file_append(string, string) -> void', (name, content) => {
    const p = regularPath(name, 'file_append', true);
    let fd;
    try {
      fd = openSync(p, 'a');
      const data = Buffer.from(content, 'latin1');
      let offset = 0;
      while (offset < data.length) {
        const wrote = writeSync(fd, data, offset, data.length - offset);
        if (wrote <= 0) throw new Error('short write');
        offset += wrote;
      }
      fsyncSync(fd);
    } catch (error) {
      if (error instanceof LmcodeError) throw error;
      host(`file_append: ${name}: ${error.message || 'file operation failed'}`);
    } finally { if (fd !== undefined) closeSync(fd); }
  }, { internal: true });
  const fileExists = (name) => {
    const p = textPath(name, 'file_exists');
    try { return statSync(p).isFile(); }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
      host(`file_exists: ${name}: ${error.message || 'file operation failed'}`);
    }
  };
  reg.fn('fn file_exists(string) -> bool', fileExists, { internal: true, dry: fileExists });
  const fileLines = (name) => {
    const p = regularPath(name, 'file_lines');
    const lines = readFileSync(p).toString('latin1').split('\n');
    const list = makeHandle(reg, 'StrList'); list.data.values = lines; return list;
  };
  reg.fn('fn file_lines(string) -> StrList', fileLines, { internal: true, dry: fileLines });
}
