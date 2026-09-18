// Kaputt! — LLM Player Adapter
// Provider-neutral BYOK browser adapter. Keys stay client-side only.

const KAPUTT_RULES = `You are playing Kaputt!, a 2d6 tabletop strategy game.

RULES (frozen K3-E1):
- Each turn: roll 2d6 secretly, reveal ONE die, choose ATTACK or DEFENSE, then reveal the second.
- ATTACK: multiply the dice. If product > NtB (Numero da Battere), you SCORE the product and NtB becomes the product. If product ≤ NtB, you suffer 1 KAPUTT (life lost), score 0, NtB unchanged.
- DEFENSE: add the dice. Always safe (no Kaputt). You score the HIGHER die (not the sum). NtB becomes the sum.
- EXTREME (only on dice 1+6 or 6+1): Attack → value becomes 36. Defense → value becomes 2, score 1.
- "Strictly greater than" for Attack success (36 at NtB=36 FAILS).
- A player wins by reaching the score target OR when opponent reaches the Kaputt limit.

STRATEGIC TENSION:
- Attack = high risk, high reward, escalation (raises NtB).
- Defense = safety, small reward, de-escalation (lowers NtB).
- At high NtB, a failed Attack preserves NtB (strategic HOLD) but costs a Kaputt life.
- This creates an attrition auction: players may deliberately fail Attacks to hold pressure.`;

const INFORMED_PRIMER = `STRATEGY PRIMER (analytical framework, not a prescription):

BUILD/ESCALATE: When NtB is low/attackable and your visible die is favorable, Attack can score AND construct pressure on the opponent.

PRESSURE: A sufficiently high NtB restricts the opponent's profitable attacks.

HOLD: At high pressure, deliberately choosing a risky/impossible Attack can be rational — failure spends a Kaputt but preserves NtB, denying the opponent an easy threshold.

RESET / CONCEDE: Defense preserves life and scores a little but lowers NtB, potentially giving the opponent a favorable low threshold.

The strategic cycle: BUILD → PRESSURE → ATTRITION AUCTION → CONCESSION → REBUILD

Kaputt lives are a STRATEGIC RESOURCE, not just a failure counter. Spending one to hold NtB pressure is sometimes optimal.

Context matters: visible die, NtB, score gap, your Kaputt remaining, opponent Kaputt remaining, and distance to target ALL influence the correct choice.`;

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o4-mini'],
    endpoint: 'https://api.openai.com/v1/chat/completions',
    buildRequest(apiKey, model, systemPrompt, userPrompt, temperature) {
      return {
        url: this.endpoint,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: {
          model, temperature, response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        },
      };
    },
    parseResponse(data) {
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response from OpenAI');
      const parsed = JSON.parse(content);
      return {
        choice: parsed.choice?.toLowerCase() === 'defense' ? 'defense' : 'attack',
        reasoning: parsed.reasoning || parsed.explanation || '',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        tokens: data.usage ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens } : null,
      };
    },
  },
  anthropic: {
    name: 'Anthropic',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
    endpoint: 'https://api.anthropic.com/v1/messages',
    buildRequest(apiKey, model, systemPrompt, userPrompt, temperature) {
      return {
        url: this.endpoint,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: {
          model, max_tokens: 512, temperature,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        },
      };
    },
    parseResponse(data) {
      const content = data.content?.[0]?.text;
      if (!content) throw new Error('Empty response from Anthropic');
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in Anthropic response');
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        choice: parsed.choice?.toLowerCase() === 'defense' ? 'defense' : 'attack',
        reasoning: parsed.reasoning || '',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        tokens: data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens } : null,
      };
    },
  },
  google: {
    name: 'Google Gemini',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    endpointBase: 'https://generativelanguage.googleapis.com/v1beta/models',
    buildRequest(apiKey, model, systemPrompt, userPrompt, temperature) {
      const url = `${this.endpointBase}/${model}:generateContent?key=${apiKey}`;
      const prompt = `${systemPrompt}\n\n${userPrompt}\n\nRespond with ONLY valid JSON: {"choice":"attack"|"defense","reasoning":"...","confidence":0.0-1.0}`;
      return {
        url,
        headers: { 'Content-Type': 'application/json' },
        body: {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature, responseMimeType: 'application/json' },
        },
      };
    },
    parseResponse(data) {
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!content) throw new Error('Empty response from Gemini');
      const parsed = JSON.parse(content);
      return {
        choice: parsed.choice?.toLowerCase() === 'defense' ? 'defense' : 'attack',
        reasoning: parsed.reasoning || '',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        tokens: data.usageMetadata ? { input: data.usageMetadata.promptTokenCount, output: data.usageMetadata.candidatesTokenCount } : null,
      };
    },
  },
};

function buildUserPrompt(state, condition) {
  const { ntb, target, kaputtLimit, visibleDie, players, currentPlayer } = state;
  const me = players.find(p => p.isMe) || players[currentPlayer];
  const opp = players.find(p => !p.isMe) || players[1 - currentPlayer];

  let prompt = `Current game state:
- Your score: ${me.score}
- Your Kaputt lives used: ${me.kaputt} / ${kaputtLimit}
- Opponent score: ${opp.score}
- Opponent Kaputt lives used: ${opp.kaputt} / ${kaputtLimit}
- Target score: ${target}
- Current NtB (Numero da Battere): ${ntb}
- Your visible die: ${visibleDie}

Choose exactly one action: ATTACK or DEFENSE.

Respond with valid JSON: {"choice":"attack"|"defense","reasoning":"your strategic reasoning","confidence":0.0-1.0}`;

  if (condition === 'informed') {
    prompt = INFORMED_PRIMER + '\n\n' + prompt;
  }

  return prompt;
}

const STORAGE_KEY = 'kaputt_llm_config';

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveConfig(cfg) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch {}
}

function getApiKey(provider) {
  return loadConfig()[provider + '_key'] || '';
}

function setApiKey(provider, key) {
  const cfg = loadConfig();
  if (key) cfg[provider + '_key'] = key;
  else delete cfg[provider + '_key'];
  saveConfig(cfg);
}

function getModel(provider) {
  return loadConfig()[provider + '_model'] || PROVIDERS[provider]?.models[0] || '';
}

function setModel(provider, model) {
  const cfg = loadConfig();
  cfg[provider + '_model'] = model;
  saveConfig(cfg);
}

function getCondition() {
  return loadConfig().condition || 'naive';
}

function setCondition(condition) {
  const cfg = loadConfig();
  cfg.condition = condition;
  saveConfig(cfg);
}

function getTemperature() {
  return loadConfig().temperature ?? 0.3;
}

function setTemperature(t) {
  const cfg = loadConfig();
  cfg.temperature = t;
  saveConfig(cfg);
}

async function callLLM(provider, state, proxyBase) {
  const apiProvider = PROVIDERS[provider];
  if (!apiProvider) throw new Error('Unknown provider: ' + provider);

  const apiKey = getApiKey(provider);
  if (!apiKey) throw new Error('No API key for ' + apiProvider.name + '. Set one in the LLM settings.');

  const model = getModel(provider);
  const condition = getCondition();
  const temperature = getTemperature();

  const systemPrompt = condition === 'informed'
    ? KAPUTT_RULES + '\n\nYou have access to a strategy framework.'
    : KAPUTT_RULES;
  const userPrompt = buildUserPrompt(state, condition);

  const req = apiProvider.buildRequest(apiKey, model, systemPrompt, userPrompt, temperature);

  let response;
  const fetchOptions = { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) };

  // Anthropic and Google Gemini need proxy due to CORS
  if (provider === 'anthropic' || provider === 'google') {
    const proxyUrl = (proxyBase || '') + '/api/llm-proxy';
    response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, url: req.url, headers: req.headers, body: req.body }),
    });
  } else {
    response = await fetch(req.url, fetchOptions);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`${apiProvider.name} API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  return apiProvider.parseResponse(data);
}

function formatResult(result, provider, model, condition) {
  const why = `LLM (${provider}/${model}, ${condition}): ${result.reasoning}${result.confidence !== null ? ' [conf: ' + result.confidence.toFixed(2) + ']' : ''}`;
  return { choice: result.choice, why };
}

function getAvailableProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id, name: p.name, models: p.models, hasKey: !!getApiKey(id),
  }));
}

function clearAllKeys() {
  const cfg = loadConfig();
  for (const key of Object.keys(cfg)) {
    if (key.endsWith('_key')) delete cfg[key];
  }
  saveConfig(cfg);
}

window.KaputtLLM = {
  PROVIDERS,
  callLLM,
  formatResult,
  getAvailableProviders,
  getApiKey, setApiKey,
  getModel, setModel,
  getCondition, setCondition,
  getTemperature, setTemperature,
  clearAllKeys,
  KAPUTT_RULES,
  INFORMED_PRIMER,
};
