import app from '../hono/hono';
import userContext from '../security/user-context';
import userService from '../service/user-service';
import permService from '../service/perm-service';
import emailService from '../service/email-service';
import { emailConst } from '../const/entity-const';
import { t } from '../i18n/i18n';
import result from '../model/result';
import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import { buildTools, executeConfirmedTool } from '../agent/tools';
import { buildSystemPrompt } from '../agent/system-prompt';
import { resolveLanguageModel, fetchAvailableModels, testModelConnectivity, maskApiKey } from '../agent/provider';
import { isSameEndpoint } from '../agent/endpoint';

// ---- chat: AI SDK v6 streaming, direct (no DO routing — protocol mismatch with AIChatAgent) ----
app.post('/agent/chat', async (c) => {
  const userId = userContext.getUserId(c);
  if (!userId) return c.json(result.fail('unauthorized'), 401);

  const user = await userService.findById(c, userId);
  if (!user?.agentEnabled) return c.json(result.fail('agent-disabled'), 403);

  const provider = user.agentProvider || 'workers-ai';
  if (provider === 'workers-ai' && !c.env.AI) {
    return c.json(result.fail('AI binding not configured on this Worker'), 503);
  }

  let body;
  try { body = await c.req.json(); }
  catch { return c.json(result.fail('invalid-body'), 400); }

  // Accept both shapes: UI messages array or already-converted model messages
  const uiMessages = Array.isArray(body?.messages) ? body.messages : [];
  console.log('[agent/chat] request body keys:', Object.keys(body || {}), 'msg count:', uiMessages.length);

  // Normalize messages so each message has parts array, ensuring convertToModelMessages succeeds
  const normalizedMessages = uiMessages.map(m => {
    if (Array.isArray(m.parts) && m.parts.length > 0) return m;
    const text = typeof m.content === 'string' ? m.content : (m.content ? JSON.stringify(m.content) : '');
    return {
      ...m,
      parts: text ? [{ type: 'text', text }] : []
    };
  });

  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(normalizedMessages, { ignoreIncompleteToolCalls: true });
  } catch (convErr) {
    console.warn('[agent/chat] convertToModelMessages failed, using fallback:', convErr);
    modelMessages = normalizedMessages.map(m => {
      const text = Array.isArray(m.parts)
        ? m.parts.filter(p => p?.type === 'text').map(p => p.text).join('\n')
        : (m.content || '');
      return { role: m.role || 'user', content: text };
    }).filter(m => m.content);
  }

  if (!modelMessages || modelMessages.length === 0) {
    return c.json(result.fail('no-messages-in-request'), 400);
  }

  // Diagnostic logs
  console.log('[agent/chat] model messages:', JSON.stringify(modelMessages).slice(0, 500));
  console.log('[agent/chat] is array:', Array.isArray(modelMessages), 'len:', modelMessages.length);

  let model;
  try {
    model = resolveLanguageModel(c, user);
  } catch (err) {
    console.error('[agent/chat] resolveLanguageModel error:', err?.message);
    return c.json(result.fail('model-resolve-failed: ' + err?.message), 400);
  }

  const activeEmailId = Number(c.req.header('x-active-email-id')) || null;
  const tools = buildTools({ env: c.env, userId, userEmail: user.email, user, activeEmailId });

  try {
    const stream = streamText({
      model,
      system: buildSystemPrompt({
        userEmail: user.email,
        persona: user.agentPersona || '',
        currentBoxName: c.req.query('box') || 'inbox',
        locale: c.req.header('Accept-Language')?.split(',')[0] || 'en',
      }),
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(8),
      onError: (err) => {
        const msg = err?.error?.message || err?.message || JSON.stringify(err);
        console.error('[agent/chat] streamText onError:', msg);
        console.error('[agent/chat] stack:', err?.error?.stack || err?.stack);
      },
    });
    return stream.toUIMessageStreamResponse();
  } catch (err) {
    console.error('[agent/chat] outer catch:', err?.message, err?.stack);
    return c.json(result.fail('streamText-failed: ' + err?.message), 500);
  }
});

app.post('/agent/confirm', async (c) => {
  const userId = userContext.getUserId(c);
  if (!userId) return c.json(result.fail('unauthorized'), 401);
  const user = await userService.findById(c, userId);
  if (!user) return c.json(result.fail('user-not-found'), 404);
  const { name, args } = await c.req.json();
  if (!['sendDraft', 'deleteEmail'].includes(name)) return c.json(result.fail('unknown-tool'), 400);

  // Permission checks
  const isAdmin = user.email === c.env.admin;
  if (!isAdmin) {
    const permKeys = await permService.userPermKeys(c, userId);
    if (name === 'sendDraft' && !permKeys.includes('email:send')) {
      return c.json(result.fail(t('unauthorized') || 'unauthorized'), 403);
    }
    if (name === 'deleteEmail' && !permKeys.includes('email:delete')) {
      return c.json(result.fail(t('unauthorized') || 'unauthorized'), 403);
    }
  }

  const r = await executeConfirmedTool({ env: c.env, userId, userEmail: user.email, name, args });
  return c.json(result.ok(r));
});

app.get('/agent/preview', async (c) => {
  const userId = userContext.getUserId(c);
  if (!userId) return c.json(result.fail('unauthorized'), 401);
  const name = c.req.query('name');
  const id = Number(c.req.query('id'));
  if (!id) return c.json(result.fail('invalid-id'), 400);

  if (name === 'sendDraft') {
    const draft = await emailService.detail(c, id, userId);
    if (!draft || draft.type !== emailConst.type.SEND || draft.status !== emailConst.status.SAVING) {
      return c.json(result.fail('draft-not-found'), 404);
    }
    const cleanText = (draft.text || draft.content?.replace(/<[^>]+>/g, ' ') || '').replace(/\s+/g, ' ').trim();
    return c.json(result.ok({
      id: draft.emailId,
      to: draft.toEmail,
      subject: draft.subject || '',
      preview: cleanText.slice(0, 160),
    }));
  }

  if (name === 'deleteEmail') {
    const emailRow = await emailService.detail(c, id, userId);
    if (!emailRow) return c.json(result.fail('email-not-found'), 404);
    const cleanText = (emailRow.text || emailRow.content?.replace(/<[^>]+>/g, ' ') || '').replace(/\s+/g, ' ').trim();
    return c.json(result.ok({
      id: emailRow.emailId,
      from: emailRow.sendEmail,
      subject: emailRow.subject || '',
      preview: cleanText.slice(0, 160),
    }));
  }

  return c.json(result.fail('unknown-preview'), 400);
});

app.get('/agent/state', async (c) => {
  const userId = userContext.getUserId(c);
  if (!userId) return c.json(result.fail('unauthorized'), 401);
  // Stateless for now — frontend Chat class keeps history in-memory.
  // Persistent history can be added later by reading from agent_message table.
  return c.json(result.ok({ messages: [] }));
});

app.get('/agent/settings', async (c) => {
  const userId = userContext.getUserId(c);
  if (!userId) return c.json(result.fail('unauthorized'), 401);
  const u = await userService.findById(c, userId);
  return c.json(result.ok({
    agentEnabled: !!u?.agentEnabled,
    agentAutoDraft: !!u?.agentAutoDraft,
    agentPersona: u?.agentPersona || '',
    agentProvider: u?.agentProvider || 'workers-ai',
    agentCfAccountId: u?.agentCfAccountId || '',
    agentAiGatewayId: u?.agentAiGatewayId || '',
    agentGatewayProvider: u?.agentGatewayProvider || 'openai',
    agentBaseUrl: u?.agentBaseUrl || '',
    agentApiKeyMasked: maskApiKey(u?.agentApiKey),
    hasApiKey: !!u?.agentApiKey,
    agentModel: u?.agentModel || '',
    bindingAvailable: !!c.env.EMAIL_AGENT,
  }));
});

app.post('/agent/clear', async (c) => {
  const userId = userContext.getUserId(c);
  if (!userId) return c.json(result.fail('unauthorized'), 401);
  // Frontend handles its own in-memory clear; this is a no-op until D1 history is added.
  return c.json(result.ok({}));
});

app.put('/agent/settings', async (c) => {
  const userId = userContext.getUserId(c);
  if (!userId) return c.json(result.fail('unauthorized'), 401);

  const dbUser = await userService.findById(c, userId);
  const body = await c.req.json().catch(() => ({}));

  const updatePayload = {};
  if ('agentEnabled' in body) updatePayload.agentEnabled = body.agentEnabled ? 1 : 0;
  if ('agentAutoDraft' in body) updatePayload.agentAutoDraft = body.agentAutoDraft ? 1 : 0;
  if ('agentPersona' in body) updatePayload.agentPersona = (body.agentPersona || '').slice(0, 4000);
  if ('agentProvider' in body) updatePayload.agentProvider = body.agentProvider || 'workers-ai';
  if ('agentCfAccountId' in body) updatePayload.agentCfAccountId = (body.agentCfAccountId || '').trim();
  if ('agentAiGatewayId' in body) updatePayload.agentAiGatewayId = (body.agentAiGatewayId || '').trim();
  if ('agentGatewayProvider' in body) updatePayload.agentGatewayProvider = (body.agentGatewayProvider || 'openai').trim();
  if ('agentBaseUrl' in body) updatePayload.agentBaseUrl = (body.agentBaseUrl || '').trim();
  if ('agentModel' in body) updatePayload.agentModel = (body.agentModel || '').trim();

  // Compute effective endpoint configuration merging body with dbUser
  const effectiveConfig = {
    provider: 'agentProvider' in body ? body.agentProvider : dbUser?.agentProvider,
    cfAccountId: 'agentCfAccountId' in body ? body.agentCfAccountId : dbUser?.agentCfAccountId,
    aiGatewayId: 'agentAiGatewayId' in body ? body.agentAiGatewayId : dbUser?.agentAiGatewayId,
    gatewayProvider: 'agentGatewayProvider' in body ? body.agentGatewayProvider : dbUser?.agentGatewayProvider,
    baseUrl: 'agentBaseUrl' in body ? body.agentBaseUrl : dbUser?.agentBaseUrl,
  };
  const endpointChanged = !isSameEndpoint(effectiveConfig, dbUser);

  // API Key semantics:
  // 1. Non-empty string not containing '****': update to new key
  // 2. Explicit null: clear key
  // 3. Endpoint changed without new key: auto-clear old key to prevent leaking to new host
  // 4. Missing or empty string '' when endpoint is unchanged: keep existing key
  if (typeof body.agentApiKey === 'string' && body.agentApiKey.trim() !== '' && !body.agentApiKey.includes('****')) {
    updatePayload.agentApiKey = body.agentApiKey.trim();
  } else if (body.agentApiKey === null) {
    updatePayload.agentApiKey = '';
  } else if (endpointChanged) {
    updatePayload.agentApiKey = '';
  }

  await userService.updateAgentSettings(c, userId, updatePayload);
  return c.json(result.ok({}));
});

app.post('/agent/models', async (c) => {
  const userId = userContext.getUserId(c);
  if (!userId) return c.json(result.fail('unauthorized'), 401);

  const u = await userService.findById(c, userId);
  const body = await c.req.json().catch(() => ({}));

  const provider = body.provider || u?.agentProvider || 'workers-ai';
  const cfAccountId = body.cfAccountId ?? u?.agentCfAccountId;
  const aiGatewayId = body.aiGatewayId ?? u?.agentAiGatewayId;
  const gatewayProvider = body.gatewayProvider ?? u?.agentGatewayProvider;
  const baseUrl = body.baseUrl ?? u?.agentBaseUrl;
  const apiKey = body.apiKey;

  // Security: only reuse savedApiKey if endpoint matches what is stored in DB
  const sameEndpoint = isSameEndpoint({
    provider,
    cfAccountId,
    aiGatewayId,
    gatewayProvider,
    baseUrl,
  }, u);
  const savedApiKey = sameEndpoint ? u?.agentApiKey : undefined;

  try {
    const models = await fetchAvailableModels({
      provider,
      cfAccountId,
      aiGatewayId,
      gatewayProvider,
      baseUrl,
      apiKey,
      savedApiKey,
    });
    return c.json(result.ok(models));
  } catch (err) {
    console.error('[agent/models] failed to fetch models:', err);
    return c.json(result.fail(err.message || 'Failed to fetch models'), 400);
  }
});

app.post('/agent/test', async (c) => {
  const userId = userContext.getUserId(c);
  if (!userId) return c.json(result.fail('unauthorized'), 401);

  const u = await userService.findById(c, userId);
  const body = await c.req.json().catch(() => ({}));

  const provider = body.provider || u?.agentProvider || 'workers-ai';
  const cfAccountId = body.cfAccountId ?? u?.agentCfAccountId;
  const aiGatewayId = body.aiGatewayId ?? u?.agentAiGatewayId;
  const gatewayProvider = body.gatewayProvider ?? u?.agentGatewayProvider;
  const baseUrl = body.baseUrl ?? u?.agentBaseUrl;
  const apiKey = body.apiKey;

  // Security: only reuse savedApiKey if endpoint matches what is stored in DB
  const sameEndpoint = isSameEndpoint({
    provider,
    cfAccountId,
    aiGatewayId,
    gatewayProvider,
    baseUrl,
  }, u);
  const savedApiKey = sameEndpoint ? u?.agentApiKey : undefined;
  const model = (body.model || body.agentModel || u?.agentModel || '').trim();

  try {
    const testRes = await testModelConnectivity(c, {
      provider,
      cfAccountId,
      aiGatewayId,
      gatewayProvider,
      baseUrl,
      apiKey,
      savedApiKey,
      model,
    });
    return c.json(result.ok(testRes));
  } catch (err) {
    console.error('[agent/test] connectivity test failed:', err);
    return c.json(result.fail(err.message || '连接测试失败'), 400);
  }
});
