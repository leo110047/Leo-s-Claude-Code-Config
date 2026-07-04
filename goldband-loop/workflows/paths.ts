import { isAbsolute, resolve } from 'node:path';

export function workflowAssetPath(sourceTemplate: string): string {
  if (isAbsolute(sourceTemplate)) return sourceTemplate;
  return resolve(import.meta.dir, '..', sourceTemplate);
}
