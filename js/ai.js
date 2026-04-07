// Maxwell DealFlow CRM — AI Assistant (Upgraded)
const AI = {
  history: [],   // full conversation memory for this session
  apiKey: '',
  thinking: false,

  // ── SEND MESSAGE ────────────────────────────────────────────
  async send(prefill) {
    const input = document.getElementById('ai-input');
    const msg = prefill || input.value.trim();
    if (!msg || AI.thinking) return;
    if (!prefill) { input.value = ''; input.style.height = 'auto'; }

    AI.thinking = true;
    AI.addMessage('user', msg);
    const typingEl = AI.addMessage('ai', '<div class="ai-typing"><span></span><span></span><span></span></div>', 'typing');

    try {
      // Always fetch fresh live data from Supabase
      const context = await AI.buildLiveContext();
      let response;
      if (AI.apiKey) {
        response = await AI.callClaude(msg, context);
      } else {
        response = AI.smartLocal(msg, context);
      }
      typingEl.remove();
      AI.addMessage('ai', AI.formatResponse(response));
      AI.history.push({ role: 'user', content: msg });
      AI.history.push({ role: 'assistant', content: response });
      if (AI.history.length > 30) AI.history = AI.history.slice(-30);
    } catch(e) {
      typingEl.remove();
      AI.addMessage('ai', `⚠️ ${e.message || 'Error connecting to AI. Check your API key in Settings → Security.'}`);
    }
    AI.thinking = false;
  },

  // ── CALL CLAUDE API ──────────────────────────────────────────
  async callClaude(userMsg, context) {
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
        max_tokens: 1500,
        system: `You are the AI assistant built into Maxwell DealFlow CRM — a real estate CRM used by Maxwell Delali Midodzi, a realtor at eXp Realty.

Your role:
- Answer questions about Maxwell's clients, deals, pipeline, viewings, and commissions using the LIVE DATA below
- Help draft professional emails and client messages
- Suggest specific next steps for deals and clients
- Analyse trends and flag issues (e.g. clients overdue for follow-up, deals stalling)
- Be concise, practical, and conversational — like a smart assistant, not an essay writer
- When you mention a client or deal, be specific (use their name, address, amounts)
- Always suggest a next action when relevant

LIVE CRM DATA (just fetched):
${context}

Today's date: ${new Date().toLocaleDateString('en-CA', {weekday:'long',year:'numeric',month:'long',day:'numeric'})}`,
        messages: [
          ...AI.history.slice(-14),
          { role: 'user', content: userMsg }
        ]
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API error ${res.status}`);
    }
    const data = await res.json();
    return data.content?.[0]?.text || 'No response received.';
  },

  // ── LIVE CONTEXT FROM SUPABASE ───────────────────────────────
  async buildLiveContext() {
    if (!currentAgent?.id) return 'Not logged in.';
    const id = currentAgent.id;
    const now = new Date();
    const sevenDaysAgo = new Date(now - 7*86400000).toISOString();
    const thirtyDaysAgo = new Date(now - 30*86400000).toISOString();

    // Fetch everything in parallel
    const [
      { data: clients },
      { data: pipeline },
      { data: viewings },
      { data: commissions },
      { data: newBuilds },
      { data: approvals }
    ] = await Promise.all([
      db.from('clients').select('full_name,email,phone,stage,status,city,price_range,notes,updated_at,created_at').eq('agent_id', id).order('updated_at',{ascending:false}).limit(60),
      db.from('pipeline').select('client_name,property_address,offer_amount,stage,closing_date,acceptance_date,updated_at').eq('agent_id', id).order('updated_at',{ascending:false}).limit(30),
      db.from('viewings').select('property_address,viewing_date,viewing_status,client_feedback,notes').eq('agent_id', id).order('viewing_date',{ascending:false}).limit(20),
      db.from('commissions').select('client_name,property_address,sale_price,net_commission,commission_date,status').eq('agent_id', id).order('commission_date',{ascending:false}).limit(10),
      db.from('new_builds').select('client_name,builder_name,lot_address,current_stage,est_completion_date,milestones_done').eq('agent_id', id).limit(10),
      db.from('approval_queue').select('client_name,approval_type,status,created_at').eq('agent_id', id).eq('status','Pending').limit(10)
    ]);

    const cl = clients || [];
    const pl = pipeline || [];
    const vi = viewings || [];
    const co = commissions || [];
    const nb = newBuilds || [];
    const ap = approvals || [];

    // Compute follow-up needed
    const needsFollowUp = cl.filter(c => {
      if (!c.updated_at) return true;
      const days = Math.floor((now - new Date(c.updated_at)) / 86400000);
      const stageLower = (c.stage||'').toLowerCase();
      return days >= 7 && !stageLower.includes('closed') && !stageLower.includes('lost');
    });

    // Active vs closed
    const active = cl.filter(c => !['closed','lost','inactive'].includes((c.stage||'').toLowerCase()));
    const closed = cl.filter(c => (c.stage||'').toLowerCase().includes('closed'));

    // Pipeline value
    const pipelineValue = pl.reduce((s,d) => s + Number(d.offer_amount||0), 0);
    const closedDeals = pl.filter(d => (d.stage||'').toLowerCase().includes('closed'));
    const activeDeals = pl.filter(d => !['closed','fell through'].includes((d.stage||'').toLowerCase()));

    // Viewings this month
    const thisMonth = vi.filter(v => v.viewing_date && new Date(v.viewing_date) > new Date(now.getFullYear(), now.getMonth(), 1));

    // Total commissions
    const totalNet = co.reduce((s,c) => s + Number(c.net_commission||0), 0);

    return `
=== SUMMARY ===
Total Clients: ${cl.length} | Active: ${active.length} | Closed: ${closed.length}
Needs Follow-Up (7+ days no contact): ${needsFollowUp.length}
Active Pipeline Deals: ${activeDeals.length} | Total Pipeline Value: $${pipelineValue.toLocaleString()}
Closed Deals: ${closedDeals.length}
Viewings This Month: ${thisMonth.length}
Net Commissions (last 10): $${totalNet.toLocaleString()}
Pending Approvals: ${ap.length}
Active New Builds: ${nb.length}

=== CLIENTS NEEDING FOLLOW-UP ===
${needsFollowUp.slice(0,10).map(c => {
  const days = Math.floor((now - new Date(c.updated_at||c.created_at)) / 86400000);
  return `- ${c.full_name} | ${c.stage||'No stage'} | ${c.city||'—'} | Last contact: ${days}d ago | Budget: ${c.price_range||'N/A'}`;
}).join('\n') || 'None — great job!'}

=== ALL ACTIVE CLIENTS ===
${active.slice(0,20).map(c => `- ${c.full_name} | ${c.stage} | ${c.city||'—'} | ${c.price_range||'N/A'} | ${c.email||'no email'}`).join('\n')}

=== ACTIVE PIPELINE DEALS ===
${activeDeals.map(d => `- ${d.client_name} | ${d.property_address||'—'} | $${Number(d.offer_amount||0).toLocaleString()} | Stage: ${d.stage} | Closing: ${d.closing_date||'TBD'}`).join('\n') || 'No active deals'}

=== RECENT VIEWINGS ===
${vi.slice(0,8).map(v => `- ${v.property_address||'—'} | ${v.viewing_date||'—'} | ${v.viewing_status||'—'} | Feedback: ${v.client_feedback||'none'}`).join('\n') || 'No viewings'}

=== COMMISSIONS ===
${co.map(c => `- ${c.client_name} | ${c.property_address||'—'} | Sale: $${Number(c.sale_price||0).toLocaleString()} | Net: $${Number(c.net_commission||0).toLocaleString()} | ${c.commission_date||'—'}`).join('\n') || 'No commissions recorded'}

=== NEW BUILDS ===
${nb.map(b => `- ${b.client_name} | ${b.builder_name||'—'} | ${b.lot_address||'—'} | Stage: ${b.current_stage||'—'} | Milestones: ${b.milestones_done||0}/9 | Est. Complete: ${b.est_completion_date||'TBD'}`).join('\n') || 'No active builds'}

=== PENDING APPROVALS ===
${ap.map(a => `- ${a.client_name} | ${a.approval_type} | ${a.created_at?.slice(0,10)}`).join('\n') || 'None'}
`.trim();
  },

  // ── SMART LOCAL (no API key) ─────────────────────────────────
  smartLocal(msg, context) {
    const m = msg.toLowerCase();
    const lines = context.split('\n');
    const get = (label) => lines.find(l => l.startsWith(label))?.split(': ')[1] || '—';

    if (m.includes('follow') || m.includes('contact') || m.includes('overdue')) {
      const n = get('Needs Follow-Up');
      return `⏰ You have **${n}** client(s) who need follow-up (7+ days no contact).\n\nCheck the **Tracker** tab to see who they are and quickly email or call them.\n\n💡 *Add your Claude API key in Settings to get personalized follow-up message drafts!*`;
    }
    if (m.includes('pipeline') || m.includes('deal') || m.includes('active deal')) {
      const active = get('Active Pipeline Deals');
      const val = get('Total Pipeline Value');
      return `🚀 You have **${active}** active deal(s) with a total pipeline value of **${val}**.\n\nGo to the **Pipeline** tab to see full details and update stages.\n\n💡 *Add your Claude API key to get deal-by-deal analysis and next steps!*`;
    }
    if (m.includes('client') || m.includes('how many')) {
      const total = get('Total Clients');
      const active = get('Active');
      const closed = get('Closed');
      return `👥 You have **${total}** total clients — **${active}** active and **${closed}** closed.\n\nVisit the **Clients** tab to manage them all.\n\n💡 *Add your Claude API key for detailed client insights and email drafts!*`;
    }
    if (m.includes('commission') || m.includes('earning') || m.includes('money')) {
      const net = get('Net Commissions');
      return `💰 Your recorded net commissions total **${net}**.\n\nGo to **Commissions** tab to see the full breakdown.\n\n💡 *Add your Claude API key for earnings forecasts and deal analysis!*`;
    }
    if (m.includes('viewing') || m.includes('showing')) {
      const vm = get('Viewings This Month');
      return `📅 You have **${vm}** viewing(s) this month.\n\nGo to the **Viewings** tab to manage scheduling and feedback.\n\n💡 *Add your Claude API key for smart viewing summaries!*`;
    }
    if (m.includes('hello') || m.includes('hi') || m.includes('hey')) {
      return `👋 Hey Maxwell! I'm your DealFlow AI assistant.\n\nI have **live access** to your Supabase data right now. Ask me anything like:\n- "Which clients need follow-up?"\n- "Summarise my pipeline"\n- "How many viewings this month?"\n- "Draft an email to [client]"\n\n🔑 *Add your Claude API key in **Settings** to unlock full AI-powered responses!*`;
    }
    return `I can see your live CRM data but need your **Claude API key** to give detailed AI responses.\n\nGo to **Settings → Security** and add your key from [console.anthropic.com](https://console.anthropic.com).\n\nIn the meantime, try asking:\n- "How many clients need follow-up?"\n- "What's my pipeline value?"\n- "How many viewings this month?"`;
  },

  // ── FORMAT RESPONSE (markdown → HTML) ───────────────────────
  formatResponse(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^### (.*)/gm, '<div class="ai-h3">$1</div>')
      .replace(/^## (.*)/gm, '<div class="ai-h2">$1</div>')
      .replace(/^# (.*)/gm, '<div class="ai-h1">$1</div>')
      .replace(/^- (.*)/gm, '<div class="ai-li">• $1</div>')
      .replace(/^\d+\. (.*)/gm, '<div class="ai-li">$&</div>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
  },

  // ── ADD MESSAGE TO CHAT ──────────────────────────────────────
  addMessage(role, content, cls = '') {
    const el = document.getElementById('ai-messages');
    if (!el) return null;
    const div = document.createElement('div');
    div.className = `msg ${role} ${cls}`.trim();
    if (role === 'ai') {
      div.innerHTML = `<div class="msg-avatar">🤖</div><div class="msg-bubble">${content}</div>`;
    } else {
      div.innerHTML = `<div class="msg-bubble">${App.esc ? App.esc(content) : content}</div>`;
    }
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    return div;
  },

  // ── QUICK ACTION CHIPS ───────────────────────────────────────
  quickSend(prompt) {
    const input = document.getElementById('ai-input');
    if (input) input.value = prompt;
    AI.send(prompt);
  },

  // ── CLEAR CHAT ───────────────────────────────────────────────
  clearChat() {
    AI.history = [];
    const el = document.getElementById('ai-messages');
    if (el) {
      el.innerHTML = '';
      AI.addMessage('ai', 'Chat cleared. How can I help you? 👋');
    }
  },

  // ── API KEY ──────────────────────────────────────────────────
  setApiKey(key) {
    AI.apiKey = key.trim();
    localStorage.setItem('df_claude_key', AI.apiKey);
    App.toast('✅ Claude API key saved!');
    // Update the key status indicator
    const el = document.getElementById('ai-key-status');
    if (el) { el.textContent = '🟢 API key set'; el.style.color = 'var(--green)'; }
  },

  loadSavedKey() {
    const saved = localStorage.getItem('df_claude_key');
    if (saved) AI.apiKey = saved;
  },

  // ── LEGACY (keep for compat) ─────────────────────────────────
  openSettings() { App.switchTab('settings'); }
};

// ── INIT ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  AI.loadSavedKey();
  const inp = document.getElementById('ai-input');
  if (inp) {
    inp.addEventListener('input', () => {
      inp.style.height = 'auto';
      inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); AI.send(); }
    });
  }
});
