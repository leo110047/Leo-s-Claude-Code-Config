declare module 'diff' {
  export type Change = {
    value: string;
    added?: boolean;
    removed?: boolean;
    count?: number;
  };

  export function diffLines(
    oldText: string,
    newText: string,
    options?: unknown,
  ): Change[];
}
