// Maxwell DealFlow — Builder Portal V2-B (Phase 2) — PREVIEW
// Re-skin of the production builder portal in V2-B styling:
//   - Smart status banner (no countdown)
//   - "What's next" sentence
//   - Vertical timeline of the 5 build stages, each EXPANDABLE with live checkboxes
//   - Visit-request form
//   - Your Visit Requests list (pending / approved / rescheduled / declined)
//   - Add Custom Task
//   - Self-revoke link
// Same RPC contract as production builder.html (builder_load, builder_check_step,
// builder_request_visit, builder_accept_reschedule, builder_counter_reschedule,
// builder_add_custom, builder_self_revoke, builder_log_access).
(function(){
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const params = new URLSearchParams(location.search);
  const token = params.get('t');
  const root = document.getElementById('root');

  // 5 stages — must mirror production js/builder-portal.js exactly.
  const STAGES = [
    { key:'pre_construction', label:'Pre-Construction', icon:'\ud83d\udccb', steps:[
      {key:'builder_contacted',  label:'Builder contacted'},
      {key:'lot_visited',        label:'Lot visited / site walk done'},
      {key:'plans_selections',   label:'Plans & design selections made'},
      {key:'aps_drafted',        label:'APS drafted and reviewed with client'},
      {key:'aps_signed',         label:'APS signed by client'},
      {key:'aps_sent_builder',   label:'APS sent to builder'},
      {key:'aps_sent_lender',    label:'APS sent to lender for financing'},
    ]},
    { key:'financing', label:'Financing', icon:'\ud83c\udfe6', steps:[
      {key:'pre_asset_submitted', label:'Pre-asset submitted to lender'},
      {key:'pre_asset_approved',  label:'Pre-asset approved'},
      {key:'partial_approval',    label:'Partial financing approval received'},
      {key:'full_approval',       label:'Full financing approval received'},
    ]},
    { key:'construction', label:'Construction', icon:'\ud83c\udfd7\ufe0f', steps:[
      {key:'construction_started', label:'Builder starts construction'},
      {key:'foundation',           label:'Foundation poured'},
      {key:'framing',              label:'Framing complete'},
      {key:'roofing',              label:'Roofing complete'},
      {key:'rough_ins',            label:'Rough-ins (electrical & plumbing)'},
      {key:'insulation_drywall',   label:'Insulation & drywall'},
      {key:'cabinets_flooring',    label:'Cabinets & flooring'},
      {key:'finishes',             label:'Finishes & fixtures'},
    ]},
    { key:'conditions', label:'Conditions & Closing Prep', icon:'\u2705', steps:[
      {key:'inspection_done',    label:'Home inspection done'},
      {key:'conditions_waived',  label:'Conditions waived'},
      {key:'docs_attached',      label:'All documents attached'},
      {key:'lawyer_confirmed',   label:'Financing confirmed by lawyer'},
    ]},
    { key:'possession', label:'Possession', icon:'\ud83c\udf89', steps:[
      {key:'final_walkthrough',  label:'Final walkthrough with client'},
      {key:'ps_signed',          label:'P&S agreement signed'},
      {key:'closing_docs_sent',  label:'Closing documents sent to lawyer'},
      {key:'keys_handed',        label:'Keys handed to client'},
    ]},
  ];

  // Local state
  let build = null;
  let visitRequests = [];
  let realtimeChannel = null;
  let refreshDebounce = null;

  // ── Helpers ─────────────────────────────────────────────────────────────
  function fmtDate(d){
    if(!d) return '\u2014';
    const s = String(d).slice(0,10);
    return new Date(s+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  }
  function fmtDateTime(d, t){
    if(!d) return '\u2014';
    const date = new Date(String(d).slice(0,10)+'T00:00:00')
      .toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
    return t ? date+' at '+String(t).slice(0,5) : date;
  }
  function esc(s){
    return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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

  // ── Progress helpers ────────────────────────────────────────────────────
  function stageStats(stage, pm){
    const stepState = (pm && pm[stage.key] && pm[stage.key].steps) || {};
    const total = stage.steps.length;
    const done  = stage.steps.filter(s => stepState[s.key]).length;
    return { total, done, allDone: done === total && total > 0 };
  }
  function firstIncompleteStageIndex(pm){
    for (let i = 0; i < STAGES.length; i++){
      if (!stageStats(STAGES[i], pm).allDone) return i;
    }
    return STAGES.length;
  }
  function totalProgress(pm){
    let total = 0, done = 0;
    STAGES.forEach(s => { const st = stageStats(s, pm); total += st.total; done += st.done; });
    return { total, done, pct: total ? Math.round(done*100/total) : 0 };
  }
  function deriveStatus(b){
    const pm = b.pipeline_milestones || {};
    const prog = totalProgress(pm);
    const idx  = firstIncompleteStageIndex(pm);
    if (idx >= STAGES.length){
      return { kind:'good', icon:'\ud83c\udf89',
               title:'Build complete \u2014 keys handed over!',
               sub:'Every stage of your build is finished.' };
    }
    if (prog.done === 0){
      return { kind:'good', icon:'\ud83c\udfd7\ufe0f',
               title:'Build kicking off',
               sub:'Tick items as you complete them \u2014 Maxwell gets notified instantly.' };
    }
    return { kind:'good', icon:'\u2705',
             title:'Build is on track',
             sub:'Currently working through '+STAGES[idx].label+' \u2014 '+prog.pct+'% of all steps complete.' };
  }
  function deriveNext(b){
    const pm = b.pipeline_milestones || {};
    const idx = firstIncompleteStageIndex(pm);
    if (idx >= STAGES.length){
      return 'Nothing left on the checklist \u2014 your home is built and possession is complete.';
    }
    const stage = STAGES[idx];
    const stepState = (pm[stage.key] && pm[stage.key].steps) || {};
    const nextStep = stage.steps.find(s => !stepState[s.key]);
    if (!nextStep) return 'Wrapping up '+stage.label+' \u2014 Maxwell will move to the next stage shortly.';
    return 'Next up in '+stage.label+': '+nextStep.label+'.';
  }

  // ── Load + realtime ─────────────────────────────────────────────────────
  async function loadAndRender(isRefresh){
    const data = await rpc('builder_load', { p_token: token });
    if(!data || data.error || !data.build){
      showError('This link has expired or been revoked.');
      return;
    }
    build = data.build;
    visitRequests = data.visit_requests || [];
    if(!isRefresh){
      rpc('builder_log_access', { p_token: token, p_ua: (navigator.userAgent||'').slice(0,400) });
      rpc('log_portal_view', { p_page_type: 'builder-v2-B', p_token: token,
                               p_user_agent: (navigator.userAgent||'').slice(0,400),
                               p_is_self: params.get('self') === '1' });
    }
    render();
  }
  function subscribeRealtime(){
    if(realtimeChannel) return;
    realtimeChannel = sb.channel('builder-v2-B-'+token.slice(0,8))
      .on('postgres_changes', { event:'*', schema:'public', table:'new_builds' }, queueRefresh)
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

  // ── Render ──────────────────────────────────────────────────────────────
  function render(){
    const b = build;
    const pm     = b.pipeline_milestones || {};
    const prog   = totalProgress(pm);
    const curIdx = firstIncompleteStageIndex(pm);
    const status = deriveStatus(b);
    const nextSentence = deriveNext(b);
    const greeting = b.builder_name ? 'Hi '+b.builder_name.split(' ')[0] : 'Welcome';

    let html = '';

    // Title
    html += '<h1 class="page-title">'+esc(b.lot_address||'Your build')+
            '<span>Builder portal \u00b7 '+esc(greeting)+
            (b.builder_name?' \u00b7 '+esc(b.builder_name):'')+'</span></h1>';

    // Smart status banner
    html += '<div class="status-banner'+(status.kind==='warn'?' warn':'')+'">';
    html += '<div class="status-banner-icon">'+status.icon+'</div>';
    html += '<div class="status-banner-text"><strong>'+esc(status.title)+'</strong><span>'+esc(status.sub)+'</span></div>';
    html += '</div>';

    // What's next
    html += '<div class="next-up">';
    html += '<div class="next-up-label">\u23ed What\u2019s next</div>';
    html += '<div class="next-up-text">'+esc(nextSentence)+'</div>';
    html += '</div>';

    // Two-column: Build details + Overall progress
    html += '<div class="grid">';
    html += '<div class="card"><h3>Build details</h3>';
    html += row('Lot address',     esc(b.lot_address || '\u2014'));
    html += row('Builder',         esc(b.builder_name || '\u2014'));
    html += row('Est. completion', fmtDate(b.est_completion_date));
    if (b.purchase_price) html += row('Purchase price', '$'+Number(b.purchase_price).toLocaleString());
    html += '</div>';

    html += '<div class="card"><h3>Overall progress</h3>';
    html += '<div class="progress-wrap"><div class="progress-bar"><div class="progress-fill" style="width:'+prog.pct+'%"></div></div>';
    html += '<div class="progress-meta"><span>'+prog.done+' of '+prog.total+' steps complete</span><span>'+prog.pct+'%</span></div></div>';
    html += row('Current stage', curIdx >= STAGES.length ? 'Complete' : esc(STAGES[curIdx].label));
    html += row('Stages done',   Math.min(curIdx, STAGES.length)+' of '+STAGES.length);
    html += '</div>';
    html += '</div>'; // /grid

    // Helper banner
    html += '<div class="banner-info">\u2705 Tick items as you complete them \u2014 Maxwell gets a notification instantly. Use <strong>Request Client Visit</strong> below when you want Maxwell to bring the client.</div>';

    // ============ Vertical timeline of 5 stages — EXPANDABLE w/ live checkboxes ============
    html += '<div class="card" style="margin-bottom:14px"><h3>Build checklist \u00b7 your journey</h3>';
    html += '<div class="timeline">';
    STAGES.forEach(function(stage, i){
      const st  = stageStats(stage, pm);
      const cls = st.allDone ? 'done' : (i === curIdx ? 'current' : '');
      const dot = st.allDone ? '\u2713' : (i+1);
      const stepState = (pm[stage.key] && pm[stage.key].steps) || {};
      // Open the current stage by default
      const openCls = (i === curIdx && !st.allDone) ? ' open' : '';
      html += '<div class="tl-item expandable '+cls+openCls+'" id="tl-'+stage.key+'">';
      html += '<div class="tl-dot">'+dot+'</div>';
      html += '<div class="tl-content">';
      html += '<div class="tl-head" onclick="window.__toggleStage(\''+stage.key+'\')">';
      html += '<div>';
      html += '<div class="tl-label">'+stage.icon+' '+esc(stage.label)+'</div>';
      html += '<div class="tl-meta">'+(st.allDone
        ? 'Complete'
        : (i === curIdx
            ? st.done+' of '+st.total+' steps \u00b7 In progress'
            : st.total+' steps \u00b7 Upcoming'))+'</div>';
      html += '</div>';
      html += '<div class="count">'+st.done+'/'+st.total+(st.allDone?' \u2713':'')+'</div>';
      html += '</div>'; // /tl-head
      // Body: live checkboxes
      html += '<div class="tl-body">';
      stage.steps.forEach(function(stp){
        const checked = !!stepState[stp.key];
        const sid = 'chk-'+stage.key+'-'+stp.key;
        html += '<div class="step'+(checked?' done':'')+'" id="row-'+sid+'">';
        html += '<input type="checkbox" id="'+sid+'" '+(checked?'checked':'')+
                ' onchange="window.__check(\''+stage.key+'\',\''+stp.key+'\',this.checked)">';
        html += '<label for="'+sid+'">'+esc(stp.label)+'</label>';
        html += '</div>';
      });
      html += '</div>'; // /tl-body
      html += '</div>'; // /tl-content
      html += '</div>'; // /tl-item
    });
    html += '</div>'; // /timeline
    html += '</div>'; // /card

    // ============ Your Visit Requests ============
    if (visitRequests && visitRequests.length){
      html += '<div class="card" style="margin-bottom:14px"><h3>\ud83d\udcec Your visit requests</h3>';
      html += '<div style="font-size:13px;color:var(--text2);margin-bottom:10px">Status of the client-visit requests you\u2019ve sent.</div>';
      visitRequests.slice(0,8).forEach(function(r){
        const label = r.stage_item_label || 'Client visit';
        let pill='', body='';
        if (r.status === 'pending'){
          pill = '<span class="pill pill-pending">\u23f3 Waiting for agent</span>';
          body = '<div style="font-size:13px;color:var(--text2)">You proposed '+
                 fmtDateTime(r.proposed_date, r.proposed_time)+'</div>';
        } else if (r.status === 'approved'){
          pill = '<span class="pill pill-approved">\u2705 Confirmed</span>';
          body = '<div style="font-size:14px;font-weight:600;margin-top:4px">'+
                 fmtDateTime(r.final_date || r.proposed_date, r.final_time || r.proposed_time)+'</div>';
        } else if (r.status === 'rescheduled'){
          pill = '<span class="pill pill-resched">\ud83d\uddd3\ufe0f Agent proposed different time</span>';
          body  = '<div style="font-size:14px;font-weight:600;margin-top:4px">Agent suggests: '+
                  fmtDateTime(r.final_date, r.final_time)+'</div>';
          if (r.agent_response){
            body += '<div style="font-size:13px;color:var(--text2);font-style:italic;margin-top:4px">"'+
                    esc(r.agent_response)+'"</div>';
          }
          body += '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">';
          body += '<button class="btn btn-sm" onclick="window.__acceptReschedule(\''+r.id+'\')">\u2705 Accept new time</button>';
          body += '<button class="btn btn-outline btn-sm" onclick="window.__toggleCounter(\''+r.id+'\')">\ud83d\uddd3\ufe0f Propose another</button>';
          body += '</div>';
          body += '<div class="counter-form" id="counter-'+r.id+'">';
          body += '<div class="field-row">';
          body += '<div class="field"><label class="field-label">Date</label><input class="input" id="counter-date-'+r.id+'" type="date"></div>';
          body += '<div class="field"><label class="field-label">Time</label><input class="input" id="counter-time-'+r.id+'" type="time" value="10:00"></div>';
          body += '</div>';
          body += '<div class="field"><label class="field-label">Note (optional)</label><input class="input" id="counter-note-'+r.id+'" placeholder="e.g. Framing done mid-afternoon"></div>';
          body += '<button class="btn btn-sm" onclick="window.__submitCounter(\''+r.id+'\')">\ud83d\udce4 Send counter-proposal</button>';
          body += '</div>';
        } else if (r.status === 'declined'){
          pill = '<span class="pill pill-declined">\u274c Declined</span>';
          body = '<div style="font-size:13px;color:var(--text2)">'+esc(r.agent_response || 'Agent declined this request.')+'</div>';
        } else {
          pill = '<span class="pill" style="background:var(--card2);color:var(--text2)">'+esc(r.status)+'</span>';
        }
        html += '<div class="req-card">';
        html += '<div class="req-head"><div class="req-title">'+esc(label)+'</div>'+pill+'</div>';
        html += body;
        html += '</div>';
      });
      html += '</div>'; // /card
    }

    // ============ Request Client Visit ============
    html += '<div class="card" style="margin-bottom:14px"><h3>\ud83d\uddd3\ufe0f Request client visit</h3>';
    html += '<div style="font-size:13px;color:var(--text2);margin-bottom:14px">Need Maxwell to bring the client? Pick a date and a stage to show off.</div>';
    html += '<div class="field"><label class="field-label">Milestone / Reason</label><select class="input" id="visit-stage"></select></div>';
    html += '<div class="field-row">';
    html += '<div class="field"><label class="field-label">Date</label><input class="input" id="visit-date" type="date"></div>';
    html += '<div class="field"><label class="field-label">Time</label><input class="input" id="visit-time" type="time" value="10:00"></div>';
    html += '</div>';
    html += '<div class="field"><label class="field-label">Note to Maxwell (optional)</label><textarea class="input" id="visit-note" rows="2" placeholder="e.g. Framing is up \u2014 great time for a walk-through."></textarea></div>';
    html += '<button class="btn" onclick="window.__submitVisit()">\ud83d\udce4 Send request</button>';
    html += '<div id="visit-msg" style="margin-top:8px"></div>';
    html += '</div>';

    // ============ Add Custom Task ============
    html += '<div class="card" style="margin-bottom:14px"><h3>\u2795 Add custom task</h3>';
    html += '<div style="font-size:13px;color:var(--text2);margin-bottom:14px">Something not on the checklist? Add it here.</div>';
    html += '<div class="field"><label class="field-label">Task</label><input class="input" id="custom-label" placeholder="e.g. Landscaping sod installation"></div>';
    html += '<div class="field-row">';
    html += '<div class="field"><label class="field-label">Target date (optional)</label><input class="input" id="custom-due" type="date"></div>';
    html += '<div class="field" style="display:flex;align-items:flex-end"><button class="btn btn-outline" onclick="window.__addCustom()">Add task</button></div>';
    html += '</div>';
    html += '<div id="custom-list"></div>';
    html += '</div>';

    // ============ Self-revoke ============
    html += '<div class="card" style="margin-bottom:14px"><h3>\ud83d\udd12 This link</h3>';
    html += '<div style="font-size:12px;color:var(--text3);line-height:1.5">Auto-extends 90 days each time you visit. If you didn\u2019t request this link, revoke it now \u2014 Maxwell will be notified.</div>';
    html += '<button class="panic" onclick="window.__revoke()">\ud83d\udeab Revoke this link now</button>';
    html += '</div>';

    html += '<div class="footer">\ud83d\udd12 Secure link \u00b7 auto-extends with each visit<br>'+
            'Maxwell Delali Midodzi \u00b7 REALTOR\u00ae \u00b7 eXp Realty \u00b7 (709) 325-0545</div>';

    root.innerHTML = html;

    // Populate visit-stage dropdown + default date
    const sel = document.getElementById('visit-stage');
    if (sel){
      const items = [];
      STAGES.forEach(s => s.steps.forEach(st => items.push(s.label+' \u2014 '+st.label)));
      sel.innerHTML = '<option value="">-- Select milestone --</option>'+
        items.map(i => '<option value="'+esc(i)+'">'+esc(i)+'</option>').join('');
    }
    const vd = document.getElementById('visit-date');
    if (vd){ const d = new Date(); d.setDate(d.getDate()+3); vd.value = d.toISOString().slice(0,10); }

    renderCustomList();
  }

  function renderCustomList(){
    const host = document.getElementById('custom-list');
    if (!host) return;
    const customItems = (build.stage_history || []).filter(h => h.custom && h.added_by === 'builder');
    if (!customItems.length){ host.innerHTML = ''; return; }
    host.innerHTML = '<div style="margin-top:12px;font-size:12px;color:var(--text2);font-weight:600">Your custom tasks:</div>'+
      customItems.map(i => '<div class="custom-item"><span>'+esc(i.label)+'</span>'+
        (i.due_date?'<span class="due">Due '+fmtDate(i.due_date)+'</span>':'')+'</div>').join('');
  }

  // ── Window-scoped action handlers (called from inline onclick) ──────────
  window.__toggleStage = function(stageKey){
    const el = document.getElementById('tl-'+stageKey);
    if (el) el.classList.toggle('open');
  };

  window.__check = async function(stageKey, stepKey, checked){
    const res = await rpc('builder_check_step', {
      p_token: token, p_stage_key: stageKey, p_step_key: stepKey, p_checked: checked
    });
    if (!res || res.error){ toast('\u26a0\ufe0f Save failed \u2014 refresh and try again'); return; }
    // Update local state
    if (!build.pipeline_milestones) build.pipeline_milestones = {};
    if (!build.pipeline_milestones[stageKey]) build.pipeline_milestones[stageKey] = { done:false, steps:{} };
    build.pipeline_milestones[stageKey].steps = build.pipeline_milestones[stageKey].steps || {};
    build.pipeline_milestones[stageKey].steps[stepKey] = checked;
    // Toggle strikethrough on the row without full re-render
    const row = document.querySelector('#chk-'+stageKey+'-'+stepKey);
    if (row && row.closest('.step')) row.closest('.step').classList.toggle('done', checked);
    // Re-render to refresh banner / what's-next / progress / stage counts
    render();
    toast(checked ? '\u2705 Saved \u2014 Maxwell notified' : '\u21b6 Unchecked');
  };

  window.__submitVisit = async function(){
    const stageItem = document.getElementById('visit-stage').value;
    const date = document.getElementById('visit-date').value;
    const time = document.getElementById('visit-time').value;
    const note = (document.getElementById('visit-note').value || '').trim() || null;
    const msg  = document.getElementById('visit-msg');
    if (!stageItem || !date || !time){
      msg.className='msg-err'; msg.textContent='Please fill milestone, date, and time.'; return;
    }
    msg.className='msg-mute'; msg.textContent='Sending\u2026';
    const res = await rpc('builder_request_visit', {
      p_token: token, p_stage_item: stageItem, p_date: date, p_time: time, p_note: note
    });
    if (!res || res.error){ msg.className='msg-err'; msg.textContent='\u26a0\ufe0f Failed \u2014 try again'; return; }
    msg.className='msg-ok'; msg.textContent='\u2705 Request sent to Maxwell. He will confirm a time with the client.';
    document.getElementById('visit-note').value = '';
    toast('\ud83d\udce4 Visit request sent');
    // Reload to show the new request in "Your visit requests"
    setTimeout(function(){ loadAndRender(true); }, 600);
  };

  window.__addCustom = async function(){
    const label = (document.getElementById('custom-label').value || '').trim();
    const due   = document.getElementById('custom-due').value || null;
    if (!label){ toast('\u26a0\ufe0f Enter a task name'); return; }
    const res = await rpc('builder_add_custom', { p_token: token, p_label: label, p_due: due });
    if (!res || res.error){ toast('\u26a0\ufe0f Save failed'); return; }
    (build.stage_history = build.stage_history || []).push({
      label, custom:true, due_date:due, added_by:'builder', added_at:new Date().toISOString()
    });
    document.getElementById('custom-label').value = '';
    document.getElementById('custom-due').value = '';
    renderCustomList();
    toast('\u2705 Task added \u2014 Maxwell notified');
  };

  window.__toggleCounter = function(reqId){
    const el = document.getElementById('counter-'+reqId);
    if (el) el.classList.toggle('open');
  };

  window.__acceptReschedule = async function(reqId){
    const res = await rpc('builder_accept_reschedule', { p_token: token, p_request_id: reqId });
    if (res && res.ok){
      toast('\u2705 Accepted \u2014 the agent and client will be notified.');
      setTimeout(function(){ loadAndRender(true); }, 800);
    } else {
      toast('\u26a0\ufe0f Could not accept \u2014 try again');
    }
  };

  window.__submitCounter = async function(reqId){
    const date = document.getElementById('counter-date-'+reqId)?.value;
    const time = document.getElementById('counter-time-'+reqId)?.value || '10:00';
    const note = (document.getElementById('counter-note-'+reqId)?.value || '').trim() || null;
    if (!date){ toast('\u26a0\ufe0f Pick a date'); return; }
    const res = await rpc('builder_counter_reschedule', {
      p_token: token, p_request_id: reqId, p_date: date, p_time: time, p_note: note
    });
    if (res && res.ok){
      toast('\ud83d\udce4 Counter-proposal sent to agent.');
      setTimeout(function(){ loadAndRender(true); }, 800);
    } else {
      toast('\u26a0\ufe0f Could not send \u2014 try again');
    }
  };

  window.__revoke = async function(){
    if(!confirm('Revoke this link now?\n\nYou will lose access immediately. Contact Maxwell for a new link.')) return;
    const r = await rpc('builder_self_revoke', { p_token: token });
    if(r && r.ok){ toast('\ud83d\udeab Link revoked'); setTimeout(function(){showError('You revoked this link.');},1200); }
    else toast('\u26a0\ufe0f Could not revoke \u2014 call Maxwell at (709) 325-0545');
  };

  init();
})();
