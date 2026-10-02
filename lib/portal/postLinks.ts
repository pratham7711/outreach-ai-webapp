/**
 * The links in whatever a creator pasted into "Submit your posts".
 *
 * People paste a column out of a notes app, a message with prose around the
 * links, or several links on one line separated by commas. Each http(s) link is
 * taken in order, once, with the punctuation a sentence leaves on its end
 * trimmed off. Which platform each one is for is lib/platforms/postUrl's job.
 */
export function splitLinks(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s,<>"']+/gi) ?? [];
  return [...new Set(found.map((u) => u.replace(/[).,;]+$/, "")))];
}
