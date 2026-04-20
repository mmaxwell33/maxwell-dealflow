// Maxwell DealFlow CRM — AI Assistant (REFINED: server-side key)
//
// What changed vs. the original js/ai.js:
//   • Removed browser-held Claude API key (no more localStorage).
//   • callClaude() now calls the Supabase edge function "claude-chat",
//     which stores the API key in Supabase secrets.
//   • Auth is the signed-in Supabase session — no key to copy/paste.
//   • setApiKey() / loadSavedKey() removed (no longer needed).
//   • Settings → Security "paste your Claude key" UI should be replaced
//     with a simple "AI is connected" status read from the edge function.
//
// Nothing else changes — history, live context, smart-local fallback,
// quick actions, and the DOM bindings all behave exactly as before.

const AI = {
  history: [],   // full conversation memory for this session
  thinking: false,
  available: true,   // set to false if the edge function returns an error

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
      if (AI.available) {
        try {
          response = await AI.callClaude(msg, context);
        } catch (e) {
          // Graceful fallback to smart-local if the edge function fails
          AI.available = false;
          console.warn('AI edge function failed, falling back to smart-local:', e);
          response = AI.smartLocal(msg, context);
        }
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
      AI.addMessage('ai', `⚠️ ${e.message || 'Error connecting to AI.'}`);
    }
    AI.thinking = false;
  },

  // ── CALL CLAUDE (via server-side edge function) ──────────────
  async callClaude(userMsg, context) {
    const system = `You are the AI assistant built into Maxwell DealFlow CRM — a real estate CRM used by Maxwell Delali Midodzi, a realtor at eXp Realty.

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

Today's date: ${new Date().toLocaleDateString('en-CA', {weekday:'long',year:'numeric',month:'long',day:'numeric'})}`;

    const messages = [
      ...AI.history.slice(-14),
      { role: 'user', content: userMsg }
    ];

    const { data, error } = await db.functions.invoke('claude-chat', {
      body: { system, messages, model: 'claude-haiku-4-5', max_tokens: 1500 }
    });

    if (error) throw new Error(error.message || 'AI request failed');
    if (data?.error) throw new Error(data.error);
    return data?.text || 'No response received.';
  },

  // ── LIVE CONTEXT FROM SUPABASE ───────────────────────────────
  // (unchanged — kept verbatim from original)
  async buildLiveContext() {
    if (!currentAgent?.id) return 'Not logged in.';
    const id = currentAgent.id;
    const now = new Date();
    const sevenDaysAgo = new Date(now - 7*86400000).toISOString();
    const thirtyDaysAgo = new Date(now - 30*86400000).toISOString();

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

    const needsFollowUp = cl.filter(c => {
      if (!c.updated_at) return true;
      const days = Math.floor((now - new Date(c.updated_at)) / 86400000);
      const stageLower = (c.stage||'').toLowerCase();
      return days >= 7 && !stageLower.includes('closed') && !stageLower.includes('lost');
    });

    const active = cl.filter(c => !['closed','lost','inactive'].includes((c.stage||'').toLowerCase()));
    const closed = cl.filter(c => (c.stage||'').toLowerCase().includes('closed'));
    const pipelineValue = pl.reduce((s,d) => s + Number(d.offer_amount||0), 0);
    const closedDeals = pl.filter(d => (d.stage||'').toLowerCase().includes('closed'));
    const activeDeals = pl.filter(d => !['closed','fell through'].includes((d.stage||'').toLowerCase()));
    const thisMonth = vi.filter(v => v.viewing_date && new Date(v.viewing_date) > new Date(now.getFullYear(), now.getMonth(), 1));
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

  // ── SMART LOCAL (fallback when edge function is unreachable) ─
  // (unchanged — kept verbatim from original)
  smartLocal(msg, context) {
    const m = msg.toLowerCase();
    const lines = context.split('\n');
    const get = (label) => lines.find(l => l.startsWith(label))?.split(': ')[1] || '—';

    if (m.includes('follow') || m.includes('contact') || m.includes('overdue')) {
      const n = get('Needs Follow-Up');
      return `⏰ You have **${n}** client(s) who need follow-up (7+ days no contact).\n\nCheck the **Tracker** tab to see who they are and quickly email or call them.`;
    }
    if (m.includes('pipeline') || m.includes('deal') || m.includes('active deal')) {
      const active = get('Active Pipeline Deals');
      const val = get('Total Pipeline Value');
      return `🚀 You have **${active}** active deal(s) with a total pipeline value of **${val}**.\n\nGo to the **Pipeline** tab to see full details and update stages.`;
    }
    if (m.includes('client') || m.includes('how many')) {
      const total = get('Total Clients');
      const active = get('Active');
      const closed = get('Closed');
      return `👥 You have **${total}** total clients — **${active}** active and **${closed}** closed.\n\nVisit the **Clients** tab to manage them all.`;
    }
    if (m.includes('commission') || m.includes('earning') || m.includes('money')) {
      const net = get('Net Commissions');
      return `💰 Your recorded net commissions total **${net}**.\n\nGo to **Commissions** tab to see the full breakdown.`;
    }
    if (m.includes('viewing') || m.includes('showing')) {
      const vm = get('Viewings This Month');
      return `📅 You have **${vm}** viewing(s) this month.\n\nGo to the **Viewings** tab to manage scheduling and feedback.`;
    }
    if (m.includes('hello') || m.includes('hi') || m.includes('hey')) {
      return `👋 Hey Maxwell! I'm your DealFlow AI assistant.\n\nAsk me anything like:\n- "Which clients need follow-up?"\n- "Summarise my pipeline"\n- "How many viewings this month?"\n- "Draft an email to [client]"`;
    }
    return `I can see your live CRM data. Try asking:\n- "How many clients need follow-up?"\n- "What's my pipeline value?"\n- "How many viewings this month?"`;
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

  // ── LEGACY ───────────────────────────────────────────────────
  openSettings() { App.switchTab('settings'); }
};

// ── INIT ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
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
