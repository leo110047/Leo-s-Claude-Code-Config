import { isAbsolute, resolve } from 'node:path';

export function workflowAssetPath(relativePath: string): string {
  if (isAbsolute(relativePath)) return relativePath;
  return resolve(import.meta.dir, '..', relativePath);
}
