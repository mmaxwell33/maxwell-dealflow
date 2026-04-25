// Maxwell DealFlow — Stakeholder Portal (Phase 1: read-only)
// Token-gated, role-aware, no login required.
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
    return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
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
      '<a style="color:var(--accent2)" href="tel:7093250545">(709) 325-0545</a> for a new link.</p></div>';
  }
  async function rpc(fn, args){
    const r = await sb.rpc(fn, args);
    if(r.error){console.error(fn,r.error);return null;}
    return r.data;
  }

  async function init(){
    if(!token){ showError('Missing access token.'); return; }
    const data = await rpc('stakeholder_resolve', { p_token: token });
    if(!data || data.error){
      showError(data && data.error==='invalid_or_expired'
        ?'This link has expired or been revoked.':'Could not load deal.');
      return;
    }
    rpc('stakeholder_log_access', { p_token: token, p_ua: navigator.userAgent });
    render(data);
  }

  function render(d){
    const checklist = d.checklist || [];
    const done = checklist.filter(function(c){return c.completed;}).length;
    const total = checklist.length;
    const pct = total ? Math.round(done*100/total) : 0;
    const rolePretty = ROLE_LABEL[d.role] || 'Stakeholder';
    const greeting = d.stakeholder_name ? 'Hi '+d.stakeholder_name.split(' ')[0] : 'Welcome';

    let html = '';
    html += '<div class="hero"><span class="role-badge">'+rolePretty+' portal</span>';
    html += '<h1>'+greeting+' \u2014 your deal progress</h1>';
    html += '<p>'+(d.property||'Property')+' \u00b7 Maxwell Delali Midodzi, your agent</p></div>';

    html += '<div class="card" style="margin-bottom:16px"><h3>Overall progress</h3>';
    html += '<div class="progress-wrap"><div class="progress-bar"><div class="progress-fill" style="width:'+pct+'%"></div></div>';
    html += '<div class="progress-meta"><span>'+done+' of '+total+' milestones complete</span><span>'+pct+'%</span></div></div></div>';

    html += '<div class="grid">';
    html += '<div class="card"><h3>Deal details</h3>';
    html += row('Property', d.property||'\u2014');
    html += row('Stage', d.stage||'\u2014');
    html += row('Acceptance', fmtDate(d.acceptance_date));
    html += row('Inspection deadline', fmtDate(d.inspection_deadline));
    html += row('Financing deadline', fmtDate(d.financing_deadline));
    html += row('Walkthrough', fmtDate(d.walkthrough_date));
    html += row('Closing date', fmtDate(d.closing_date));
    html += '</div>';

    html += '<div class="card"><h3>Your agent</h3>';
    html += row('Name', d.agent_name);
    html += row('Phone', '<a style="color:var(--accent2);text-decoration:none" href="tel:'+d.agent_phone.replace(/\D/g,'')+'">'+d.agent_phone+'</a>');
    html += row('Link expires', fmtDate(d.expires_at));
    html += '<button class="panic" onclick="window.__revoke()">\ud83d\udeab Revoke this link now</button>';
    html += '</div></div>';

    html += '<div class="card" style="margin-top:16px"><h3>Milestones \u2014 what\u2019s done & what\u2019s left</h3>';
    if(checklist.length===0){
      html += '<div style="color:var(--text3);text-align:center;padding:24px">No milestones yet \u2014 your agent will add them shortly.</div>';
    } else {
      checklist.forEach(function(c){
        html += '<div class="check '+(c.completed?'done':'')+'">';
        html += '<div class="check-icon">'+(c.completed?'\u2713':'')+'</div>';
        html += '<div class="check-text">'+c.label+
                (c.due_date?' <span class="check-due">\u00b7 due '+fmtDate(c.due_date)+'</span>':'')+'</div>';
        html += '</div>';
      });
    }
    html += '</div>';

    html += '<div class="footer">\ud83d\udd12 Secure link \u00b7 expires '+fmtDate(d.expires_at)+
            ' \u00b7 auto-extends with each visit<br>Maxwell Delali Midodzi \u00b7 Royal LePage \u00b7 (709) 325-0545</div>';

    root.innerHTML = html;

    window.__revoke = async function(){
      if(!confirm('Revoke this link now?\n\nYou will lose access immediately. Contact Maxwell for a new link.')) return;
      const r = await rpc('stakeholder_self_revoke', { p_token: token });
      if(r && r.ok){ toast('\ud83d\udeab Link revoked'); setTimeout(function(){showError('You revoked this link.');},1200); }
      else toast('\u26a0\ufe0f Could not revoke \u2014 call Maxwell at (709) 325-0545');
    };
  }

  init();
})();
