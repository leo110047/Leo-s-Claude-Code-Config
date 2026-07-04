export type ToolResult<T> = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: T;
};

export function jsonToolResult<T>(payload: T): ToolResult<T> {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}
