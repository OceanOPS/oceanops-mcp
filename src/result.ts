export async function jsonTextResult(work: () => Promise<unknown>) {
  try {
    const value = await work();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}
