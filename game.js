(() => {
  'use strict';
  const { Game, W, H, FIELD, MOVE_PAD, PLAYER_SCALE, CARDS, RESERVE, SKILLS, difficulty, clamp, seeded } = DodgeEngine;
  const $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const game = new Game();
  const ink = '#323735', red = '#ce633f', purple = '#8560ad', gold = '#b78a40';
  const colors = { spear: '#bd7639', beam: red, wave: gold, bind: purple, burst: '#c8734c' };
  const keys = new Set(), particles = [], floaters = [];
  const qaMode = new URLSearchParams(location.search).get('qa') === '1';
  const storageKey = 'dodge-again.records.release-01' + (qaMode ? '.qa' : '');
  let records = [], storageAvailable = true, sound = false, audioCtx;
  let lastStamp = 0, accumulator = 0, ambient = 0, toastUntil = 0, lastUI = 0;
  let hitFlash = 0, guideWasRunning = false, handledDeath = false, currentResult = null;
  let frameScale = 1, screenShake = 0;
  let recordBannerUntil = 0, resumeAt = 0;
  const pickupNames = { heal: '回血', shield: '护盾', slow: '时间减速', fragment: '成长碎片' };
  const pickupColors = { heal: '#66916f', shield: '#528caf', slow: '#698d96', fragment: '#b58a43' };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const paper = document.createElement('canvas'); paper.width = W; paper.height = H;
  const pc = paper.getContext('2d');
  function ellipse(c, x, y, rx, ry, fill, stroke, width = 1) {
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
  }
  function path(points, fill, stroke = ink, width = 2) {
    ctx.beginPath(); points(ctx);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  }
  function line(x1, y1, x2, y2, color, width = 1) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  function makePaper() {
    pc.fillStyle = '#f4eddf'; pc.fillRect(0, 0, W, H);
    const gradient = pc.createRadialGradient(800, 430, 100, 800, 430, 970);
    gradient.addColorStop(0, '#fff9ed88'); gradient.addColorStop(1, '#dac8a52d');
    pc.fillStyle = gradient; pc.fillRect(0, 0, W, H);
    const rng = seeded(216);
    for (let i = 0; i < 32000; i++) {
      pc.fillStyle = rng() > 0.5 ? 'rgba(123,98,66,.027)' : 'rgba(255,255,255,.1)';
      const size = rng() * 1.9; pc.fillRect(rng() * W, rng() * H, size, size);
    }
    pc.lineWidth = .6; pc.strokeStyle = '#a9977630';
    for (let y = 148; y < 850; y += 84) for (let x = 83; x < 1560; x += 94) {
      pc.beginPath(); pc.moveTo(x - 3, y - 3); pc.lineTo(x + 3, y + 3); pc.moveTo(x - 3, y + 3); pc.lineTo(x + 3, y - 3); pc.stroke();
    }
    pc.fillStyle = '#a9987930';
    pc.fillRect(0, 0, W, FIELD.top); pc.fillRect(0, FIELD.bottom, W, H-FIELD.bottom);
    pc.fillRect(0, FIELD.top, FIELD.left, FIELD.bottom-FIELD.top);
    pc.fillRect(FIELD.right, FIELD.top, W-FIELD.right, FIELD.bottom-FIELD.top);
    pc.strokeStyle = '#9c8a68'; pc.lineWidth = 2;
    pc.strokeRect(FIELD.left, FIELD.top, FIELD.right-FIELD.left, FIELD.bottom-FIELD.top);
    pc.font = '12px "PingFang SC",sans-serif'; pc.fillStyle = '#85775d'; pc.textAlign = 'center';
    pc.fillText('场地边界 · 沿边仍可移动', W/2, FIELD.bottom+18);

  }
  makePaper();
  function loadRecords() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
      records = Array.isArray(value) ? value.filter(r => r && Number.isFinite(r.time) && r.time >= 0 && typeof r.date === 'string').sort((a,b) => b.time-a.time).slice(0,10) : [];
    } catch { records = []; storageAvailable = false; }
    renderBoard();
  }
  function renderBoard() {
    $('best').replaceChildren(document.createTextNode(records.length ? records[0].time.toFixed(1) : '—'));
    const unit = document.createElement('span'); unit.textContent = '秒'; $('best').append(unit);
    const board = $('leaderboard'); board.replaceChildren();
    if (!records.length) {
      const empty = document.createElement('li'); empty.className = 'empty'; empty.textContent = '还没有成绩。\n第一笔纪录，等你来写。'; empty.style.whiteSpace = 'pre-line'; board.append(empty);
    }
    records.slice(0,3).forEach((r, i) => {
      const li = document.createElement('li'), rank = document.createElement('em'), name = document.createElement('span'), time = document.createElement('strong');
      rank.textContent = String(i + 1).padStart(2, '0'); name.textContent = '你'; time.textContent = r.time.toFixed(1) + ' s'; li.append(rank, name, time); board.append(li);
    });
    $('storage-note').textContent = storageAvailable ? '每次挑战，留下一点进步。' : '浏览器未允许保存；本次页面内仍可记录。';
  }
  function saveResult() {
    const time = Math.floor(game.time * 10) / 10;
    const previousBest = records[0]?.time ?? 0;
    const rank = records.filter(r => r.time > time).length + 1;
    const result = { time, date: new Date().toISOString(), wave: game.wave };
    records.push(result); records.sort((a,b) => b.time-a.time); records = records.slice(0,10);
    try { localStorage.setItem(storageKey, JSON.stringify(records)); }
    catch { storageAvailable = false; }
    renderBoard();
    currentResult = { rank: rank > 10 ? '10+' : String(rank), best: time > previousBest, time };
    return currentResult;
  }
  function soundEffect(type) {
    if (!sound) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.connect(g); g.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      const tones = { hit:[145,70,.11,'triangle'], heal:[510,900,.22,'sine'], beam:[290,110,.17,'sawtooth'], bind:[230,160,.1,'sine'], start:[430,650,.11,'sine'], death:[160,45,.5,'triangle'], level:[450,620,.13,'sine'] };
      const [a,b,d,t] = tones[type] || [280,190,.05,'triangle'];
      o.type = t; o.frequency.setValueAtTime(a,now); o.frequency.exponentialRampToValueAtTime(b,now+d);
      g.gain.setValueAtTime(.0001,now); g.gain.exponentialRampToValueAtTime(type==='hit' ? .08 : .025,now+.012); g.gain.exponentialRampToValueAtTime(.0001,now+d);
      o.start(now); o.stop(now+d+.015);
    } catch { sound = false; $('sound').innerHTML = '音效 <span>不可用</span>'; }
  }
  function toast(text, duration = 2.5) {
    $('toast').textContent = text; $('toast').classList.add('visible'); toastUntil = performance.now() + duration * 1000;
  }
  function start() {
    keys.clear(); particles.length = 0; floaters.length = 0; handledDeath = false; hitFlash = 0; screenShake = 0; accumulator = 0;
    for (const id of ['menu','pause-panel','result','guide-panel','upgrade-panel','record-banner']) $(id).hidden = true;
    $('hud').hidden = false; $('run-tools').hidden = false;
    resumeAt = 0; $('resume-countdown').hidden = true; game.start(records[0]?.time ?? null); canvas.focus({ preventScroll: true });
    toast('WASD 移动 · 敌人即将登场', 2); soundEffect('start'); updateHUD();
  }
  function pause(automatic = false) {
    if (game.status !== 'running') return;
    keys.clear(); game.pause(); resumeAt = 0; $('resume-countdown').hidden = true; $('pause-panel').hidden = false; showAttributes(); $('resume').focus({preventScroll:true});
    if (automatic) toast('已自动暂停，回来后继续');
  }
  function resume() {
    if (game.status !== 'paused') return;
    keys.clear(); $('pause-panel').hidden = true; game.resume(); beginCountdown(); accumulator = 0; canvas.focus({preventScroll:true});
  }
  function home() {
    keys.clear(); resumeAt = 0; $('resume-countdown').hidden = true; game.reset(); particles.length = 0; floaters.length = 0;
    for (const id of ['hud','pause-panel','result','guide-panel','upgrade-panel','run-tools','record-banner']) $(id).hidden = true;
    guideWasRunning = false;
    $('menu').hidden = false; $('toast').classList.remove('visible'); renderBoard();
  }
  function die() {
    if (handledDeath) return; handledDeath = true; keys.clear();
    updateHUD();
    const r = saveResult();
    $('result-tag').textContent = r.best ? 'A NEW PERSONAL BEST!' : 'ONE MORE TRY?';
    $('result-time').textContent = r.time.toFixed(1);
    $('death-reason').textContent = '最后一击：' + game.killedBy + '。下次，早点变向。';
    $('result-wave').textContent = game.wave; $('result-dodged').textContent = game.stats.dodged; $('result-rank').textContent = r.rank;
    $('result-save').textContent = storageAvailable ? '已保存到本机排行榜 · 成绩不与其他玩家共享' : '存储不可用，成绩仅保留在本次页面中';
    $('result').hidden = false; soundEffect('death');
  }
  function formatClock(t) { return String(Math.floor(t/60)).padStart(2,'0') + ':' + (t%60).toFixed(1).padStart(4,'0'); }
  function cardChange(kind) {
    const u = game.upgrades, a = game.attributes();
    return ({health: `${a.maxHp} → ${a.maxHp+100} 生命上限`, speed: `移速 +${a.speedBonus}% → +${a.speedBonus+4}%`,
      duration: `${a.powerDuration} → ${a.powerDuration+.5} 秒`, reach: `拾取范围 +${a.pickupBonus}% → +${a.pickupBonus+25}%`,
      shieldHaste: '格挡后：加速 15% · 2 秒', slowHeal: '使用减速：回复 60 生命', reserve: `${a.maxHp} → ${a.maxHp+25} 生命上限`})[kind];
  }
  function beginCountdown() {
    resumeAt = performance.now() + 1000; $('resume-countdown').hidden = false;
    $('resume-countdown').textContent = '准备走位 · 1';
  }
  function showAttributes() {
    const a = game.attributes();
    $('attribute-values').textContent = `生命上限 ${a.maxHp}　·　移速 +${a.speedBonus}%　·　拾取范围 +${a.pickupBonus}%　·　减速持续 ${a.powerDuration} 秒`;
    const list = $('owned-cards'); list.replaceChildren();
    for (const [kind,level] of Object.entries(game.upgrades)) if (level) {
      const li = document.createElement('li'); li.textContent = `${CARDS[kind].name} ${level}/${CARDS[kind].cap} · ${CARDS[kind].detail}`; list.append(li);
    }
    if (game.reserve) { const li = document.createElement('li'); li.textContent = `续航储备 ${game.reserve} 次 · 额外生命上限 +${game.reserve*25}`; list.append(li); }
    $('no-growth').hidden = list.children.length > 0;
  }
  function showUpgrades(focusSlot = 0, refreshing = false) {
    keys.clear(); accumulator = 0;
    $('upgrade-panel').hidden = false;
    const grid = $('upgrade-grid'); grid.replaceChildren();
    game.offers.forEach((kind, slot) => {
      const data = CARDS[kind] || RESERVE, wrap = document.createElement('div'); wrap.className = 'upgrade-option';
      const choose = document.createElement('button'); choose.className = 'upgrade-card'; choose.id = 'upgrade-' + kind; choose.dataset.upgrade = kind;
      const icon = document.createElement('i'), name = document.createElement('b'), value = document.createElement('strong'), detail = document.createElement('span'), level = document.createElement('small');
      icon.textContent = data.icon; name.textContent = data.name; value.textContent = cardChange(kind); detail.textContent = data.detail;
      level.textContent = kind === 'reserve' ? '全部成长满级后的持续补给' : `${data.branch} · 当前 ${game.upgrades[kind]}/${data.cap} 级`;
      const action = document.createElement('em'); action.textContent = `选择 · ${slot+1}`;
      choose.append(icon,name,value,detail,level,action); choose.addEventListener('click',()=>chooseUpgrade(kind));
      const refresh = document.createElement('button'); refresh.className = 'reroll'; refresh.dataset.slot = slot;
      refresh.disabled = !game.canReroll(slot); refresh.textContent = game.rerolled[slot] ? '已刷新 · 0 次' : refresh.disabled ? '暂无其他可替换卡片' : '↻ 刷新 · 1 次';
      refresh.setAttribute('aria-label', `刷新第 ${slot+1} 张卡片`);
      refresh.addEventListener('click',()=>{ if(game.reroll(slot)) { showUpgrades(slot,true); $('upgrade-feedback').textContent = `第 ${slot+1} 张已替换为${CARDS[game.offers[slot]].name}`; soundEffect('level'); } });
      wrap.append(choose,refresh); grid.append(wrap);
    });
    if (!refreshing) $('upgrade-feedback').textContent = game.offers.length < 3 ? '部分能力已满级，仅展示剩余可选成长。' : '每张卡可独立刷新一次 · 选择一张即可继续';
    grid.children[focusSlot]?.querySelector('.upgrade-card').focus({preventScroll:true}); updateHUD();
  }
  function chooseUpgrade(kind) {
    if (!game.chooseUpgrade(kind)) return;
    $('upgrade-panel').hidden = true; keys.clear(); accumulator = 0; beginCountdown();
    canvas.focus({preventScroll:true}); processEvents(); updateHUD();
  }
  function usePower() {
    if (performance.now() >= resumeAt && $('guide-panel').hidden && game.usePower()) { processEvents(); updateHUD(); }
  }
  function updateHUD() {
    const p = game.player, d = difficulty(game.time);
    $('hp').textContent = Math.ceil(p.hp); $('max-hp').textContent = '/ ' + p.maxHp;
    $('health-fill').style.width = p.hp / p.maxHp * 100 + '%'; $('health-fill').classList.toggle('low', p.hp <= 450);
    $('clock').textContent = formatClock(game.time);
    $('level').textContent = '强度 ' + String(d.level).padStart(2,'0'); $('wave').textContent = '第 ' + game.wave + ' 批';
    $('pace-fill').style.width = (game.time % 15) / 15 * 100 + '%';
    $('control').textContent = p.rootUntil > game.time ? '定身 ' + (p.rootUntil-game.time).toFixed(1) + 's' : p.rootImmuneUntil > game.time ? '防连控' : '';
    $('record-badge').hidden = !game.recordBroken;
    $('record-badge').textContent = game.previousBest === null ? '✦ 正在创造首个纪录' : '✦ 新纪录';
    $('power-label').textContent = game.held ? pickupNames[game.held] + ' · 空格使用' : game.shieldActive ? '护盾保护中 · 可抵挡 1 次' : '技能槽为空 · 去捡技能包';
    $('use-power').dataset.kind = game.held || (game.shieldActive ? 'shield' : '');
    $('use-power').classList.toggle('protecting', game.shieldActive);
    $('use-power').disabled = !game.held || game.status !== 'running' || (game.held === 'shield' && game.shieldActive) || (game.held === 'slow' && game.slowUntil > game.time);
    const buffs = [];
    if (game.shieldActive) buffs.push('护盾 · 可抵挡 1 次');
    if (game.slowUntil > game.time) buffs.push('减速 ' + (game.slowUntil-game.time).toFixed(1) + 's');
    if (game.hasteUntil > game.time) buffs.push('疾行 ' + (game.hasteUntil-game.time).toFixed(1) + 's');
    $('active-power').textContent = buffs.join(' · ');
    $('fragment-count').textContent = game.fragments + ' / 3';
    $('growth-summary').textContent = '成长 ' + Object.values(game.upgrades).reduce((a,b)=>a+b,0) + ' 次 · 移速 +' + game.upgrades.speed*4 + '%';
  }
  function burstParticles(x, y, color, amount = 12) {
    for (let i = 0; i < amount; i++) { const angle = Math.random()*Math.PI*2, speed = 25+Math.random()*100;
      particles.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life:.35+Math.random()*.3,max:.65,color}); }
  }
  function pickupFeedback(x, y, color, text, subtitle = '') {
    burstParticles(x, y, color, 16);
    const nearby = floaters.filter(f => f.pickup && Math.abs(f.anchorX-x)<150 && Math.abs(f.anchorY-y)<130);
    if (nearby.length >= 3) floaters.splice(floaters.indexOf(nearby.shift()),1);
    let lane = 0; while (nearby.some(f=>f.lane===lane)) lane++;
    const below = y < FIELD.top+150;
    floaters.push({x:clamp(x,FIELD.left+120,FIELD.right-120),
      y: below ? y+55+lane*42 : y-45-lane*42,
      anchorX:x,anchorY:y,lane,pickup:true,subtitle,text,color,life:1.2,below});
    soundEffect('heal');
  }
  function processEvents() {
    for (const e of game.drainEvents()) {
      if (e.type === 'hit') { hitFlash = .2; screenShake = reducedMotion ? 0 : 4; burstParticles(e.x,e.y,red); floaters.push({x:e.x,y:e.y-38,text:'−'+e.amount,color:red,life:.9}); soundEffect('hit'); }
      if (e.type === 'heal') pickupFeedback(e.x,e.y,'#518560',e.amount>0?'+'+e.amount:'满血 · 血包已拾取');
      if (e.type === 'pickupSpawn') toast(pickupNames[e.kind] + '出现 · 8 秒后消失', 1.7);
      if (e.type === 'powerCollected') { pickupFeedback(e.x,e.y,pickupColors[e.kind],(e.replaced?'替换为':'拾取')+(e.kind==='slow'?'减速':'护盾'),'空格启用'); updateHUD(); }
      if (e.type === 'powerUsed') { toast(e.kind === 'shield' ? '护盾生效 · 抵挡下一次攻击，拾取新技能包会替换' : pickupNames[e.kind] + '生效 · ' + e.duration + ' 秒', 2); soundEffect('start'); }
      if (e.type === 'shieldBlock') { burstParticles(e.x,e.y,'#659eb9',16); floaters.push({x:e.x,y:e.y-40,text:'护盾破裂 · 已格挡',color:'#287caa',life:1}); soundEffect('heal'); }
      if (e.type === 'fragment') pickupFeedback(e.x,e.y,gold,'碎片 '+e.count+' / 3',e.count===3?'已集齐 · 即将选择成长':'');
      if (e.type === 'upgradeReady') showUpgrades();
      if (e.type === 'upgradeChosen') { toast('已获得：' + (CARDS[e.kind] || RESERVE).name, 2.2); soundEffect('level'); }
      if (e.type === 'record') {
        $('record-banner').textContent = e.first ? '✦ 第一场挑战，正在写下你的纪录。' : '✦ 新纪录！已经超过 ' + game.previousBest.toFixed(1) + ' 秒';
        $('record-banner').hidden = false; recordBannerUntil = performance.now() + 3200; updateHUD(); soundEffect('level');
      }
      // Root countdown stays beside the player, without a competing fixed-duration toast.
      if (e.type === 'level') { toast('强度提升 · ' + String(e.level).padStart(2,'0'), 1.7); soundEffect('level'); }
      if (e.type === 'cast') soundEffect(e.kind);
      if (e.type === 'death') die();
    }
  }
  function drawBean(x,y,scale=PLAYER_SCALE,p=game.player) {
    ctx.save(); ctx.translate(x,y); ctx.scale(scale,scale);
    const moving = Math.hypot(p.vx,p.vy)>5 && game.status==='running';
    const step = moving ? Math.sin(game.time*20) : 0;
    ellipse(ctx,0,20,21,6,'#63583b20');
    ctx.rotate(moving ? p.vx / 355 * .07 : 0);
    if (game.time < p.invulnerableUntil && Math.floor(game.time*35)%2) ctx.globalAlpha=.55;
    ctx.lineCap='round'; line(-8,15,-10-step*3,25,ink,3); line(9,15,11+step*3,25,ink,3);
    path(c=>{c.moveTo(-18,7);c.bezierCurveTo(-22,-10,-13,-28,0,-28);c.bezierCurveTo(16,-28,21,-10,19,9);c.quadraticCurveTo(15,22,4,17);c.quadraticCurveTo(-12,22,-18,7);},'#83b8d6',ink,2.5);
    path(c=>{c.moveTo(-11,-18);c.quadraticCurveTo(-3,-25,4,-20);},null,'#c7e3ed',3);
    line(-18,1,-22,10,ink,2.5); line(19,0,23,8,ink,2.5);
    const eyeX=clamp(p.vx/180,-2,2),eyeY=clamp(p.vy/220,-1.5,1.5);
    ellipse(ctx,-7,-10,5,6,'#fff9e8',ink,1);ellipse(ctx,7,-10,5,6,'#fff9e8',ink,1);
    ellipse(ctx,-7+eyeX,-10+eyeY,1.8,2.4,ink);ellipse(ctx,7+eyeX,-10+eyeY,1.8,2.4,ink);
    path(c=>{c.moveTo(-2,2);c.quadraticCurveTo(1,4,4,1);},null,ink,1.4);
    ellipse(ctx,-12,-1,3,1.4,'#d69d9877');ellipse(ctx,13,-1,3,1.4,'#d69d9877');
    ctx.restore();
    if (p.rootUntil > game.time && game.status !== 'ready') {
      ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.strokeStyle=purple;ctx.lineWidth=2.5;ctx.setLineDash([6,4]);ellipse(ctx,0,21,28,9,null,purple,2);ctx.setLineDash([]);
      line(-23,12,20,-6,purple,2);line(-20,-4,20,14,purple,2);ctx.restore();
      ctx.font='bold 16px "PingFang SC",sans-serif'; ctx.textAlign='center'; ctx.fillStyle=purple;
      ctx.fillText('定身 ' + Math.max(.1,p.rootUntil-game.time).toFixed(1) + 's',x,y+53>FIELD.bottom?y-43:y+53);
    } else if (p.rootImmuneUntil > game.time && game.status !== 'ready') ellipse(ctx,x,y+21*scale,26*scale,8*scale,null,'#8868ad77',1.5);
  }
  function drawEnemy(e) {
    const age=game.time-e.born;
    const alpha=e.fired ? clamp((e.leaveAt-game.time)/.62,0,1) : clamp(age/.25,0,1);
    ctx.save();ctx.translate(e.x,e.y);ctx.globalAlpha=alpha;
    if(e.fired)ctx.translate(e.side===1? (1-alpha)*18:e.side===3? -(1-alpha)*18:0,e.side===0?-(1-alpha)*15:e.side===2?(1-alpha)*15:0);
    const col=colors[e.kind];ellipse(ctx,0,17,24,6,'#6652371f');
    if(!e.fired){ctx.beginPath();ctx.ellipse(0,18,28,10,0,-Math.PI/2,-Math.PI/2+Math.PI*2*clamp(age/(e.fireAt-e.born),0,1));ctx.strokeStyle=col+'b0';ctx.lineWidth=2;ctx.stroke();}
    line(-7,14,-10,22,ink,2);line(7,14,10,22,ink,2);
    const robe=e.kind==='bind'?'#9b85b3':e.kind==='beam'?'#bc7d65':e.kind==='wave'?'#bda875':e.kind==='burst'?'#ac8b7d':'#bca58c';
    path(c=>{c.moveTo(-8,-8);c.quadraticCurveTo(-15,3,-19,16);c.quadraticCurveTo(0,23,19,14);c.lineTo(8,-9);c.closePath();},robe,ink,2);
    ellipse(ctx,0,-15,10,12,'#e9ddc4',ink,2);
    if(e.kind==='bind'||e.kind==='burst'){
      path(c=>{c.moveTo(-13,-11);c.lineTo(-7,-30);c.lineTo(3,-38);c.lineTo(16,-10);c.quadraticCurveTo(6,-21,-13,-11);},robe,ink,2);
    } else if(e.kind==='beam') { path(c=>{c.moveTo(-8,-23);c.quadraticCurveTo(0,-33,9,-23);},null,ink,2); }
    ellipse(ctx,-3,-15,1.8,2.2,ink);ellipse(ctx,4,-15,1.8,2.2,ink);
    const angle=Math.atan2(e.dy,e.dx);ctx.save();ctx.translate(0,-2);ctx.rotate(angle);
    line(4,0,22,0,ink,3);
    if(e.kind==='spear') {line(12,0,40,0,'#956b43',3);path(c=>{c.moveTo(46,0);c.lineTo(35,-4);c.lineTo(37,0);c.lineTo(35,4);c.closePath();},'#b78f56',ink,1);}
    else {ellipse(ctx,25,0,6,6,col,ink,1.3);if(e.locked&&!e.fired)ellipse(ctx,25,0,10+Math.sin(ambient*18)*2,10+Math.sin(ambient*18)*2,null,col+'88',2);}
    ctx.restore();ctx.restore();
  }
  function drawWarnings() {
    for(const e of game.enemies){
      if(e.fired||!e.locked)continue;
      const progress=clamp(1-(e.fireAt-game.time)/e.lockBefore,0,1), col=colors[e.kind];
      if(e.kind==='beam'){
        ctx.save();ctx.translate(e.x,e.y);ctx.rotate(Math.atan2(e.dy,e.dx));
        ctx.fillStyle='rgba(204,99,63,'+(.065+progress*.07)+')';ctx.fillRect(0,-19,1900,38);
        ctx.setLineDash([9,9]);line(0,-19,1900,-19,col+'9c',1);line(0,19,1900,19,col+'9c',1);ctx.setLineDash([]);
        line(0,0,1900,0,col+'55',1);
        ctx.globalAlpha=.2+progress*.3;for(let x=0;x<1800*progress;x+=34){line(x,-14,x+13,14,col,2);}ctx.restore();
      }else if(e.kind==='burst'){
        ctx.save();ctx.setLineDash([5,8]);ellipse(ctx,e.target.x,e.target.y,SKILLS.burst.radius,SKILLS.burst.radius,null,col+'77',1.3);ctx.restore();
      }else{
        const length=e.kind==='wave'?160:125;ctx.save();ctx.setLineDash([4,9]);line(e.x,e.y,e.x+e.dx*length,e.y+e.dy*length,col+'88',1.5);ctx.restore();
      }
    }
  }
  function drawAttack(a) {
    const col=colors[a.kind];
    ctx.save();ctx.translate(a.x,a.y);
    if(a.kind==='burst'){
      const progress=clamp(a.age/a.delay,0,1),r=a.radius;
      if(a.age<a.delay){
        ellipse(ctx,0,0,r,r,'#c8734c10',col+'ae',2);
        ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,r,-Math.PI/2,-Math.PI/2+Math.PI*2*progress);ctx.closePath();ctx.fillStyle='#c8734c24';ctx.fill();
        ctx.setLineDash([4,7]);ellipse(ctx,0,0,r-8,r-8,null,col+'88',1);ctx.setLineDash([]);
        line(-8,0,8,0,col,1.5);line(0,-8,0,8,col,1.5);
      }else{
        const fade=1-(a.age-a.delay)/.4;ctx.globalAlpha=fade;ellipse(ctx,0,0,r,r,'#d5774960',col,3);
        for(let i=0;i<12;i++){const angle=i/12*Math.PI*2;line(Math.cos(angle)*r*.3,Math.sin(angle)*r*.3,Math.cos(angle)*r*.9,Math.sin(angle)*r*.9,'#f6dfb4',3);}
        ellipse(ctx,0,0,r*(1.1-fade*.3),r*(1.1-fade*.3),null,col,2);
      }
      ctx.restore();return;
    }
    ctx.rotate(Math.atan2(a.dy,a.dx));
    if(a.kind==='spear'){
      const gradient=ctx.createLinearGradient(-115,0,20,0);gradient.addColorStop(0,'#bc8e4300');gradient.addColorStop(1,'#bc8e43aa');
      line(-115,0,19,0,gradient,3);line(-28,0,14,0,'#885e34',2.5);
      path(c=>{c.moveTo(27,0);c.lineTo(10,-5);c.lineTo(14,0);c.lineTo(10,5);c.closePath();},'#dec183',ink,1.3);
      line(-24,-4,-18,0,'#947146',2);line(-24,4,-18,0,'#947146',2);
    }else if(a.kind==='bind'){
      for(let i=5;i>=1;i--)ellipse(ctx,-i*9,Math.sin(a.age*17-i)*3,12-i,10-i,col+(32-i*4).toString(16).padStart(2,'0'));
      ellipse(ctx,0,0,18,18,'#8560ad1a');ellipse(ctx,0,0,13,13,'#79549b',ink,1.8);
      ellipse(ctx,0,0,7,7,'#c7b2df');ellipse(ctx,-2,-3,3,3,'#f8edff');
      ctx.setLineDash([4,7]);ellipse(ctx,0,0,20,20,null,'#8560ad66',1);ctx.setLineDash([]);
    }else if(a.kind==='wave'){
      const half=a.width/2;
      path(c=>{c.moveTo(-17,-half);c.quadraticCurveTo(43,0,-17,half);c.quadraticCurveTo(8,0,-17,-half);},'#d2ae6350',gold,2.2);
      path(c=>{c.moveTo(-16,-half+7);c.quadraticCurveTo(22,0,-16,half-7);},null,'#fff4c5',3);
      path(c=>{c.moveTo(-35,-half+12);c.quadraticCurveTo(2,0,-35,half-12);},null,'#b78a4040',2);
    }else if(a.kind==='beam'){
      ctx.globalAlpha=Math.min(1,(a.life-a.age)/.15);ctx.fillStyle='#cd5b3850';ctx.fillRect(0,-25,1900,50);
      ctx.fillStyle='#d76e43';ctx.fillRect(0,-18,1900,36);ctx.fillStyle='#f5c27c';ctx.fillRect(0,-9,1900,18);ctx.fillStyle='#fff4d6';ctx.fillRect(0,-3,1900,6);
    }
    ctx.restore();
  }
  function drawPickup(h) {
    const kind=h.kind||'heal',col=pickupColors[kind],remaining=Math.max(0,h.expires-game.time);
    ctx.save();ctx.translate(h.x,h.y);
    ellipse(ctx,0,18,19,5,col+'22');ellipse(ctx,0,0,27,27,null,col+'35',1.5);
    ctx.beginPath();ctx.arc(0,0,28,-Math.PI/2,-Math.PI/2+Math.PI*2*clamp(remaining/8,0,1));ctx.strokeStyle=col;ctx.lineWidth=2;ctx.stroke();
    ctx.save();ctx.translate(0,Math.sin(game.time*3)*2);
    if(remaining<=3&&!reducedMotion)ctx.globalAlpha=.65+.35*Math.sin(game.time*14);
    if(kind==='heal'){
      path(c=>{c.moveTo(-5,-19);c.lineTo(-5,-11);c.bezierCurveTo(-24,-3,-17,21,0,20);c.bezierCurveTo(18,21,24,-3,5,-11);c.lineTo(5,-19);c.closePath();},'#79a384',ink,1.8);
      ctx.fillStyle='#b9ca99';ctx.fillRect(-7,-22,14,5);ctx.strokeStyle=ink;ctx.lineWidth=1.4;ctx.strokeRect(-7,-22,14,5);
      line(-6,3,6,3,'#f9f5df',4);line(0,-3,0,9,'#f9f5df',4);
    }else if(kind==='shield'){
      path(c=>{c.moveTo(0,-21);c.quadraticCurveTo(9,-14,17,-15);c.lineTo(16,0);c.quadraticCurveTo(13,15,0,22);c.quadraticCurveTo(-13,15,-16,0);c.lineTo(-17,-15);c.quadraticCurveTo(-9,-14,0,-21);},'#87b4ca',ink,1.8);
      path(c=>{c.moveTo(0,-12);c.lineTo(0,12);c.moveTo(-7,-6);c.lineTo(7,-6);},null,'#f8f6e4',2.5);
    }else if(kind==='slow'){
      ellipse(ctx,0,0,20,20,'#afc8c5',ink,1.8);ellipse(ctx,0,0,15,15,'#eff2df',col,1);
      line(0,0,0,-10,col,2.5);line(0,0,8,4,col,2.5);ellipse(ctx,0,0,2.5,2.5,col);
      for(let i=0;i<4;i++){const angle=i*Math.PI/2;line(Math.cos(angle)*12,Math.sin(angle)*12,Math.cos(angle)*15,Math.sin(angle)*15,col,1);}
    }else{
      path(c=>{c.moveTo(0,-23);c.lineTo(15,-2);c.lineTo(0,23);c.lineTo(-15,-2);c.closePath();},'#e1c584',ink,1.6);
      path(c=>{c.moveTo(0,-23);c.lineTo(0,23);c.moveTo(-15,-2);c.lineTo(15,-2);},null,'#fff4ca',1.5);
    }
    ctx.restore();
    ctx.fillStyle='#f9f2e5ee';ctx.fillRect(-58,34,116,34);
    ctx.font='600 14px "PingFang SC",sans-serif';ctx.textAlign='center';ctx.fillStyle=remaining<=3?red:col;
    ctx.fillText(pickupNames[kind]+' '+remaining.toFixed(1)+'s',0,48);
    if(game.held&&['shield','slow'].includes(kind)){ctx.font='11px "PingFang SC",sans-serif';ctx.fillStyle='#978770';ctx.fillText('拾取替换当前' + pickupNames[game.held],0,64);}
    ctx.restore();
  }
  function render() {
    ctx.setTransform(frameScale,0,0,frameScale,0,0);ctx.clearRect(0,0,W,H);ctx.drawImage(paper,0,0);
    ctx.save();
    if(screenShake>0)ctx.translate(Math.sin(ambient*100)*screenShake,Math.cos(ambient*87)*screenShake*.5);
    if(game.status==='ready'){
      // A quiet sketch in the margins of the opening page, not an active match.
      const samples=[{kind:'spear',x:95,y:205,dx:.9,dy:.3,side:3},{kind:'bind',x:1490,y:685,dx:-1,dy:-.4,side:1},{kind:'wave',x:1300,y:140,dx:-.6,dy:.8,side:0}];
      for(const s of samples)drawEnemy({...s,born:-1,fireAt:50,fired:false,locked:false});
      drawBean(850,737,1.3,{vx:0,vy:0,rootUntil:0,rootImmuneUntil:0,invulnerableUntil:0});
    }else{
      if (game.edgeContact) {
        const p = game.player, edge = game.edgeContact;
        if (edge==='left'||edge==='right') line(FIELD[edge],Math.max(FIELD.top,p.y-40),FIELD[edge],Math.min(FIELD.bottom,p.y+40),'#528caf',5);
        else line(Math.max(FIELD.left,p.x-40),FIELD[edge],Math.min(FIELD.right,p.x+40),FIELD[edge],'#528caf',5);
      }
      drawWarnings();
      for(const a of game.attacks)if(a.kind==='burst')drawAttack(a);
      for(const h of game.pickups)drawPickup(h);
      for(const e of game.enemies)drawEnemy(e);
      for(const a of game.attacks)if(a.kind!=='burst')drawAttack(a);
      if(game.slowUntil>game.time){
        ctx.save();ctx.setLineDash([6,8]);ellipse(ctx,game.player.x,game.player.y,41,41,null,'#699ca977',1.4);ctx.restore();
      }
      drawBean(game.player.x,game.player.y);
      if(game.shieldActive){
        const x=game.player.x, y=game.player.y;
        ctx.save();
        ctx.shadowColor='#4aafe3';ctx.shadowBlur=reducedMotion?5:9;
        ellipse(ctx,x,y-3,34,39,'#5bbcec38','#2588bd',3.5);
        ctx.shadowBlur=0;
        ellipse(ctx,x,y-3,29,34,null,'#ddf6ff',1.6);
        path(c=>{c.arc(x,y-3,35,-2.6,-1.3);},null,'#effcff',4);
        const labelY=y< FIELD.top+75?y+56:y-54;
        ctx.fillStyle='#e6f6ff';ctx.strokeStyle='#2588bd';ctx.lineWidth=1.5;
        ctx.fillRect(x-39,labelY-14,78,22);ctx.strokeRect(x-39,labelY-14,78,22);
        ctx.font='bold 13px "PingFang SC",sans-serif';ctx.textAlign='center';ctx.fillStyle='#226b94';
        ctx.fillText('护盾 · 1 次',x,labelY+1);
        ctx.restore();
      }else if(game.held==='shield'){
        ctx.save();ctx.font='12px "PingFang SC",sans-serif';ctx.textAlign='center';ctx.fillStyle='#397b9f';
        ctx.fillText('护盾待启用 · 空格',game.player.x,game.player.y<FIELD.top+70?game.player.y+48:game.player.y-42);
        ctx.restore();
      }
      if(game.player.hp<=250 && game.status==='running'){
        const v=ctx.createRadialGradient(800,450,350,800,450,900);v.addColorStop(0,'#a83c2500');v.addColorStop(1,'#a83c25'+Math.floor(13+Math.sin(ambient*3)*6).toString(16).padStart(2,'0'));ctx.fillStyle=v;ctx.fillRect(0,0,W,H);
      }
    }
    for(const p of particles){ctx.globalAlpha=Math.max(0,p.life/p.max);ellipse(ctx,p.x,p.y,2.3,2.3,p.color);}ctx.globalAlpha=1;
    for(const f of floaters){
      ctx.save();ctx.globalAlpha=Math.min(1,f.life*2);ctx.textAlign='center';
      ctx.font=f.pickup?'bold 20px "PingFang SC",sans-serif':'bold 19px Georgia';
      ctx.fillStyle=f.color;
      if(f.pickup){ctx.strokeStyle='#fff8eb';ctx.lineWidth=4;ctx.lineJoin='round';ctx.strokeText(f.text,f.x,f.y);}
      ctx.fillText(f.text,f.x,f.y);
      if(f.subtitle){ctx.font='600 13px "PingFang SC",sans-serif';ctx.lineWidth=3;ctx.strokeText(f.subtitle,f.x,f.y+19);ctx.fillText(f.subtitle,f.x,f.y+19);}
      ctx.restore();
    }
    ctx.globalAlpha=1;
    if(hitFlash>0){ctx.fillStyle='rgba(182,66,43,'+hitFlash*.18+')';ctx.fillRect(0,0,W,H);}
    ctx.restore();
  }
  function resize() {
    const width=canvas.getBoundingClientRect().width;
    frameScale=clamp(width*(window.devicePixelRatio||1)/W,.4,1.6);
    canvas.width=Math.round(W*frameScale);canvas.height=Math.round(H*frameScale);
    frameScale=canvas.width/W;
    render();
  }
  function frame(stamp) {
    const dt=lastStamp?Math.min((stamp-lastStamp)/1000,.08):0;lastStamp=stamp;ambient+=dt;
    if(game.status==='running' && stamp >= resumeAt){
      $('resume-countdown').hidden = true;
      accumulator+=dt;
      const input={up:keys.has('KeyW'),left:keys.has('KeyA'),down:keys.has('KeyS'),right:keys.has('KeyD')};
      while(accumulator>=1/120&&game.status==='running'){game.tick(1/120,input);accumulator-=1/120;}
      processEvents();
      if(stamp-lastUI>60){updateHUD();lastUI=stamp;}
    }else accumulator=0;
    if(game.status!=='paused'&&game.status!=='upgrading'){
      for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;if(p.life<=0)particles.splice(i,1);}
      for(let i=floaters.length-1;i>=0;i--){floaters[i].life-=dt;if(!reducedMotion)floaters[i].y+=dt*28*(floaters[i].below?1:-1);if(floaters[i].life<=0)floaters.splice(i,1);}
      hitFlash=Math.max(0,hitFlash-dt);screenShake=Math.max(0,screenShake-dt*30);
    }
    if(stamp>toastUntil)$('toast').classList.remove('visible');
    if(stamp>recordBannerUntil)$('record-banner').hidden=true;
    render();requestAnimationFrame(frame);
  }
  document.addEventListener('keydown',e=>{
    const panel = ['guide-panel','upgrade-panel','pause-panel','result'].map($).find(el=>!el.hidden);
    if(e.code==='Tab' && panel) {
      const buttons=[...panel.querySelectorAll('button:not(:disabled)')];
      if(buttons.length){const i=buttons.indexOf(document.activeElement);if(i<0 || (!e.shiftKey && i===buttons.length-1) || (e.shiftKey && i===0)){e.preventDefault();buttons[e.shiftKey?buttons.length-1:0].focus();}}
    }

    if(e.code==='Space'&&game.status==='running'){
      e.preventDefault();if(!e.repeat)usePower();return;
    }
    if(game.status==='upgrading'&&!$('upgrade-panel').hidden&&['Digit1','Digit2','Digit3'].includes(e.code)&&$('guide-panel').hidden){
      e.preventDefault();if(!e.repeat)chooseUpgrade(game.offers[Number(e.code.slice(-1))-1]);return;
    }
    if(['KeyW','KeyA','KeyS','KeyD'].includes(e.code)){
      if(game.status==='running'){e.preventDefault();keys.add(e.code);}return;
    }
    if(e.code==='Escape'){
      if(e.repeat)return;
      if(!$('guide-panel').hidden){closeGuide();return;}
      if(game.status==='running')pause();else if(game.status==='paused')resume();
    }
  });
  document.addEventListener('keyup',e=>keys.delete(e.code));
  window.addEventListener('blur',()=>{keys.clear();pause(true);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();pause(true);}});
  $('start').addEventListener('click',start);$('restart').addEventListener('click',start);
  document.querySelector('.wordmark').addEventListener('click',e=>{e.preventDefault();home();});
  $('use-power').addEventListener('click',()=>{usePower();canvas.focus({preventScroll:true});});
  $('attributes').addEventListener('click',()=>pause());
  $('pause').addEventListener('click',()=>pause());$('resume').addEventListener('click',resume);
  $('pause-home').addEventListener('click',home);$('result-home').addEventListener('click',home);
  $('guide').addEventListener('click',()=>{guideWasRunning=game.status==='running';if(guideWasRunning){game.pause();keys.clear();}$('guide-panel').hidden=false;});
  function closeGuide(){ $('guide-panel').hidden=true;if(guideWasRunning){game.resume();beginCountdown();keys.clear();canvas.focus({preventScroll:true});}guideWasRunning=false; }
  $('close-guide').addEventListener('click',closeGuide);
  $('sound').addEventListener('click',()=>{sound=!sound;$('sound').setAttribute('aria-pressed',String(sound));$('sound').innerHTML='音效 <span>'+(sound?'开':'关')+'</span>';if(sound)soundEffect('start');});
  $('fullscreen').addEventListener('click',async()=>{
    try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
    catch{toast('当前浏览器不支持全屏，可放大窗口试玩');}
  });
  new ResizeObserver(resize).observe($('arena'));
  window.addEventListener('resize',resize);
  loadRecords();resize();requestAnimationFrame(frame);
  // Read-only telemetry supports repeatable QA without changing a live run or its score.
  window.dodgeDiagnostics = () => ({status:game.status,time:game.time,wave:game.wave,level:difficulty(game.time).level,
    player:{...game.player},enemies:game.enemies.map(e=>({kind:e.kind,x:e.x,y:e.y,locked:e.locked,fired:e.fired,dx:e.dx,dy:e.dy,target:{...e.target}})),
    attacks:game.attacks.map(a=>({kind:a.kind,x:a.x,y:a.y,dx:a.dx,dy:a.dy,age:a.age})),pickups:game.pickups.map(h=>({...h})),
    stats:JSON.parse(JSON.stringify(game.stats)),canvas:{width:canvas.width,height:canvas.height},storageAvailable,records:records.length,
    offers:[...game.offers],rerolled:[...game.rerolled],attributes:game.attributes(),edgeContact:game.edgeContact,resuming:performance.now()<resumeAt,held:game.held,shieldActive:game.shieldActive,slowUntil:game.slowUntil,fragments:game.fragments,upgrades:{...game.upgrades},
    recordBroken:game.recordBroken,previousBest:game.previousBest,keys:[...keys],particles:particles.length});
})();
