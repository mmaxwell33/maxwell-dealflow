// Maxwell DealFlow CRM — Claude AI Module
const AI = {
  history: [],
  apiKey: '', // Set via Settings once Anthropic key is available

  async send() {
    const input = document.getElementById('ai-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    input.style.height = 'auto';

    // Add user message
    AI.addMessage('user', msg);
    AI.addMessage('ai', '<div class="spinner" style="width:16px;height:16px;"></div>', 'typing');

    // Build context from CRM data
    const context = await AI.buildContext();

    try {
      let response;
      if (AI.apiKey) {
        response = await AI.callClaude(msg, context);
      } else {
        response = AI.localResponse(msg, context);
      }
      // Remove typing indicator and add response
      document.querySelector('.msg.typing')?.remove();
      AI.addMessage('ai', response);
      AI.history.push({ role:'user', content: msg });
      AI.history.push({ role:'assistant', content: response });
      // Keep history manageable
      if (AI.history.length > 20) AI.history = AI.history.slice(-20);
    } catch (e) {
      document.querySelector('.msg.typing')?.remove();
      AI.addMessage('ai', '⚠️ Error connecting to AI. Check your API key in settings.');
    }
  },

  async callClaude(userMsg, context) {
    // Direct API call (use Supabase Edge Function in production to hide key)
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': AI.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: `You are Maxwell Midodzi's real estate AI assistant at eXp Realty.
You have access to his current CRM data. Be concise, practical and conversational.
Always address Maxwell directly. Suggest specific next steps when relevant.

CURRENT CRM DATA:
${context}`,
        messages: [
          ...AI.history.slice(-10),
          { role:'user', content: userMsg }
        ]
      })
    });
    if (!res.ok) throw new Error('API error: ' + res.status);
    const data = await res.json();
    return data.content?.[0]?.text || 'No response';
  },

  localResponse(msg, context) {
    // Offline responses when no API key set
    const m = msg.toLowerCase();
    if (m.includes('how many client') || m.includes('total client')) {
      return `You currently have ${Clients.all.length} clients loaded. Add your Claude API key in the app settings to get full AI-powered insights! 🔑`;
    }
    if (m.includes('pipeline') || m.includes('deal')) {
      const active = Pipeline.all.filter(d => d.status === 'Active').length;
      return `You have ${active} active deal(s) in your pipeline. Add your Claude API key for detailed deal analysis and next-step recommendations!`;
    }
    if (m.includes('viewing') || m.includes('showing')) {
      return `You have ${Viewings.all.length} viewings on record. Add your Claude API key to get smart scheduling suggestions and client feedback analysis!`;
    }
    return `Hi Maxwell! I'm your AI assistant. To unlock full AI capabilities, tap **⚙️ Settings** and add your Claude API key. Once added, I can analyze your pipeline, draft client messages, suggest next steps, and much more! 🚀`;
  },

  async buildContext() {
    const activeClients = Clients.all.filter(c => c.status === 'Active');
    const recentViewings = Viewings.all.slice(0, 10);
    const activeDeals = Pipeline.all.filter(d => d.status === 'Active');
    const recentOffers = Offers.all.slice(0, 5);

    return `
ACTIVE CLIENTS (${activeClients.length}):
${activeClients.slice(0,10).map(c => `- ${c.full_name} | Stage: ${c.stage} | Budget: ${c.price_range||'N/A'} | City: ${c.city||'N/A'}`).join('\n')}

ACTIVE PIPELINE DEALS (${activeDeals.length}):
${activeDeals.map(d => `- ${d.client_name} | ${d.property_address} | $${Number(d.offer_amount||0).toLocaleString()} | Stage: ${d.stage} | Close: ${d.closing_date||'TBD'}`).join('\n')}

RECENT VIEWINGS (${recentViewings.length}):
${recentViewings.slice(0,5).map(v => `- ${v.property_address} | ${v.clients?.full_name||'—'} | ${v.viewing_date} | ${v.viewing_status} | Feedback: ${v.client_feedback||'pending'}`).join('\n')}

RECENT OFFERS:
${recentOffers.map(o => `- ${o.clients?.full_name||'—'} | ${o.property_address} | $${Number(o.offer_amount||0).toLocaleString()} | ${o.status}`).join('\n')}
`.trim();
  },

  addMessage(role, content, cls = '') {
    const el = document.getElementById('ai-messages');
    const div = document.createElement('div');
    div.className = `msg ${role} ${cls}`;
    if (role === 'ai') {
      div.innerHTML = `<div class="msg-label">Claude</div>${content}`;
    } else {
      div.textContent = content;
    }
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    return div;
  },

  setApiKey(key) {
    AI.apiKey = key;
    localStorage.setItem('df_claude_key', key);
    App.toast('✅ API key saved!');
  },

  loadSavedKey() {
    const saved = localStorage.getItem('df_claude_key');
    if (saved) AI.apiKey = saved;
  },

  openSettings() {
    App.openModal(`
      <div class="modal-title">⚙️ AI Settings</div>
      <div class="form-group">
        <label class="form-label">Claude API Key</label>
        <input class="form-input" id="ai-key-input" type="password"
          placeholder="sk-ant-api03-..."
          value="${AI.apiKey ? '••••••••' + AI.apiKey.slice(-8) : ''}">
        <div style="font-size:11px;color:var(--text2);margin-top:4px;">
          Get your key at console.anthropic.com · Stored locally on this device only
        </div>
      </div>
      <button class="btn btn-primary btn-block" onclick="
        const v=document.getElementById('ai-key-input').value.trim();
        if(v&&!v.startsWith('•'))AI.setApiKey(v);
        App.closeModal();
      ">💾 Save Key</button>
      <div class="divider"></div>
      <div class="form-group">
        <label class="form-label">Sign Out</label>
        <button class="btn btn-red btn-block" onclick="App.signOut()">🚪 Sign Out</button>
      </div>
    `);
  }
};

// Auto-resize AI textarea
document.addEventListener('DOMContentLoaded', () => {
  AI.loadSavedKey();
  const inp = document.getElementById('ai-input');
  if (inp) {
    inp.addEventListener('input', () => {
      inp.style.height = 'auto';
      inp.style.height = Math.min(inp.scrollHeight, 100) + 'px';
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); AI.send(); }
    });
  }
  // Settings button in topbar
  document.getElementById('topbar-avatar')?.addEventListener('click', () => AI.openSettings());
});
