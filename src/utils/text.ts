/**
 * Strip markdown code fences from LLM output before parsing.
 * Handles ```json ... ``` and ``` ... ``` patterns (K003).
 *
 * Shared between modules that parse LLM JSON responses (engine, praise-quarantine).
 */
export function stripFences(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  return match ? match[1]!.trim() : text.trim();
}
