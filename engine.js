(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DodgeEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const W = 1600, H = 900;
  const FIELD = { left: 24, right: 1576, top: 84, bottom: 844 };
  const PLAYER_SCALE = 0.9; // Fixed for the entire run, independent of difficulty.
  const MOVE_PAD = { x: 26 * PLAYER_SCALE, top: 30 * PLAYER_SCALE, bottom: 28 * PLAYER_SCALE };
  const CARDS = {
    health: { name: '强健体魄', icon: '♥', cap: 3, branch: '生存', detail: '生命上限 +100，同时回复 100' },
    speed: { name: '轻盈步伐', icon: '↗', cap: 3, branch: '走位', detail: '移动速度 +4%，最多 +12%' },
    duration: { name: '效果延长', icon: '◷', cap: 2, branch: '道具', detail: '时间减速持续时间 +0.5 秒' },
    reach: { name: '伸手可及', icon: '✧', cap: 2, branch: '补给', detail: '拾取范围 +25%，最多 +50%' },
    shieldHaste: { name: '护盾疾行', icon: '◇', cap: 1, branch: '道具', detail: '护盾成功格挡后，移动速度 +15%，持续 2 秒' },
    slowHeal: { name: '时间喘息', icon: '◌', cap: 1, branch: '道具', detail: '使用时间减速时回复 60 生命' }
  };
  const RESERVE = { name: '续航储备', icon: '♥', cap: Infinity, branch: '满级补给', detail: '卡池已满级：生命上限 +25，同时回复 25' };
  function supply(t) {
    const stage = Math.min(3, Math.floor(t / 30));
    return { heal: [[16,20],[10,13],[7,9],[6,8]][stage], power: [[12,16],[10,13],[8,11],[7,10]][stage], fragment: [[9,12],[8,11],[7,10],[6,9]][stage] };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function segmentDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }
  function seeded(seed) {
    return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function difficulty(t) {
    const level = 1 + Math.floor(t / 15);
    return { level, interval: Math.max(1.25, 4.1 * Math.exp(-t / 75)),
      min: Math.min(5, 1 + Math.floor(t / 30)), max: Math.min(9, 3 + Math.floor(t / 20)),
      speed: 1 + Math.min(t / 180, 0.8), charge: Math.max(1.05, 1.65 - t / 200) };
  }
  const SKILLS = {
    spear: { name: '长矛', damage: 100, speed: 560, radius: 7 },
    beam: { name: '灼光射线', damage: 150, radius: 19 },
    wave: { name: '弧形冲击波', damage: 120, speed: 310, radius: 12, width: 190 },
    bind: { name: '禁锢暗球', damage: 65, speed: 370, radius: 13 },
    burst: { name: '落星轰击', damage: 130, radius: 112 }
  };
  const WIDE_SKILLS = ['beam', 'wave', 'burst'];
  const ATTACK_RULES = { wideLimit: 3, totalLimit: 18, keyGap: .42, maxScheduleShift: .8 };
  class Game {
    constructor(rng = Math.random) { this.rng = rng; this.reset(); }
    reset() {
      this.status = 'ready'; this.time = 0; this.wave = 0; this.nextWave = 1.1;
      this.player = { x: 800, y: 488, r: 16 * PLAYER_SCALE, hp: 1000, maxHp: 1000, vx: 0, vy: 0,
        rootUntil: 0, rootImmuneUntil: 0, invulnerableUntil: 0 };
      this.enemies = []; this.attacks = []; this.pickups = []; this.events = [];
      this.lastWideEvent = -Infinity;
      this.nextHealCheck = 18; this.id = 0;
      this.stats = { hits: 0, damage: 0, healing: 0, casts: 0, dodged: 0, spawned: 0, bySkill: {} };
      this.killedBy = ''; this.lastLevel = 1;
      this.held = null; this.shieldActive = false; this.slowUntil = 0;
      this.fragments = 0; this.upgrades = Object.fromEntries(Object.keys(CARDS).map(k => [k, 0]));
      this.offers = []; this.rerolled = []; this.discarded = []; this.reserve = 0; this.hasteUntil = 0; this.edgeContact = null;
      this.nextPower = 12; this.nextFragment = 4;
      this.previousBest = null; this.recordBroken = false;
      this.stats.blocked = 0; this.stats.powersUsed = 0; this.stats.fragments = 0;
    }
    start(previousBest = null) { this.reset(); this.previousBest = Number.isFinite(previousBest) && previousBest >= 0 ? previousBest : null; this.status = 'running'; }
    pause() { if (this.status === 'running') this.status = 'paused'; }
    resume() { if (this.status === 'paused') this.status = 'running'; }
    emit(type, data = {}) { this.events.push({ type, time: this.time, ...data }); }
    drainEvents() { return this.events.splice(0); }
    usePower() {
      if (this.status !== 'running' || !this.held) return false;
      const kind = this.held;
      if ((kind === 'shield' && this.shieldActive) || (kind === 'slow' && this.slowUntil > this.time)) return false;
      const duration = 3 + this.upgrades.duration * 0.5;
      if (kind === 'shield') this.shieldActive = true;
      else if (kind === 'slow') { this.slowUntil = this.time + duration; if (this.upgrades.slowHeal) this.heal(60); }
      else return false;
      this.held = null; this.stats.powersUsed++; this.emit('powerUsed', { kind, duration: kind === 'shield' ? null : duration }); return true;
    }
    attributes() {
      return { maxHp: this.player.maxHp, speedBonus: this.upgrades.speed * 4,
        hasteBonus: this.hasteUntil > this.time ? 15 : 0,
        pickupRadius: 34 * (1 + this.upgrades.reach * .25), pickupBonus: this.upgrades.reach * 25,
        powerDuration: 3 + this.upgrades.duration * .5, shieldHaste: !!this.upgrades.shieldHaste,
        slowHeal: this.upgrades.slowHeal ? 60 : 0 };
    }
    heal(amount) {
      const actual = Math.min(amount, this.player.maxHp - this.player.hp);
      this.player.hp += actual; this.stats.healing += actual;
      if (actual > 0) this.emit('heal', { amount: actual, x: this.player.x, y: this.player.y });
      return actual;
    }
    canUpgrade(kind) {
      return kind === 'reserve' ? Object.keys(CARDS).every(k => !this.canUpgrade(k))
        : !!CARDS[kind] && this.upgrades[kind] < CARDS[kind].cap;
    }
    drawCard(exclude = []) {
      const pool = Object.keys(CARDS).filter(k => this.canUpgrade(k) && !exclude.includes(k));
      return pool.length ? pool[Math.floor(this.rng() * pool.length)] : null;
    }
    beginUpgrade() {
      this.status = 'upgrading'; this.player.vx = 0; this.player.vy = 0;
      this.offers = []; this.rerolled = [false,false,false]; this.discarded = [];
      for (let i = 0; i < 3; i++) { const card = this.drawCard(this.offers); if (card) this.offers.push(card); }
      if (!this.offers.length) this.offers = ['reserve'];
      this.emit('upgradeReady');
    }
    canReroll(slot) {
      return this.status === 'upgrading' && Number.isInteger(slot) && slot >= 0 && slot < this.offers.length &&
        !this.rerolled[slot] && Object.keys(CARDS).some(k => this.canUpgrade(k) && !this.offers.includes(k) && !this.discarded.includes(k));
    }
    reroll(slot) {
      if (!this.canReroll(slot)) return false;
      const next = this.drawCard([...this.offers, ...this.discarded]);
      this.discarded.push(this.offers[slot]); this.offers[slot] = next; this.rerolled[slot] = true;
      this.emit('rerolled', { slot }); return true;
    }
    chooseUpgrade(kind) {
      if (this.status !== 'upgrading' || !this.offers.includes(kind) || !this.canUpgrade(kind)) return false;
      if (kind === 'reserve') this.reserve++; else this.upgrades[kind]++;
      if (kind === 'health' || kind === 'reserve') { const amount = kind === 'health' ? 100 : 25; this.player.maxHp += amount; this.heal(amount); }
      this.offers = []; this.status = 'running'; this.emit('upgradeChosen', { kind }); return true;
    }
    pickupPoint() {
      let best = null, score = -Infinity;
      for (let i = 0; i < 24; i++) {
        const point = { x: 410 + this.rng() * 780, y: 250 + this.rng() * 440 };
        const dist = distance(point, this.player);
        if (dist < 280 || dist > 1100 || this.pickups.some(h => distance(h, point) < 75)) continue;
        let route = 0;
        for (const e of this.enemies) {
          if (!e.fired && segmentDistance(point.x, point.y, e.x, e.y, e.x + e.dx * 1800, e.y + e.dy * 1800) < 130) route += 110;
        }
        const value = Math.min(dist, 650) + route;
        if (value > score) { score = value; best = point; }
      }
      return best;
    }
    spawnPickup(kind) {
      if (!['heal', 'shield', 'slow', 'fragment'].includes(kind)) return false;
      if (this.pickups.some(h => (h.kind || 'heal') === kind)) return false;
      if (['shield', 'slow'].includes(kind) && this.pickups.some(h => ['shield', 'slow'].includes(h.kind))) return false;
      const point = this.pickupPoint(); if (!point) return false;
      this.pickups.push({ ...point, id: ++this.id, kind, born: this.time, expires: this.time + 8, amount: kind === 'heal' ? 180 : 1 });
      this.emit('pickupSpawn', { kind }); return true;
    }
    aim(enemy, lead = 0) {
      const p = this.player;
      const target = { x: clamp(p.x + p.vx * lead, FIELD.left + MOVE_PAD.x, FIELD.right - MOVE_PAD.x),
        y: clamp(p.y + p.vy * lead, FIELD.top + MOVE_PAD.top, FIELD.bottom - MOVE_PAD.bottom) };
      const n = Math.hypot(target.x - enemy.x, target.y - enemy.y) || 1;
      return { target, dx: (target.x - enemy.x) / n, dy: (target.y - enemy.y) / n };
    }
    // Count reservations before telegraphing as well as live, unspent attacks.
    pressure(exclude = null) {
      const hazards = [...this.enemies.filter(e => e !== exclude && !e.fired),
        ...this.attacks.filter(a => !a.dead && !a.hit && a.age <= a.life)];
      return { total: hazards.length, wide: hazards.filter(a => WIDE_SKILLS.includes(a.kind)).length,
        bind: hazards.filter(a => a.kind === 'bind').length,
        heavyBind: hazards.some(a => a.kind === 'bind' && a.root === 2) || this.player.rootUntil-this.time > .5 };
    }
    burstDelay(at) { return Math.max(.75, 1.1-at/500); }
    keyTime(e) { return e.fireAt + (e.kind === 'burst' ? e.burstDelay : 0); }
    reserveWideTime(kind, fireAt) {
      const reserved = [this.lastWideEvent,
        ...this.enemies.filter(e => !e.fired && WIDE_SKILLS.includes(e.kind)).map(e => this.keyTime(e)),
        ...this.attacks.filter(a => !a.dead && a.kind === 'burst').map(a => a.born+a.delay)];
      // Bounded scheduling before the enemy appears. No deferred backlog.
      for (let shift=0; shift <= ATTACK_RULES.maxScheduleShift+.001; shift+=.05) {
        const at=fireAt+shift, delay=kind==='burst'?this.burstDelay(at):0;
        if(reserved.every(t=>Math.abs(at+delay-t)>=ATTACK_RULES.keyGap)) return {fireAt:at,burstDelay:delay};
      }
      return null;
    }
    spawnEnemy(kind, position, options = {}) {
      const d = difficulty(this.time), pressure = this.pressure();
      if (pressure.total >= ATTACK_RULES.totalLimit) return null;
      if (kind === 'bind' && pressure.bind >= 1) kind = 'spear';
      const wideLimit = pressure.heavyBind ? 1 : ATTACK_RULES.wideLimit;
      if (WIDE_SKILLS.includes(kind) && pressure.wide >= wideLimit) kind = 'spear';
      let root = options.root ?? (this.time > 50 && this.rng() < 0.22 ? 2 : this.rng() < 0.5 ? 0.5 : 1);
      if (kind === 'bind' && root === 2 && pressure.wide >= 2) root = 1;
      const charge = options.charge ?? (kind === 'beam' ? Math.max(1.3, d.charge+.25) : d.charge);
      let fireAt = this.time+charge+(options.stagger||0)+(root===2 && kind==='bind'?.35:0);
      let burstDelay = 0;
      if (WIDE_SKILLS.includes(kind)) {
        const reservation = this.reserveWideTime(kind,fireAt);
        if (!reservation) { kind='spear'; fireAt=this.time+(options.charge??d.charge)+(options.stagger||0); }
        else { fireAt=reservation.fireAt; burstDelay=reservation.burstDelay; }
      }
      const e = { id: ++this.id, kind, ...position, born: this.time, fireAt, burstDelay,
        lockBefore: kind==='beam'?.95:kind==='burst'?.4:distance(position,this.player)<260?.65:.32,
        fired:false, locked:false, root, ...this.aim(position) };
      this.enemies.push(e); this.stats.spawned++; return e;
    }
    spawnWave() {
      const d = difficulty(this.time);
      const count = d.min + Math.floor(this.rng() * (d.max-d.min+1));
      const types = this.time<12?['spear','spear','beam','bind']:['spear','beam','wave','bind','burst'];
      const offset = Math.floor(this.rng()*4); let spawned=0;
      for(let i=0;i<count && this.enemies.length<30;i++){
        const side=(offset+i)%4, f=.08+this.rng()*.84;
        const position=side===0?{x:75+f*1450,y:133,side}
          :side===1?{x:1540,y:160+f*630,side}
          :side===2?{x:75+f*1450,y:FIELD.bottom-20,side}:{x:60,y:160+f*630,side};
        if(this.spawnEnemy(types[Math.floor(this.rng()*types.length)],position,{stagger:i*.10}))spawned++;
      }
      this.wave++;this.emit('wave',{count:spawned});
      this.nextWave=this.time+d.interval*(.9+this.rng()*.2);
    }
    forecastAttack(e) {
      const skill=SKILLS[e.kind], burst=e.kind==='burst';
      return {kind:e.kind,x:burst?e.target.x:e.x,y:burst?e.target.y:e.y,
        dx:e.dx,dy:e.dy,speed:(skill.speed||0)*difficulty(e.fireAt).speed,
        radius:skill.radius,width:skill.width||0,length:1900,
        age:0,starts:e.fireAt-this.time,delay:e.burstDelay,
        life:burst?e.burstDelay+.4:e.kind==='beam'?.32:7};
    }
    forecastPosition(a, after) {
      const start=a.starts||0;
      if(after<start)return null;
      const projectile=['spear','bind','wave'].includes(a.kind);
      const elapsed=after-start;
      const slowed=projectile?Math.max(0,Math.min(after,this.slowUntil-this.time)-Math.max(0,start)):0;
      const travel=elapsed-slowed*.5, age=a.age+travel;
      if(age>a.life || (a.kind==='burst' && age<a.delay))return null;
      return {x:a.x+a.dx*a.speed*travel,y:a.y+a.dy*a.speed*travel};
    }
    routeHit(a, point, previous, after, before) {
      const pos=this.forecastPosition(a,after);
      if(!pos)return false;
      const padding=this.player.r+6;
      if(a.kind==='beam')return segmentDistance(point.x,point.y,pos.x,pos.y,pos.x+a.dx*a.length,pos.y+a.dy*a.length)<padding+a.radius;
      if(a.kind==='burst')return distance(point,pos)<padding+a.radius;
      const prior=this.forecastPosition(a,before)||pos;
      const rx=point.x-pos.x,ry=point.y-pos.y,ox=previous.x-prior.x,oy=previous.y-prior.y;
      if(a.kind==='wave'){
        const along=rx*a.dx+ry*a.dy,oldAlong=ox*a.dx+oy*a.dy;
        const across=-rx*a.dy+ry*a.dx,oldAcross=-ox*a.dy+oy*a.dx;
        return Math.min(along,oldAlong)<padding+a.radius && Math.max(along,oldAlong)>-padding-a.radius &&
          Math.min(across,oldAcross)<a.width/2+padding && Math.max(across,oldAcross)>-a.width/2-padding;
      }
      return segmentDistance(0,0,ox,oy,rx,ry)<padding+a.radius;
    }
    hasEscape(candidate) {
      // Local straight/stop routes, sampled over time. Not a global pathfinding guarantee.
      const proposed=this.forecastAttack(candidate), p=this.player;
      const impact=candidate.kind==='burst'?candidate.burstDelay:candidate.kind==='wave'?distance(p,candidate)/proposed.speed:.32;
      const horizon=clamp(candidate.fireAt-this.time+impact+.4,1.2,4);
      const threats=[...this.attacks.filter(a=>!a.dead&&!a.hit),
        ...this.enemies.filter(e=>!e.fired&&e.locked&&e!==candidate).map(e=>this.forecastAttack(e)),proposed];
      const reaction=Math.max(.15,p.rootUntil-this.time);
      const speed=355*(1+this.upgrades.speed*.04);
      const reach=Math.min(380,Math.max(0,horizon-reaction)*speed);
      const destinations=[{x:p.x,y:p.y}];
      for(const fraction of [.5,1])for(let i=0;i<16;i++){
        const angle=i*Math.PI/8;
        destinations.push({x:clamp(p.x+Math.cos(angle)*reach*fraction,FIELD.left+MOVE_PAD.x,FIELD.right-MOVE_PAD.x),
          y:clamp(p.y+Math.sin(angle)*reach*fraction,FIELD.top+MOVE_PAD.top,FIELD.bottom-MOVE_PAD.bottom)});
      }
      for(const target of destinations){
        const length=distance(p,target);let previous={x:p.x,y:p.y},safe=true;
        const steps=Math.ceil(horizon/.05),dt=horizon/steps;
        for(let i=1;i<=steps;i++){
          const t=i*dt, progress=length?Math.min(1,Math.max(0,t-reaction)*speed/length):0;
          const point={x:p.x+(target.x-p.x)*progress,y:p.y+(target.y-p.y)*progress};
          if(threats.some(a=>this.routeHit(a,point,previous,t,t-dt))){safe=false;break;}
          previous=point;
        }
        if(safe)return true;
      }
      return false;
    }
    fire(e) {
      e.fired = true; e.leaveAt = this.time + 0.62;
      const s = SKILLS[e.kind], d = difficulty(this.time);
      const a = { id: ++this.id, kind: e.kind, x: e.x, y: e.y, dx: e.dx, dy: e.dy,
        born: this.time, age: 0, damage: s.damage, radius: s.radius, root: e.root,
        speed: (s.speed || 0) * d.speed, width: s.width || 0, hit: false, dead: false };
      if (e.kind === 'beam') { a.life = 0.32; a.length = 1900; }
      else if (e.kind === 'burst') { a.x = e.target.x; a.y = e.target.y; a.delay = e.burstDelay ?? this.burstDelay(this.time); a.life = a.delay + 0.4; }
      else a.life = 7;
      if(WIDE_SKILLS.includes(e.kind))this.lastWideEvent=Math.max(this.lastWideEvent,this.time+(e.kind==='burst'?a.delay:0));
      this.attacks.push(a); this.stats.casts++;
      this.stats.bySkill[e.kind] = (this.stats.bySkill[e.kind] || 0) + 1;
      this.emit('cast', { kind: e.kind });
      return a;
    }
    hurt(amount, source, root = 0) {
      const p = this.player;
      if (this.status !== 'running' || this.time < p.invulnerableUntil) return false;
      if (this.shieldActive) {
        this.shieldActive = false; this.stats.blocked++;
        if (this.upgrades.shieldHaste) this.hasteUntil = this.time + 2;
        this.emit('shieldBlock', { x: p.x, y: p.y, source }); return true;
      }
      const damage = Math.min(p.hp, amount); p.hp = Math.max(0, p.hp - amount);
      p.invulnerableUntil = this.time + 0.18;
      this.stats.hits++; this.stats.damage += damage;
      if (root > 0 && this.time >= p.rootImmuneUntil) {
        const duration = clamp(root, 0, 2);
        p.rootUntil = this.time + duration;
        p.rootImmuneUntil = p.rootUntil + 1.2;
        this.emit('root', { duration });
      }
      this.emit('hit', { amount: damage, x: p.x, y: p.y, source });
      if (p.hp === 0) { this.status = 'dead'; this.killedBy = source; this.emit('death'); }
      return true;
    }
    tryHeal() {
      if (this.time < 18 || this.pickups.some(h => !h.kind || h.kind === 'heal')) return false;
      return this.spawnPickup('heal');
    }
    tick(dt, input = {}) {
      if (this.status !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
      let left = Math.min(dt, 0.25);
      while (left > 1e-8 && this.status === 'running') {
        const step = Math.min(left, 1 / 120); this.step(step, input); left -= step;
      }
    }
    step(dt, input) {
      this.time += dt;
      const p = this.player;
      let dx = Number(!!input.right) - Number(!!input.left), dy = Number(!!input.down) - Number(!!input.up);
      const n = Math.hypot(dx, dy) || 1;
      const speed = this.time < p.rootUntil ? 0 : 355 * (1 + this.upgrades.speed * 0.04 + (this.hasteUntil > this.time ? .15 : 0));
      p.vx = dx / n * speed; p.vy = dy / n * speed;
      const oldX = p.x, oldY = p.y;
      p.x = clamp(p.x + p.vx * dt, FIELD.left + MOVE_PAD.x, FIELD.right - MOVE_PAD.x);
      p.y = clamp(p.y + p.vy * dt, FIELD.top + MOVE_PAD.top, FIELD.bottom - MOVE_PAD.bottom);
      this.edgeContact = speed > 0 ? (dx < 0 && p.x <= FIELD.left + MOVE_PAD.x ? 'left' : dx > 0 && p.x >= FIELD.right - MOVE_PAD.x ? 'right' : dy < 0 && p.y <= FIELD.top + MOVE_PAD.top ? 'top' : dy > 0 && p.y >= FIELD.bottom - MOVE_PAD.bottom ? 'bottom' : null) : null;
      p.vx = (p.x - oldX) / dt; p.vy = (p.y - oldY) / dt;
      if (!this.recordBroken && (this.previousBest === null ? this.time >= 1 : Math.floor(this.time * 10) / 10 > this.previousBest)) {
        this.recordBroken = true; this.emit('record', { first: this.previousBest === null });
      }
      if (this.time >= this.nextWave) this.spawnWave();
      const level = difficulty(this.time).level;
      if (level > this.lastLevel) { this.lastLevel = level; this.emit('level', { level }); }
      for (const e of this.enemies) {
        if (e.fired) continue;
        if (!e.locked) {
          const lead = e.kind === 'beam' ? 0.18 : Math.min(0.7, distance(p, e) / (SKILLS[e.kind].speed || 700) * 0.5);
          Object.assign(e, this.aim(e, lead));
          if (this.time >= e.fireAt - e.lockBefore) {
            if ((WIDE_SKILLS.includes(e.kind) || e.kind==='bind') && !this.hasEscape(e)) {
              // No warning has appeared yet: quietly retire this cast, never queue it.
              e.fired=true;e.cancelled=true;e.leaveAt=this.time+.25;continue;
            }
            e.locked=true;
          }
        }
        if (this.time >= e.fireAt) this.fire(e);
      }
      this.enemies = this.enemies.filter(e => !e.fired || this.time < e.leaveAt);
      for (const a of this.attacks) {
        const projectile = ['spear', 'bind', 'wave'].includes(a.kind);
        const attackDt = projectile && this.time < this.slowUntil ? dt * 0.5 : dt;
        a.age += attackDt;
        const ox = a.x, oy = a.y;
        a.x += a.dx * a.speed * attackDt; a.y += a.dy * a.speed * attackDt;
        let collision = false;
        if (!a.hit) {
          if (a.kind === 'beam') collision = segmentDistance(p.x, p.y, a.x, a.y, a.x + a.dx * a.length, a.y + a.dy * a.length) < p.r + a.radius;
          else if (a.kind === 'burst') collision = a.age >= a.delay && distance(p, a) < p.r + a.radius;
          else if (a.kind === 'wave') {
            const rx = p.x - a.x, ry = p.y - a.y;
            collision = Math.abs(rx * a.dx + ry * a.dy) < p.r + a.radius && Math.abs(-rx * a.dy + ry * a.dx) < a.width / 2 + p.r;
          } else collision = segmentDistance(p.x, p.y, ox, oy, a.x, a.y) < p.r + a.radius;
        }
        if (collision) {
          this.hurt(a.damage, SKILLS[a.kind].name, a.kind === 'bind' ? a.root : 0);
          a.hit = true;
          if (a.kind === 'spear' || a.kind === 'bind') a.dead = true;
        }
        if (a.age > a.life || a.x < -230 || a.x > W + 230 || a.y < -230 || a.y > H + 230) {
          a.dead = true; if (!a.hit) this.stats.dodged++;
        }
      }
      this.attacks = this.attacks.filter(a => !a.dead);
      if (this.status !== 'running') return;
      this.pickups = this.pickups.filter(h => this.time < h.expires);
      if (this.time >= this.nextHealCheck) {
        this.tryHeal(); const [min,max] = supply(this.time).heal;
        this.nextHealCheck = this.time + min + this.rng() * (max-min);
      }
      if (this.time >= this.nextPower) {
        this.spawnPickup(this.rng() < 0.5 ? 'shield' : 'slow'); const [min,max] = supply(this.time).power; this.nextPower = this.time + min + this.rng() * (max-min);
      }
      if (this.time >= this.nextFragment) {
        this.spawnPickup('fragment'); const [min,max] = supply(this.time).fragment; this.nextFragment = this.time + min + this.rng() * (max-min);
      }
      this.pickups = this.pickups.filter(h => {
        if (this.time >= h.expires) return false;
        if (this.status !== 'running') return true;
        if (distance(p, h) < this.attributes().pickupRadius) {
          const kind = h.kind || 'heal';
          if (kind === 'heal') {
            const amount = Math.min(h.amount, p.maxHp - p.hp); p.hp += amount; this.stats.healing += amount;
            this.emit('heal', { amount, x: p.x, y: p.y });
          } else if (kind === 'fragment') {
            this.fragments++; this.stats.fragments++; this.emit('fragment', { count: this.fragments, x:p.x, y:p.y });
            if (this.fragments >= 3) { this.fragments -= 3; this.beginUpgrade(); }
          } else {
            const shieldRemoved = this.shieldActive;
            const replaced = this.held || (shieldRemoved ? 'shield' : null);
            this.shieldActive = false;
            this.held = kind; this.emit('powerCollected', { kind, replaced, shieldRemoved, x:p.x, y:p.y });
          }
          return false;
        }
        return true;
      });
    }
  }
  return { Game, W, H, FIELD, MOVE_PAD, PLAYER_SCALE, WIDE_SKILLS, ATTACK_RULES, CARDS, RESERVE, SKILLS, difficulty, supply, clamp, distance, segmentDistance, seeded };
});
