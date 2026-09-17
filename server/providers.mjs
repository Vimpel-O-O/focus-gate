import {limitedText} from './http.mjs';
import {REVIEW_INSTRUCTIONS} from './review-policy.mjs';
import {PROVIDERS, validateProviderConfig} from './provider-config.mjs';

function buildRequest(provider, model, apiKey, input, schema) {
  const json = JSON.stringify(input);
  const headers = {'Content-Type': 'application/json'};
  switch (provider) {
    case 'openai': return {url: 'https://api.openai.com/v1/responses', headers: {...headers, Authorization: `Bearer ${apiKey}`}, body: {model, store: false, max_output_tokens: 700, instructions: REVIEW_INSTRUCTIONS, input: json, text: {format: {type: 'json_schema', name: 'video_relevance', strict: true, schema}}}};
    case 'anthropic': {
      const compatible = structuredClone(schema);
      delete compatible.properties.confidence.minimum;
      delete compatible.properties.confidence.maximum;
      compatible.properties.confidence.description = 'Confidence between 0 and 1 inclusive.';
      return {url: 'https://api.anthropic.com/v1/messages', headers: {...headers, 'x-api-key': apiKey, 'anthropic-version': '2023-06-01'}, body: {model, max_tokens: 700, system: REVIEW_INSTRUCTIONS, messages: [{role: 'user', content: json}], output_config: {format: {type: 'json_schema', schema: compatible}}}};
    }
    case 'gemini': return {url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, headers: {...headers, 'x-goog-api-key': apiKey}, body: {systemInstruction: {parts: [{text: REVIEW_INSTRUCTIONS}]}, contents: [{role: 'user', parts: [{text: json}]}], generationConfig: {candidateCount: 1, maxOutputTokens: 4096, responseMimeType: 'application/json', responseJsonSchema: schema}}};
    case 'xai': return {url: 'https://api.x.ai/v1/chat/completions', headers: {...headers, Authorization: `Bearer ${apiKey}`}, body: {model, max_tokens: 700, messages: [{role: 'system', content: REVIEW_INSTRUCTIONS}, {role: 'user', content: json}], response_format: {type: 'json_schema', json_schema: {name: 'video_relevance', strict: true, schema}}}};
  }
}
function responseText(provider, data) {
  switch (provider) {
    case 'openai': {
      if (data.status !== 'completed') return null;
      const content = (data.output || []).flatMap(item => item.content || []);
      if (content.some(item => item.type === 'refusal')) return null;
      return content.filter(item => item.type === 'output_text').map(item => item.text).join('');
    }
    case 'anthropic':
      if (data.stop_reason !== 'end_turn' || !Array.isArray(data.content) || data.content.some(item => item.type !== 'text')) return null;
      return data.content.map(item => item.text).join('');
    case 'gemini': {
      if (data.promptFeedback?.blockReason || data.candidates?.length !== 1) return null;
      const candidate = data.candidates[0];
      if (candidate.finishReason !== 'STOP' || candidate.safetyRatings?.some(rating => rating.blocked)) return null;
      return (candidate.content?.parts || []).filter(part => !part.thought).map(part => part.text || '').join('');
    }
    case 'xai': {
      if (data.choices?.length !== 1) return null;
      const choice = data.choices[0];
      if (choice.finish_reason !== 'stop' || choice.message?.refusal || choice.message?.tool_calls?.length) return null;
      return choice.message?.content;
    }
  }
}
async function providerError(response, provider) {
  const name = PROVIDERS[provider].label;
  let code = '';
  try {const body = JSON.parse(await limitedText(response, 50000, false)); code = body.error?.code || body.error?.type || ''; } catch {}
  let message = [401,403].includes(response.status) ? `${name} rejected the API key or account access.` : response.status === 429 ? `${name} rate or billing limit reached; check your provider's quota and billing.` : response.status === 400 || response.status === 404 ? `${name} could not use this model or structured-output configuration. Check the model ID and API access.` : `${name} request failed (${response.status}).`;
  if (response.status === 429 && ['insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active'].includes(code)) message = `${name} API quota is unavailable or exhausted. Check credits and usage limits. Waiting alone will not restore exhausted quota.`;
  else if (response.status === 429 && code === 'rate_limit_exceeded') message = `${name} temporarily rate-limited this request. Wait at least a minute before retrying.`;
  return new Error(`${message} Video remains blocked.`);
}
export async function requestDecision(input, schema, {provider = 'openai', model, apiKey, fetcher = fetch} = {}) {
  ({provider, model} = validateProviderConfig({provider, model}));
  const name = PROVIDERS[provider].label;
  if (!apiKey) throw new Error(`${name} API key is missing. Run npm run setup for this provider.`);
  const request = buildRequest(provider, model, apiKey, input, schema);
  let response;
  try {response = await fetcher(request.url, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000), headers: request.headers, body: JSON.stringify(request.body)});}
  catch {throw new Error(`${name} request timed out or could not connect. Video remains blocked.`);}
  if (!response.ok) throw await providerError(response, provider);
  let text;
  try {text = responseText(provider, JSON.parse(await limitedText(response, 100000)));} catch {text = null;}
  if (typeof text !== 'string' || !text.trim()) throw new Error(`${name} returned no valid decision (refused, incomplete, or empty response). Video remains blocked.`);
  try {return JSON.parse(text);} catch {throw new Error(`${name} returned no valid decision. Video remains blocked.`);}
}
