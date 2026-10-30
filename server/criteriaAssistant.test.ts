import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantError, createCriteriaAssistant, parseSuggestInput, validateAssistantSuggestion } from "./criteriaAssistant.js";
import { loadConfig } from "./config.js";

const input = { brief: "Educational skincare creators for a sensitive skin cream", platforms: ["instagram"] };
const output = { niche: "sensitive skin routines", idealCreator: "Creators who explain their routines and demonstrate products clearly.", topicKeywords: ["skincare", "sensitive skin"], exclusions: ["No medical claims"], creatorLocations: [], profileLanguages: [], followerRanges: [{ platform: "instagram", min: 10000, max: 100000 }] };
const response = (value: unknown = output) => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }), { status: 200 });
const settings = { apiKey: "fake-openrouter-secret-for-tests", model: "openai/gpt-4.1-mini" };

test("OpenRouter is optional app configuration and its key stays server-side", () => {
  const cfg = loadConfig({ NODE_ENV: "development", SOURCE_MODE: "mock", AUTH_MODE: "dev" });
  assert.equal(cfg.ai, null);
  assert.deepEqual(cfg.problems, []);
  assert.equal(loadConfig({ OPENROUTER_API_KEY: settings.apiKey }).ai?.model, settings.model);
  assert.equal(loadConfig({ OPENROUTER_API_KEY: settings.apiKey, OPENROUTER_MODEL: "deepseek/test-model" }).ai?.model, "deepseek/test-model");
});

test("one request sends bounded structured JSON and caches identical retries", async () => {
  let calls = 0;
  const suggest = createCriteriaAssistant(settings, (async (url, init) => {
    calls++;
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${settings.apiKey}`);
    const body = JSON.parse(init?.body as string);
    assert.equal(body.model, settings.model);
    assert.equal(body.max_tokens, 1400);
    assert.equal(body.provider.require_parameters, true);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.messages[1].content, JSON.stringify(parseSuggestInput(input)));
    return response();
  }) as typeof fetch);
  const [a, b] = await Promise.all([suggest(input, "user_a"), suggest(input, "user_a")]);
  assert.deepEqual(a, b);
  assert.equal(a.suggestion.niche, output.niche);
  assert.equal(a.suggestion.followerRanges.instagram?.min, 10000);
  await suggest(input, "user_a");
  assert.equal(calls, 1, "overlapping clicks and retries share the same request");
  await suggest(input, "user_b");
  assert.equal(calls, 2, "cache entries stay scoped to the signed-in user");
});

test("invalid input, unconfigured AI, and malformed model output fail with useful errors", async () => {
  assert.throws(() => parseSuggestInput({ ...input, brief: "short" }), /10 and 1,500/);
  assert.throws(() => parseSuggestInput({ ...input, platforms: ["unsupported"] }), /supported platform/);
  await assert.rejects(createCriteriaAssistant(null)(input, "user_a"), (error: unknown) => error instanceof AssistantError && error.code === "ai_not_configured");
  for (const value of [null, { ...output, niche: "x" }, { ...output, profileLanguages: ["English"] }, { ...output, followerRanges: [{ platform: "tiktok", min: 1, max: 10 }] }, { ...output, followerRanges: [{ platform: "instagram", min: 100, max: 1 }] }]) {
    assert.throws(() => validateAssistantSuggestion(value, ["instagram"]), (error: unknown) => error instanceof AssistantError && error.code === "ai_invalid_response");
  }
});

test("provider errors are not retried or exposed, and new requests are rate limited", async () => {
  for (const [status, code] of [[401, "ai_key_rejected"], [402, "ai_credits_required"], [429, "ai_rate_limited"], [500, "ai_unavailable"]] as const) {
    let calls = 0;
    const suggest = createCriteriaAssistant(settings, (async () => { calls++; return new Response(settings.apiKey, { status }); }) as typeof fetch);
    await assert.rejects(suggest(input, "user_a"), (error: unknown) => error instanceof AssistantError && error.code === code && !error.message.includes(settings.apiKey));
    assert.equal(calls, 1);
  }
  const suggest = createCriteriaAssistant(settings, (async () => response()) as typeof fetch);
  for (let i = 0; i < 5; i++) await suggest({ ...input, brief: `${input.brief} ${i}` }, "user_a");
  await assert.rejects(suggest({ ...input, brief: `${input.brief} sixth` }, "user_a"), (error: unknown) => error instanceof AssistantError && error.status === 429);
});
