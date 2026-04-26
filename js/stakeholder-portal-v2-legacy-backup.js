// Maxwell DealFlow — Stakeholder Portal V2 (preview build)
// Same RPC contract as V1, richer light-theme presentation.
// Read-only, token-gated, no login required.
(function(){
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const params = new URLSearchParams(location.search);
  const token = params.get('t');
  const root = document.getElementById('root');

  const ROLE_LABEL = {
    client:'Client', inspector:'Inspector', mortgage_broker:'Mortgage Broker',
    lawyer:'Lawyer', appraiser:'Appraiser', insurance:'Insurance Agent', other:'Stakeholder'
  };

  function fmtDate(d){
    if(!d) return '\u2014';
    const s = String(d).slice(0,10); // strip any time/zone — treat as a calendar date
    return new Date(s+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  }
  function fmtDateLong(d){
    if(!d) return '\u2014';
    const s = String(d).slice(0,10);
    return new Date(s+'T00:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  }
  function toast(msg){
    const t=document.createElement('div');t.className='toast';t.textContent=msg;
    document.body.appendChild(t);setTimeout(function(){t.remove();},2600);
  }
  function row(label,val){
    return '<div class="row"><span class="label">'+label+'</span><span class="val">'+val+'</span></div>';
  }
  function showError(msg){
    root.innerHTML = '<div class="err"><h2>\ud83d\udd12 Link not available</h2>'+
      '<p style="color:var(--text2)">'+(msg||'This link has expired or been revoked.')+'</p>'+
      '<p style="color:var(--text3);font-size:13px;margin-top:20px">Contact Maxwell at '+
      '<a style="color:var(--accent)" href="tel:7093250545">(709) 325-0545</a> for a new link.</p></div>';
  }
  async function rpc(fn, args){
    const r = await sb.rpc(fn, args);
    if(r.error){console.error(fn,r.error);return null;}
    return r.data;
  }

  // Initials from full name → e.g. "James Owusu" → "JO"
  function initials(name){
    if(!name) return '?';
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if(!parts.length) return '?';
    return ((parts[0][0]||'') + (parts[parts.length-1][0]||'')).toUpperCase();
  }

  // Days between today and a YYYY-MM-DD date (negative = past)
  function daysUntil(dateStr){
    if(!dateStr) return null;
    const target = new Date(dateStr + 'T00:00:00');
    const today  = new Date(new Date().toDateString());
    return Math.round((target - today) / (1000*60*60*24));
  }

  // Smart status banner — derives a single sentence from existing data.
  function deriveStatus(d){
    const today = new Date().toISOString().slice(0,10);
    const dClose = d.closing_date && d.closing_date.slice(0,10);
    const dWalk  = d.walkthrough_date && d.walkthrough_date.slice(0,10);
    const dIns   = d.inspection_deadline && d.inspection_deadline.slice(0,10);
    const dFin   = d.financing_deadline && d.financing_deadline.slice(0,10);

    // Past closing
    if(dClose && dClose < today){
      return { kind:'good', icon:'\ud83c\udf89',
               title:'Congratulations \u2014 you closed!',
               sub:'Your deal closed on '+fmtDate(dClose)+'.' };
    }
    // Within 7 days of closing
    const closeIn = daysUntil(dClose);
    if(closeIn !== null && closeIn >= 0 && closeIn <= 7){
      return { kind:'good', icon:'\u2705',
               title:'You\u2019re on track to close on '+fmtDate(dClose),
               sub:'All major milestones complete \u2014 just '+closeIn+' day'+(closeIn===1?'':'s')+' to go.' };
    }
    // Financing deadline today/tomorrow
    const finIn = daysUntil(dFin);
    if(finIn !== null && finIn >= 0 && finIn <= 1){
      return { kind:'warn', icon:'\u26a0\ufe0f',
               title:'Financing deadline '+(finIn===0?'today':'tomorrow'),
               sub:'Make sure your lender confirms before '+fmtDate(dFin)+'.' };
    }
    // Default — good standing
    if(dClose){
      return { kind:'good', icon:'\u2705',
               title:'Your deal is in good standing',
               sub:'Closing scheduled for '+fmtDate(dClose)+'.' };
    }
    return { kind:'good', icon:'\u2705',
             title:'Your deal is active',
             sub:'Maxwell is working on the next milestone.' };
  }

  // What's-next sentence — finds the very next pending milestone
  function deriveNext(d, checklist){
    const today = new Date().toISOString().slice(0,10);
    const upcoming = (checklist||[]).filter(c => !c.completed && c.due_date);
    if(!upcoming.length){
      return 'No action needed from you right now \u2014 Maxwell will reach out when the next step is ready.';
    }
    const next = upcoming[0];
    const due = next.due_date && next.due_date.slice(0,10);
    const days = daysUntil(due);
    if(days === null) return next.label+' coming up.';
    if(days < 0)  return next.label+' was due '+fmtDate(due)+'. Maxwell will be in touch.';
    if(days === 0) return next.label+' is happening today!';
    if(days === 1) return next.label+' is scheduled for tomorrow.';
    return next.label+' is scheduled for '+fmtDate(due)+' ('+days+' days from now).';
  }

  // Countdown — D/H/M to closing
  function countdownTo(closeIso){
    if(!closeIso) return null;
    const target = new Date(closeIso + 'T00:00:00').getTime();
    const now    = Date.now();
    const diff   = Math.max(0, target - now);
    const days   = Math.floor(diff / (1000*60*60*24));
    const hours  = Math.floor((diff / (1000*60*60)) % 24);
    const mins   = Math.floor((diff / (1000*60)) % 60);
    return { days, hours, mins };
  }

  let realtimeChannel = null;
  let refreshDebounce = null;

  async function loadAndRender(isRefresh){
    const data = await rpc('stakeholder_resolve', { p_token: token });
    if(!data || data.error){
      showError(data && data.error==='invalid_or_expired'
        ?'This link has expired or been revoked.':'Could not load deal.');
      return;
    }
    if(!isRefresh){
      rpc('stakeholder_log_access', { p_token: token, p_ua: navigator.userAgent });
      rpc('log_portal_view', { p_page_type: 'stakeholder-v2', p_token: token, p_user_agent: (navigator.userAgent || '').slice(0, 400), p_is_self: new URLSearchParams(location.search).get('self') === '1' });
    }
    render(data);
  }

  function subscribeRealtime(){
    if(realtimeChannel) return;
    realtimeChannel = sb.channel('stakeholder-v2-'+token.slice(0,8))
      .on('postgres_changes', { event:'*', schema:'public', table:'pipeline'        }, queueRefresh)
      .on('postgres_changes', { event:'*', schema:'public', table:'checklist_items' }, queueRefresh)
      .subscribe();
  }
  function queueRefresh(){
    clearTimeout(refreshDebounce);
    refreshDebounce = setTimeout(function(){ loadAndRender(true); }, 600);
  }

  async function init(){
    if(!token){ showError('Missing access token.'); return; }
    await loadAndRender(false);
    subscribeRealtime();
  }

  function render(d){
    const checklist = d.checklist || [];
    const done  = checklist.filter(c => c.completed).length;
    const total = checklist.length;
    const pct   = total ? Math.round(done*100/total) : 0;
    const rolePretty = ROLE_LABEL[d.role] || 'Stakeholder';
    const greeting   = d.stakeholder_name ? 'Hi '+d.stakeholder_name.split(' ')[0] : 'Welcome';
    const fmtMoney   = d.offer_amount ? '$'+Number(d.offer_amount).toLocaleString() : null;
    const status     = deriveStatus(d);
    const nextSentence = deriveNext(d, checklist);
    const cd         = countdownTo(d.closing_date && d.closing_date.slice(0,10));

    let html = '';

    // ============ PHASE 3: Hero with image (gradient placeholder) ============
    html += '<div class="hero-img">';
    html += '<div class="hero-img-overlay"></div>';
    html += '<div class="hero-img-content">';
    html += '<span class="role-badge">'+rolePretty+' portal</span>';
    html += '<h1>'+(d.property||'Your property')+'</h1>';
    html += '<p>'+greeting+(fmtMoney?' \u00b7 '+fmtMoney:'')+'</p>';
    html += '</div></div>';

    // ============ PHASE 1: Smart status banner ============
    html += '<div class="status-banner'+(status.kind==='warn'?' warn':'')+'">';
    html += '<div class="status-banner-icon">'+status.icon+'</div>';
    html += '<div class="status-banner-text"><strong>'+status.title+'</strong><span>'+status.sub+'</span></div>';
    html += '</div>';

    // ============ PHASE 1: Countdown to closing ============
    if(cd){
      html += '<div class="countdown" id="cd-wrap">';
      html += '<div class="countdown-num"><strong id="cd-d">'+cd.days+'</strong><span>Days</span></div>';
      html += '<div class="countdown-num"><strong id="cd-h">'+String(cd.hours).padStart(2,'0')+'</strong><span>Hours</span></div>';
      html += '<div class="countdown-num"><strong id="cd-m">'+String(cd.mins).padStart(2,'0')+'</strong><span>Min</span></div>';
      html += '<div class="countdown-label">Until you get your keys \ud83d\udd11</div>';
      html += '</div>';
    }

    // ============ PHASE 1: What's next ============
    html += '<div class="next-up">';
    html += '<div class="next-up-label">\u23ed What\u2019s next</div>';
    html += '<div class="next-up-text">'+nextSentence+'</div>';
    html += '</div>';

    // ============ PHASE 1: Agent profile card ============
    const phoneRaw = (d.agent_phone||'').replace(/\D/g,'');
    html += '<div class="agent-card">';
    html += '<div class="agent-photo">'+initials(d.agent_name)+'</div>';
    html += '<div class="agent-info">';
    html += '<strong>'+(d.agent_name||'Maxwell Delali Midodzi')+'</strong>';
    html += '<span>Real Estate Agent \u00b7 eXp Realty</span>';
    html += '<div class="agent-actions">';
    if(phoneRaw){
      html += '<a href="tel:'+phoneRaw+'" class="agent-btn">\ud83d\udcde Call</a>';
      html += '<a href="sms:'+phoneRaw+'" class="agent-btn">\ud83d\udcac Text</a>';
    }
    html += '<a href="mailto:?subject=About my deal" class="agent-btn">\u2709\ufe0f Email</a>';
    html += '</div></div></div>';

    // ============ Two-column: Property details + Progress ============
    html += '<div class="grid">';

    html += '<div class="card"><h3>Property details</h3>';
    html += row('Address',  d.property||'\u2014');
    html += row('Stage',    d.stage||'\u2014');
    if(fmtMoney) html += row('Offer amount', fmtMoney);
    html += row('Closing',  fmtDate(d.closing_date));
    html += row('Acceptance', fmtDate(d.acceptance_date));
    html += '</div>';

    html += '<div class="card"><h3>Overall progress</h3>';
    html += '<div class="progress-wrap"><div class="progress-bar"><div class="progress-fill" style="width:'+pct+'%"></div></div>';
    html += '<div class="progress-meta"><span>'+done+' of '+total+' milestones complete</span><span>'+pct+'%</span></div></div>';
    html += row('Financing deadline',  fmtDate(d.financing_deadline));
    html += row('Inspection deadline', fmtDate(d.inspection_deadline));
    html += row('Walkthrough',         fmtDate(d.walkthrough_date));
    html += '</div>';

    html += '</div>'; // /grid

    // ============ PHASE 2: Vertical timeline ============
    html += '<div class="card" style="margin-bottom:14px"><h3>Your journey</h3>';
    if(checklist.length === 0){
      html += '<div style="color:var(--text3);text-align:center;padding:20px">No milestones yet \u2014 Maxwell will add them shortly.</div>';
    } else {
      // Find the first incomplete item — that's "current"
      let currentIdx = checklist.findIndex(c => !c.completed);
      if(currentIdx < 0) currentIdx = checklist.length; // all done
      html += '<div class="timeline">';
      checklist.forEach(function(c, i){
        const cls = c.completed ? 'done' : (i === currentIdx ? 'current' : '');
        const dot = c.completed ? '\u2713' : (i+1);
        html += '<div class="tl-item '+cls+'">';
        html += '<div class="tl-dot">'+dot+'</div>';
        html += '<div class="tl-content">';
        html += '<div class="tl-label">'+c.label+'</div>';
        html += '<div class="tl-meta">'+(c.due_date?fmtDate(c.due_date):'')+
                (c.completed ? ' \u00b7 Complete' : (i === currentIdx ? ' \u00b7 In progress' : ' \u00b7 Upcoming'))+'</div>';
        html += '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';

    // ============ PHASE 3: Document vault (placeholders) ============
    html += '<div class="card" style="margin-bottom:14px"><h3>\ud83d\udcc2 Your documents</h3>';
    html += '<div style="color:var(--text3);font-size:13px;margin-bottom:12px">Document vault \u2014 coming soon. Max will upload signed papers here so you don\u2019t have to chase emails.</div>';
    html += '<div class="docs">';
    html += '<a class="doc"><div class="doc-icon">\ud83d\udcc4</div><div class="doc-info"><strong>Signed offer</strong><span>Coming soon</span></div></a>';
    html += '<a class="doc"><div class="doc-icon">\ud83d\udd0d</div><div class="doc-info"><strong>Inspection report</strong><span>Coming soon</span></div></a>';
    html += '<a class="doc"><div class="doc-icon">\ud83c\udfe6</div><div class="doc-info"><strong>Financing approval</strong><span>Coming soon</span></div></a>';
    html += '<a class="doc"><div class="doc-icon">\ud83d\udccb</div><div class="doc-info"><strong>Property disclosure</strong><span>Coming soon</span></div></a>';
    html += '</div></div>';

    // ============ Revoke link card ============
    html += '<div class="card" style="margin-bottom:14px"><h3>This link</h3>';
    html += row('Expires', fmtDate(d.expires_at));
    html += '<div style="font-size:12px;color:var(--text3);margin-top:8px;line-height:1.5">Auto-extends 90 days each time you visit. If you didn\u2019t request this link, revoke it now \u2014 Maxwell will be notified.</div>';
    html += '<button class="panic" onclick="window.__revoke()">\ud83d\udeab Revoke this link now</button>';
    html += '</div>';

    html += '<div class="footer">\ud83d\udd12 Secure link \u00b7 expires '+fmtDate(d.expires_at)+
            ' \u00b7 auto-extends with each visit<br>'+
            (d.agent_name||'Maxwell Delali Midodzi')+' \u00b7 REALTOR\u00ae \u00b7 eXp Realty \u00b7 '+
            (d.agent_phone||'(709) 325-0545')+'</div>';

    root.innerHTML = html;

    // Live countdown ticker — clear any prior timer first (re-render safe)
    if(window.__cdTimer){ clearInterval(window.__cdTimer); window.__cdTimer = null; }
    if(cd && d.closing_date){
      const closeIso = d.closing_date.slice(0,10);
      window.__cdTimer = setInterval(function(){
        const x = countdownTo(closeIso);
        if(!x) return;
        const dEl = document.getElementById('cd-d');
        const hEl = document.getElementById('cd-h');
        const mEl = document.getElementById('cd-m');
        if(dEl) dEl.textContent = x.days;
        if(hEl) hEl.textContent = String(x.hours).padStart(2,'0');
        if(mEl) mEl.textContent = String(x.mins).padStart(2,'0');
      }, 30000); // refresh every 30s
    }

    window.__revoke = async function(){
      if(!confirm('Revoke this link now?\n\nYou will lose access immediately. Contact Maxwell for a new link.')) return;
      const r = await rpc('stakeholder_self_revoke', { p_token: token });
      if(r && r.ok){ toast('\ud83d\udeab Link revoked'); setTimeout(function(){showError('You revoked this link.');},1200); }
      else toast('\u26a0\ufe0f Could not revoke \u2014 call Maxwell at (709) 325-0545');
    };
  }

  init();
})();
