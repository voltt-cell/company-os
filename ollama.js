/**
 * Ollama integration for CompanyOS.
 * Connects to locally-running Ollama for AI inference.
 * Prerequisites: ollama pull llama3.1:8b
 */

const OLLAMA_BASE = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";
const TIMEOUT_MS = 120_000;

export async function checkOllamaHealth() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { healthy: false, error: "Ollama returned non-200" };
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    const hasModel = models.some((m) => m.startsWith(DEFAULT_MODEL.split(":")[0]));
    return { healthy: true, models, hasModel, requiredModel: DEFAULT_MODEL };
  } catch (error) {
    return { healthy: false, error: error.message, hint: "Is Ollama running? Try: ollama serve" };
  }
}

export async function chat({ systemPrompt, messages, model, temperature = 0.7, json = false }) {
  const fullMessages = [];
  if (systemPrompt) fullMessages.push({ role: "system", content: systemPrompt });
  fullMessages.push(...messages);

  try {
    const body = {
      model: model || DEFAULT_MODEL,
      messages: fullMessages,
      stream: false,
      options: { temperature }
    };
    if (json) body.format = "json";

    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { content: data.message?.content || "", model: data.model, totalDuration: data.total_duration };
  } catch (error) {
    console.error("Ollama chat failed:", error.message);
    return { content: fallback(messages), model: "fallback", totalDuration: 0, error: error.message };
  }
}

export async function executeTask({ systemPrompt, taskTitle, proposedAction, risk, context }) {
  const prompt = `## Task: ${taskTitle}\n### Action\n${proposedAction}\n### Risk\n${risk}${context ? `\n### Context\n${JSON.stringify(context)}` : ""}\n\nReturn JSON: { files: [{ path, content, action }], commitMessage, summary, risks }`;
  const result = await chat({ systemPrompt, messages: [{ role: "user", content: prompt }], temperature: 0.3, json: true });
  try { return JSON.parse(result.content); } catch { return { summary: result.content, files: [], commitMessage: `chore: ${taskTitle.toLowerCase()}`, risks: ["Non-JSON response"] }; }
}

export async function reviewDiff(diff, taskTitle) {
  const result = await chat({
    systemPrompt: "You are the CEO reviewing code. Return JSON: { approved: boolean, review: string, suggestions: [] }",
    messages: [{ role: "user", content: `Review diff for "${taskTitle}":\n\`\`\`diff\n${diff}\n\`\`\`` }],
    temperature: 0.2, json: true
  });
  try { return JSON.parse(result.content); } catch { return { approved: false, review: result.content, suggestions: [] }; }
}

function fallback(messages) {
  return "I'm currently offline — Ollama isn't responding. Run `ollama serve` and `ollama pull llama3.1:8b` to get me back online!";
}

export default { checkOllamaHealth, chat, executeTask, reviewDiff };
