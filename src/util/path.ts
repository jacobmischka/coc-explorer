import os from 'os';
import pathLib from 'path';
import { isWindows } from './platform';

/**
 * get extensions and basename
 */
export function getExtensions(filename: string) {
  const parts = pathLib.basename(filename).split('.');
  const [basename, ...extensions] = parts;
  if (basename) {
    return { basename, extensions };
  } else {
    // special case for hidden files
    const [basename2, ...extensions2] = extensions;
    return {
      basename: [basename, basename2].join('.'),
      extensions: extensions2,
    };
  }
}

export function normalizePath(path: string): string {
  let _path = pathLib.normalize(path);
  if (_path[0] === '~') {
    _path = pathLib.join(os.homedir(), _path.slice(1));
  }
  if (isWindows && /[a-z]:/.test(_path)) {
    const driveChar = _path[0];
    _path = driveChar.toUpperCase() + _path.slice(1);
  }
  return _path;
}

export function isParentFolder(folder: string, filepath: string): boolean {
  let finalFolder = normalizePath(pathLib.resolve(folder));
  const finalFilepath = normalizePath(pathLib.resolve(filepath));
  if (finalFolder === '//') finalFolder = '/';
  if (finalFolder.endsWith(pathLib.sep))
    return finalFilepath.startsWith(finalFolder);
  return (
    finalFilepath.startsWith(finalFolder) &&
    finalFilepath[finalFolder.length] === pathLib.sep
  );
}
