'use client'
import { useState, useRef, useEffect, useCallback } from 'react'

// ── PHASER GAME HTML BUILDER ──────────────────────────────────
function buildPhaserHTML(levelData: any, backgroundImageUrl?: string) {
  const json = JSON.stringify(levelData)
  const bgImage = backgroundImageUrl ? JSON.stringify(backgroundImageUrl) : 'null'

  return `<!DOCTYPE html>
<html>
<head>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#000; overflow:hidden; width:100vw; height:100vh; }
canvas { display:block; }
#ui { position:fixed; top:8px; left:8px; color:#fff; font:bold 12px monospace; pointer-events:none; z-index:10; text-shadow:1px 1px 3px #000; }
#hp-bar { width:130px; height:10px; background:rgba(0,0,0,0.5); border-radius:3px; margin-top:4px; border:1px solid rgba(255,255,255,0.2); }
#hp-fill { height:100%; background:#44ff88; border-radius:3px; transition:width 0.2s; }
#room-label { margin-top:3px; font-size:10px; color:rgba(255,255,255,0.5); }
#keys-label { margin-top:2px; font-size:10px; color:#ffdd44; }
#msg { position:fixed; top:45%; left:50%; transform:translate(-50%,-50%); color:#fff; font:bold 20px monospace; text-shadow:2px 2px 6px #000; text-align:center; pointer-events:none; z-index:20; opacity:0; transition:opacity 0.4s; white-space:pre-line; }
#minimap { position:fixed; bottom:10px; right:10px; border:1px solid rgba(255,255,255,0.2); border-radius:4px; background:rgba(0,0,0,0.7); z-index:10; }
#controls { position:fixed; bottom:10px; left:10px; font:10px monospace; color:rgba(255,255,255,0.35); z-index:10; line-height:1.8; }
#gen-status { position:fixed; top:8px; right:10px; font:10px monospace; color:#ffaa44; z-index:10; text-shadow:1px 1px 2px #000; }
</style>
</head>
<body>
<div id="ui">
  <div>HP: <span id="hp-val">100</span></div>
  <div id="hp-bar"><div id="hp-fill" style="width:100%"></div></div>
  <div id="room-label"></div>
  <div id="keys-label"></div>
</div>
<div id="gen-status"></div>
<div id="msg"></div>
<canvas id="minimap" width="140" height="100"></canvas>
<div id="controls">WASD / Arrows — move&nbsp;&nbsp;Z — attack&nbsp;&nbsp;R — restart</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/phaser/3.60.0/phaser.min.js"></script>
<script>
const LEVEL = ${json};
const BG_IMAGE_URL = ${bgImage};
const T = LEVEL.meta.tileSize || 32;
const IS_TOPDOWN = LEVEL.meta.perspective !== 'platformer';

function tileToWorld(tx, ty) { return { x: tx*T + T/2, y: ty*T + T/2 }; }
function hexColor(hex) { return Phaser.Display.Color.HexStringToColor(hex || '#888888').color; }

class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  preload() {
    if (BG_IMAGE_URL) {
      this.load.image('bg', BG_IMAGE_URL);
      document.getElementById('gen-status').textContent = 'Loading AI art...';
    }
  }

  create() {
    this.cameras.main.setBackgroundColor(LEVEL.palette.background || '#0a0a12');

    const worldW = LEVEL.meta.width || 2560;
    const worldH = LEVEL.meta.height || 1920;
    this.physics.world.setBounds(0, 0, worldW, worldH);

    // Background art layer
    if (BG_IMAGE_URL && this.textures.exists('bg')) {
      const bg = this.add.image(worldW/2, worldH/2, 'bg');
      bg.setDisplaySize(worldW, worldH);
      bg.setAlpha(0.55);
      document.getElementById('gen-status').textContent = '✓ AI art loaded';
      setTimeout(() => document.getElementById('gen-status').textContent = '', 3000);
    }

    // ── STATE ─────────────────────────────────────────────────
    this.playerHp = LEVEL.player.hp || 100;
    this.maxHp = LEVEL.player.hp || 100;
    this.collectedKeys = [];
    this.defeatedCount = 0;
    this.currentRoomId = null;
    this.elapsed = 0;
    this.particles = [];

    // ── GRAPHICS ─────────────────────────────────────────────
    this.gfxFloor   = this.add.graphics().setDepth(1);
    this.gfxWall    = this.add.graphics().setDepth(2);
    this.gfxItems   = this.add.graphics().setDepth(4);
    this.gfxEnemy   = this.add.graphics().setDepth(5);
    this.gfxPlayer  = this.add.graphics().setDepth(6);
    this.gfxFX      = this.add.graphics().setDepth(7);

    // ── BUILD WORLD ───────────────────────────────────────────
    this.solidBodies = [];
    this.rooms = {};
    this.items = [];
    this.enemies = [];

    LEVEL.rooms.forEach(room => {
      this.rooms[room.id] = room;
      const rx = room.x * T, ry = room.y * T;

      room.floorTiles.forEach((row, ri) => {
        row.forEach((cell, ci) => {
          const wx = rx + ci*T, wy = ry + ri*T;
          if (cell === 1) {
            // Floor tile
            this.gfxFloor.fillStyle(hexColor(LEVEL.palette.floor), 1);
            this.gfxFloor.fillRect(wx, wy, T, T);
            this.gfxFloor.fillStyle(0xffffff, 0.05);
            this.gfxFloor.fillRect(wx, wy, T, 2);
            this.gfxFloor.lineStyle(0.5, 0x000000, 0.2);
            this.gfxFloor.strokeRect(wx, wy, T, T);
            if (!IS_TOPDOWN) {
              // Platform top edge
              this.gfxWall.fillStyle(hexColor(LEVEL.palette.platform || LEVEL.palette.floor), 1);
              this.gfxWall.fillRect(wx, wy, T, 5);
              this.solidBodies.push({ x: wx, y: wy, w: T, h: T, isPlatform: true });
            }
          } else if (IS_TOPDOWN) {
            // Wall tile
            this.gfxWall.fillStyle(hexColor(LEVEL.palette.wall), 1);
            this.gfxWall.fillRect(wx, wy, T, T);
            this.gfxWall.fillStyle(0xffffff, 0.04);
            this.gfxWall.fillRect(wx+1, wy+1, T-2, 4);
            this.solidBodies.push({ x: wx, y: wy, w: T, h: T, isPlatform: false });
          }
        });
      });

      // Room label text
      this.add.text(rx + room.w*T/2, ry + 6, room.label || room.id, {
        fontSize: '9px', fontFamily: 'monospace', color: '#ffffff', alpha: 0.25
      }).setOrigin(0.5, 0).setDepth(3);

      // Items
      (room.items || []).forEach(item => {
        const wp = tileToWorld(room.x + item.x, room.y + item.y);
        this.items.push({ ...item, wx: wp.x, wy: wp.y, room: room.id, collected: false, bobOffset: Math.random() * Math.PI * 2 });
      });

      // Enemies
      (room.enemies || []).forEach(enemy => {
        const wp = tileToWorld(room.x + enemy.x, room.y + enemy.y);
        const patrol = (enemy.patrol || []).map(p => tileToWorld(room.x + p.x, room.y + p.y));
        this.enemies.push({
          ...enemy,
          wx: wp.x, wy: wp.y,
          vx: 0, vy: 0,
          hp: enemy.hp || 60,
          maxHp: enemy.hp || 60,
          patrol,
          patrolIdx: 0,
          room: room.id,
          alive: true,
          iframes: 0,
          attackCD: 0,
          bobT: Math.random() * 6.28,
          aggro: enemy.type === 'boss' ? 220 : 130,
        });
      });
    });

    // ── PLAYER ───────────────────────────────────────────────
    const sr = LEVEL.rooms.find(r => r.id === LEVEL.player.spawnRoom) || LEVEL.rooms[0];
    const sp = tileToWorld(sr.x + (LEVEL.player.spawnX || 2), sr.y + (LEVEL.player.spawnY || 2));
    this.player = {
      x: sp.x, y: sp.y,
      vx: 0, vy: 0,
      w: LEVEL.player.size || 14,
      h: LEVEL.player.size || 14,
      speed: LEVEL.player.speed || 180,
      color: hexColor(LEVEL.player.color || '#00d4ff'),
      onGround: false,
      iframes: 0,
      dir: 1,
      facing: 'down',
      animT: 0,
      alive: true,
    };

    // ── CAMERA ───────────────────────────────────────────────
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setZoom(1.6);

    // ── INPUT ─────────────────────────────────────────────────
    this.keys = this.input.keyboard.addKeys({
      w: 'W', a: 'A', s: 'S', d: 'D',
      up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT',
      space: 'SPACE', z: 'Z', r: 'R',
    });
    this.attackCD = 0;

    // Minimap
    this.mmCtx = document.getElementById('minimap').getContext('2d');
  }

  update(time, delta) {
    const dt = Math.min(delta / 1000, 0.05);
    this.elapsed += dt;
    if (!this.player.alive) return;

    const P = this.player;
    const K = this.keys;

    // ── INPUT ────────────────────────────────────────────────
    const left  = K.a.isDown || K.left.isDown;
    const right = K.d.isDown || K.right.isDown;
    const up    = K.w.isDown || K.up.isDown;
    const down  = K.s.isDown || K.down.isDown;
    const atk   = K.z.isDown || K.space.isDown;

    if (K.r.isDown) { this.scene.restart(); return; }

    if (IS_TOPDOWN) {
      P.vx = ((right ? 1 : 0) - (left ? 1 : 0)) * P.speed;
      P.vy = ((down  ? 1 : 0) - (up   ? 1 : 0)) * P.speed;
      const len = Math.sqrt(P.vx*P.vx + P.vy*P.vy);
      if (len > 0) { P.vx = P.vx/len * P.speed; P.vy = P.vy/len * P.speed; }
      if (right) P.facing='right'; if (left) P.facing='left';
      if (down)  P.facing='down';  if (up)   P.facing='up';
    } else {
      P.vx = ((right ? 1 : 0) - (left ? 1 : 0)) * P.speed;
      if (up && P.onGround) { P.vy = -440; P.onGround = false; }
      P.vy = Math.min(P.vy + 900*dt, 700);
      if (right) P.dir=1; if (left) P.dir=-1;
    }
    if (Math.abs(P.vx) > 10 || Math.abs(P.vy) > 10) P.animT += dt*8;

    // ── ATTACK ───────────────────────────────────────────────
    this.attackCD = Math.max(0, this.attackCD - dt);
    if (atk && this.attackCD <= 0) { this.doAttack(); this.attackCD = 0.32; }

    // ── MOVE + COLLIDE ────────────────────────────────────────
    P.iframes = Math.max(0, P.iframes - dt);
    P.x += P.vx * dt; this.resolveX(P);
    P.y += P.vy * dt;
    if (!IS_TOPDOWN) P.onGround = false;
    this.resolveY(P);

    // ── ITEMS ─────────────────────────────────────────────────
    this.items.forEach(item => {
      if (item.collected) return;
      const d = Math.hypot(P.x - item.wx, P.y - item.wy);
      if (d < 22) {
        item.collected = true;
        if (item.type === 'health') this.playerHp = Math.min(this.maxHp, this.playerHp + 35);
        if (item.type === 'key') this.collectedKeys.push(item.label || 'Key');
        this.burst(item.wx, item.wy, item.color || '#ffdd44', 10);
        this.showMsg(item.type === 'key' ? '🗝  Key obtained!' : item.type === 'health' ? '+35 HP!' : item.label || 'Item!', 1800);
      }
    });

    // ── ENEMIES ──────────────────────────────────────────────
    this.enemies.forEach(e => {
      if (!e.alive) return;
      e.iframes = Math.max(0, e.iframes - dt);
      e.attackCD = Math.max(0, e.attackCD - dt);
      e.bobT += dt * 2;
      const dx = P.x - e.wx, dy = P.y - e.wy, dist = Math.hypot(dx, dy);

      if (dist < e.aggro) {
        const spd = e.speed || 60;
        if (dist > 3) { e.vx = dx/dist*spd; e.vy = dy/dist*spd; }
        if (dist < (e.size||16) + P.w && P.iframes <= 0 && e.attackCD <= 0) {
          const dmg = e.type === 'boss' ? 22 : 12;
          this.playerHp -= dmg;
          P.iframes = 0.7;
          e.attackCD = 1.1;
          this.cameras.main.shake(180, 0.006);
          if (this.playerHp <= 0) {
            this.playerHp = 0;
            P.alive = false;
            this.showMsg('You Died\n\nPress R to restart', 99999);
          }
        }
      } else if (e.patrol.length > 0) {
        const pt = e.patrol[e.patrolIdx % e.patrol.length];
        const pd = Math.hypot(pt.x - e.wx, pt.y - e.wy);
        if (pd < 5) { e.patrolIdx++; e.vx=0; e.vy=0; }
        else { const spd=e.speed*0.55||33; e.vx=(pt.x-e.wx)/pd*spd; e.vy=(pt.y-e.wy)/pd*spd; }
      } else { e.vx*=0.8; e.vy*=0.8; }

      e.wx += e.vx * dt;
      e.wy += e.vy * dt;
    });

    // ── CAMERA FOLLOW ─────────────────────────────────────────
    this.cameras.main.scrollX = P.x - this.cameras.main.width  / (2 * this.cameras.main.zoom);
    this.cameras.main.scrollY = P.y - this.cameras.main.height / (2 * this.cameras.main.zoom);

    // ── CURRENT ROOM ──────────────────────────────────────────
    LEVEL.rooms.forEach(room => {
      if (P.x > room.x*T && P.x < (room.x+room.w)*T && P.y > room.y*T && P.y < (room.y+room.h)*T) {
        if (this.currentRoomId !== room.id) {
          this.currentRoomId = room.id;
          document.getElementById('room-label').textContent = room.label || room.id;
        }
      }
    });

    this.render(dt);
    this.updateUI();
    this.drawMinimap();
  }

  resolveX(e) {
    const hw=e.w/2, hh=e.h/2;
    this.solidBodies.forEach(b => {
      if (b.isPlatform) return;
      if (e.x+hw>b.x && e.x-hw<b.x+b.w && e.y+hh>b.y && e.y-hh<b.y+b.h) {
        e.x = e.vx>0 ? b.x-hw : b.x+b.w+hw;
        e.vx = 0;
      }
    });
  }

  resolveY(e) {
    const hw=e.w/2, hh=e.h/2;
    this.solidBodies.forEach(b => {
      if (b.isPlatform) {
        if (e.vy>=0 && e.y-e.vy*(1/60)+hh<=b.y+4 && e.y+hh>=b.y && e.x+hw>b.x && e.x-hw<b.x+b.w) {
          e.y=b.y-hh; e.vy=0; e.onGround=true;
        }
      } else {
        if (e.x+hw>b.x && e.x-hw<b.x+b.w && e.y+hh>b.y && e.y-hh<b.y+b.h) {
          if (e.vy>0) { e.y=b.y-hh; e.vy=0; e.onGround=true; }
          else        { e.y=b.y+b.h+hh; e.vy=0; }
        }
      }
    });
  }

  doAttack() {
    const P=this.player;
    const dirs={right:[1,0],left:[-1,0],up:[0,-1],down:[0,1]};
    const d=dirs[P.facing]||[P.dir,0];
    const ax=P.x+d[0]*38, ay=P.y+d[1]*38;
    this.particles.push({x:ax,y:ay,r:16,life:1,decay:4,color:0xffffff,type:'slash'});
    this.enemies.forEach(e => {
      if (!e.alive||e.iframes>0) return;
      if (Math.hypot(e.wx-ax,e.wy-ay)<32) {
        e.hp-=28; e.iframes=0.28;
        e.vx+=d[0]*150; e.vy+=d[1]*150;
        this.burst(e.wx,e.wy,'#ffffff',5);
        if (e.hp<=0) {
          e.alive=false; this.defeatedCount++;
          this.burst(e.wx,e.wy,e.color||'#ff4466',18);
        }
      }
    });
  }

  burst(x, y, colorHex, count) {
    const c=Phaser.Display.Color.HexStringToColor(colorHex||'#ff9900').color;
    for (let i=0;i<count;i++) {
      const a=Math.random()*Math.PI*2, v=50+Math.random()*100;
      this.particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-20,r:2+Math.random()*4,life:1,decay:2+Math.random()*2,color:c,type:'dot'});
    }
  }

  render(dt) {
    this.gfxItems.clear();
    this.gfxEnemy.clear();
    this.gfxPlayer.clear();
    this.gfxFX.clear();
    const t=this.elapsed;
    const P=this.player;

    // Items
    this.items.forEach(item => {
      if (item.collected) return;
      const bob=Math.sin(t*3+item.bobOffset)*3;
      const c=Phaser.Display.Color.HexStringToColor(item.color||'#ffdd44').color;
      this.gfxItems.fillStyle(c,0.9);
      if (item.type==='key') {
        this.gfxItems.fillCircle(item.wx,item.wy+bob-3,6);
        this.gfxItems.fillRect(item.wx-1,item.wy+bob,10,3);
        this.gfxItems.fillRect(item.wx+6,item.wy+bob+1,3,3);
      } else if (item.type==='health') {
        this.gfxItems.fillStyle(0xff4466,0.9);
        this.gfxItems.fillCircle(item.wx-3,item.wy+bob-2,5);
        this.gfxItems.fillCircle(item.wx+3,item.wy+bob-2,5);
        this.gfxItems.fillTriangle(item.wx-7,item.wy+bob,item.wx+7,item.wy+bob,item.wx,item.wy+bob+8);
      } else {
        this.gfxItems.fillRect(item.wx-7,item.wy+bob-5,14,14);
      }
      this.gfxItems.fillStyle(c,0.12);
      this.gfxItems.fillCircle(item.wx,item.wy+bob,16);
    });

    // Enemies
    this.enemies.forEach(e => {
      if (!e.alive) return;
      const flash=e.iframes>0&&Math.sin(e.iframes*40)>0;
      const c=flash?0xffffff:Phaser.Display.Color.HexStringToColor(e.color||'#ff4466').color;
      const s=e.size||16, bob=Math.sin(e.bobT)*2;
      this.gfxEnemy.fillStyle(c,1);
      this.gfxEnemy.fillRect(e.wx-s/2,e.wy+bob-s/2,s,s);
      if (e.type!=='boss') {
        for (let i=0;i<3;i++) {
          this.gfxEnemy.fillTriangle(e.wx-s/2+i*s/3,e.wy+bob-s/2,e.wx-s/2+i*s/3+s/6,e.wy+bob-s/2-9,e.wx-s/2+(i+1)*s/3,e.wy+bob-s/2);
        }
      } else {
        this.gfxEnemy.lineStyle(2,0xff4466,0.4+Math.sin(t*4)*0.4);
        this.gfxEnemy.strokeRect(e.wx-s/2-5,e.wy-s/2-5,s+10,s+10);
      }
      this.gfxEnemy.fillStyle(0xffffff,1);
      this.gfxEnemy.fillRect(e.wx-s/2+3,e.wy+bob-s/2+4,5,5);
      this.gfxEnemy.fillRect(e.wx+2,e.wy+bob-s/2+4,5,5);
      this.gfxEnemy.fillStyle(0xcc0000,1);
      this.gfxEnemy.fillRect(e.wx-s/2+5,e.wy+bob-s/2+6,2,2);
      this.gfxEnemy.fillRect(e.wx+4,e.wy+bob-s/2+6,2,2);
      // HP bar
      const pct=e.hp/e.maxHp;
      this.gfxEnemy.fillStyle(0x222222,0.8);
      this.gfxEnemy.fillRect(e.wx-s/2,e.wy+bob-s/2-9,s,4);
      this.gfxEnemy.fillStyle(pct>0.5?0x44ff88:pct>0.25?0xffaa00:0xff4444,1);
      this.gfxEnemy.fillRect(e.wx-s/2,e.wy+bob-s/2-9,s*pct,4);
    });

    // Player
    const flash=P.iframes>0&&Math.sin(P.iframes*40)>0;
    const pc=flash?0xffffff:P.color;
    const w=P.w, h=P.h;
    const legSwing=P.onGround||IS_TOPDOWN?Math.sin(P.animT)*5:0;
    this.gfxPlayer.fillStyle(0x000000,0.2);
    this.gfxPlayer.fillEllipse(P.x,P.y+h/2+3,w,6);
    this.gfxPlayer.fillStyle(Phaser.Display.Color.HexStringToColor(LEVEL.player.color||'#0066aa').color,1);
    this.gfxPlayer.fillRect(P.x-w/2+2,P.y+h/2,w/2-2,7+legSwing);
    this.gfxPlayer.fillRect(P.x+1,P.y+h/2,w/2-2,7-legSwing);
    this.gfxPlayer.fillStyle(pc,1);
    this.gfxPlayer.fillRect(P.x-w/2,P.y-h/2,w,h);
    this.gfxPlayer.fillRect(P.x-w/2+2,P.y-h/2-11,w-4,13);
    const ex=P.dir>0||P.facing==='right'?P.x+2:P.x-w/2+1;
    this.gfxPlayer.fillStyle(0xffffff,1);
    this.gfxPlayer.fillRect(ex,P.y-h/2-8,5,5);
    this.gfxPlayer.fillStyle(0x000000,1);
    this.gfxPlayer.fillRect(ex+1,P.y-h/2-7,2,2);
    if (this.attackCD>0.18) {
      const dirs={right:[1,0],left:[-1,0],up:[0,-1],down:[0,1]};
      const d=dirs[P.facing]||[P.dir,0];
      this.gfxPlayer.lineStyle(3,0xffffff,this.attackCD/0.32);
      this.gfxPlayer.beginPath();
      this.gfxPlayer.arc(P.x,P.y,32,Math.atan2(d[1],d[0])-0.65,Math.atan2(d[1],d[0])+0.65);
      this.gfxPlayer.strokePath();
    }

    // Particles
    this.particles=this.particles.filter(p=>p.life>0.01);
    this.particles.forEach(p=>{
      p.life-=(p.decay||2)*dt;
      if(p.vx!==undefined){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=90*dt;p.vx*=0.95;}
      this.gfxFX.fillStyle(p.color,Math.max(0,p.life));
      if(p.type==='slash'){this.gfxFX.fillRect(p.x-p.r,p.y-2,p.r*2,4);this.gfxFX.fillRect(p.x-2,p.y-p.r,4,p.r*2);}
      else this.gfxFX.fillCircle(p.x,p.y,Math.max(0.5,p.r*p.life));
    });
  }

  updateUI() {
    document.getElementById('hp-val').textContent=String(Math.max(0,Math.round(this.playerHp)));
    const pct=Math.max(0,this.playerHp/this.maxHp);
    document.getElementById('hp-fill').style.width=(pct*100)+'%';
    document.getElementById('hp-fill').style.background=pct>0.5?'#44ff88':pct>0.25?'#ffaa00':'#ff4444';
    if(this.collectedKeys.length>0) document.getElementById('keys-label').textContent='🗝 '+this.collectedKeys.join(', ');
  }

  drawMinimap() {
    const ctx=this.mmCtx, cw=140, ch=100;
    const wW=LEVEL.meta.width||2560, wH=LEVEL.meta.height||1920;
    const sx=cw/wW, sy=ch/wH;
    ctx.clearRect(0,0,cw,ch);
    LEVEL.rooms.forEach(room=>{
      const rx=room.x*T*sx, ry=room.y*T*sy, rw=room.w*T*sx, rh=room.h*T*sy;
      ctx.fillStyle=room.id===this.currentRoomId?'#3a5a3a':'#2a2a3a';
      ctx.fillRect(rx,ry,rw,rh);
      ctx.strokeStyle='#444';ctx.lineWidth=0.5;ctx.strokeRect(rx,ry,rw,rh);
      this.enemies.filter(e=>e.room===room.id&&e.alive).forEach(e=>{
        ctx.fillStyle='#ff4466';ctx.fillRect(e.wx*sx-1.5,e.wy*sy-1.5,3,3);
      });
    });
    const P=this.player;
    ctx.fillStyle='#00d4ff';
    ctx.beginPath();ctx.arc(P.x*sx,P.y*sy,3,0,Math.PI*2);ctx.fill();
  }

  showMsg(text, duration) {
    const el=document.getElementById('msg');
    el.textContent=text; el.style.opacity='1';
    if(this._msgTimer) clearTimeout(this._msgTimer);
    if(duration<99000) this._msgTimer=setTimeout(()=>el.style.opacity='0',duration);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: LEVEL.palette.background || '#0a0a12',
  scene: GameScene,
  parent: document.body,
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
});
</script>
</body>
</html>`
}

// ── STEP CONFIG ───────────────────────────────────────────────
const STEPS = [
  { id: 'perspective', question: 'What kind of game — top-down (like Zelda) or platformer (like Mario)?',         hint: 'e.g. "top-down dungeon crawler" or "side-scrolling platformer in a cave"' },
  { id: 'setting',     question: 'Describe the setting and atmosphere.',                                           hint: 'e.g. "dark gothic dungeon with lava and torches" or "snowy mountain ruins at night"' },
  { id: 'layout',      question: 'Describe the level layout — rooms, areas, what the player needs to do.',        hint: 'e.g. "start room, two guard rooms, find a key, unlock a boss chamber at the end"' },
  { id: 'enemies',     question: 'What enemies does the player face? Types, behaviors, any boss?',                hint: 'e.g. "fast skeleton patrol guards, a slow armored knight, and a giant spider boss"' },
]

const COLORS = ['#6366f1', '#10b981', '#0ea5e9', '#ef4444']

export default function Builder() {
  const [phase,      setPhase]      = useState<'splash'|'questions'|'building'|'done'>('splash')
  const [stepIdx,    setStepIdx]    = useState(0)
  const [messages,   setMessages]   = useState<Array<{role:string;content:string;type?:string}>>([])
  const [input,      setInput]      = useState('')
  const [loading,    setLoading]    = useState(false)
  const [status,     setStatus]     = useState('')
  const [levelData,  setLevelData]  = useState<any>(null)
  const [mapImageUrl,setMapImageUrl]= useState<string|null>(null)
  const [gameHTML,   setGameHTML]   = useState<string|null>(null)
  const [answers,    setAnswers]    = useState<Record<string,string>>({})
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)
  const answersRef = useRef<Record<string,string>>({})
  answersRef.current = answers

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const addMsg = (role: string, content: string, type?: string) =>
    setMessages(m => [...m, { role, content, type }])

  const start = () => {
    setPhase('questions')
    addMsg('assistant', STEPS[0].question, 'question')
    addMsg('assistant', STEPS[0].hint, 'hint')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  const generate = useCallback(async (allAnswers: Record<string,string>) => {
    setPhase('building')
    setLoading(true)

    // ── STEP 1: Claude designs the level ─────────────────────
    setStatus('Claude is designing your level...')
    addMsg('assistant', 'Designing your level — placing rooms, enemies, items, and connections...', 'building')

    const levelPrompt = `Design a complete playable level:
Game type: ${allAnswers.perspective}
Setting: ${allAnswers.setting}
Layout: ${allAnswers.layout}
Enemies: ${allAnswers.enemies}

Make it genuinely interesting with varied room shapes, tactical enemy placement, and clear start-to-boss progression.`

    let level: any = null
    try {
      const res = await fetch('/api/generate-level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: levelPrompt }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      level = data.levelData
      setLevelData(level)
    } catch (e: any) {
      addMsg('assistant', '⚠️ Level design failed: ' + e.message, 'error')
      setLoading(false)
      return
    }

    // ── STEP 2: fal.ai generates the art ─────────────────────
    setStatus('fal.ai is generating map art...')
    addMsg('assistant', 'Generating map art with fal.ai — this takes 15-30 seconds...', 'building')

    let imageUrl: string | null = null
    try {
      const res = await fetch('/api/generate-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: level.meta.theme || allAnswers.setting,
          perspective: level.meta.perspective,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      imageUrl = data.imageUrl
      setMapImageUrl(imageUrl)
    } catch (e: any) {
      // Art generation failed — continue without it
      addMsg('assistant', '⚠️ Art generation failed (' + (e as Error).message + ') — running with placeholder art.', 'hint')
    }

    // ── STEP 3: Build + launch Phaser game ───────────────────
    setStatus('Launching Phaser game...')
    const html = buildPhaserHTML(level, imageUrl || undefined)
    setGameHTML(html)
    setPhase('done')
    setLoading(false)
    setStatus('')

    const roomCount   = level.rooms?.length || 0
    const enemyCount  = level.rooms?.reduce((a: number, r: any) => a + (r.enemies?.length || 0), 0) || 0
    const itemCount   = level.rooms?.reduce((a: number, r: any) => a + (r.items?.length || 0), 0) || 0

    addMsg('assistant',
      `🎮 Your game is ready!\n\n${roomCount} rooms · ${enemyCount} enemies · ${itemCount} items\n` +
      (imageUrl ? '✓ AI art applied as background layer\n' : '') +
      `\nClick the game to focus it, then:\nWASD/Arrows = move · Z = attack · R = restart`,
      'confirm'
    )
  }, [])

  const send = async () => {
    if (!input.trim() || loading) return
    const answer = input.trim()
    setInput('')
    addMsg('user', answer)

    const step = STEPS[stepIdx]
    const newAnswers = { ...answersRef.current, [step.id]: answer }
    setAnswers(newAnswers)

    const nextIdx = stepIdx + 1
    if (nextIdx >= STEPS.length) {
      await generate(newAnswers)
    } else {
      setStepIdx(nextIdx)
      addMsg('assistant', STEPS[nextIdx].question, 'question')
      addMsg('assistant', STEPS[nextIdx].hint, 'hint')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const reset = () => {
    setPhase('splash'); setStepIdx(0); setMessages([]); setInput('')
    setLevelData(null); setMapImageUrl(null); setGameHTML(null); setAnswers({})
  }

  const progress = Math.min(1, stepIdx / STEPS.length)

  return (
    <div style={S.app}>
      {/* TOPBAR */}
      <div style={S.bar}>
        <span style={S.logo}>⚙ GAMEFORGE</span>
        <span style={S.pill}>Phaser.js + Claude + fal.ai</span>
        <div style={S.track}><div style={{ ...S.fill, width: `${progress * 100}%` }} /></div>
        <span style={{ fontSize: 10, fontFamily: 'monospace', color: status.startsWith('✓') ? '#44ff88' : '#aaa', minWidth: 200 }}>{status}</span>
        {phase === 'done' && <button style={S.regenBtn} onClick={reset}>↺ New Level</button>}
      </div>

      <div style={S.body}>
        {/* CHAT */}
        <div style={S.chat}>
          {phase !== 'splash' && (
            <div style={S.dots}>
              {STEPS.map((s, i) => {
                const done   = i < stepIdx
                const active = i === stepIdx && phase === 'questions'
                return <div key={s.id} style={S.dot(done?'done':active?'active':'idle')}>{done?'✓':i+1}</div>
              })}
            </div>
          )}

          <div style={S.feed}>
            {phase === 'splash' ? (
              <div style={S.splash}>
                <div style={S.bigTitle}>Game<br/>Forge</div>
                <p style={S.sub}>Answer 4 questions.<br/>Claude designs the level.<br/>fal.ai generates the art.<br/>Phaser runs the game.</p>
                <div style={S.featureList}>
                  <div>⚔️ Real combat + physics</div>
                  <div>🗺️ Minimap + room navigation</div>
                  <div>🎨 AI-generated background art</div>
                  <div>👾 Enemy AI + patrol routes</div>
                  <div>🗝️ Keys, locks, items</div>
                </div>
                <button style={S.cta} onClick={start}>Start Building →</button>
              </div>
            ) : messages.map((m, i) => (
              <div key={i} style={S.msgWrap(m.role)}>
                {m.role === 'assistant' && m.type !== 'hint' && <div style={S.from}>Gameforge</div>}
                <div style={{ ...S.bubble(m.role), ...(m.type==='hint'?S.hintB:{}), ...(m.type==='confirm'?S.confirmB:{}), ...(m.type==='question'?S.questionB:{}), ...(m.type==='building'?S.buildingB:{}) }}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div style={S.msgWrap('assistant')}>
                <div style={S.from}>Gameforge</div>
                <div style={S.bubble('assistant')}><span style={{opacity:0.4}}>⟳</span> {status}</div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {phase === 'questions' && (
            <div style={S.inputArea}>
              <div style={S.inputRow}>
                <textarea ref={inputRef} style={S.textarea(COLORS[stepIdx]||'#7c3aed')}
                  value={input} rows={2} disabled={loading}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();} }}
                  placeholder="Your answer..."
                />
                <button style={S.sendBtn(COLORS[stepIdx]||'#7c3aed')} onClick={send} disabled={loading}>→</button>
              </div>
            </div>
          )}
        </div>

        {/* PREVIEW */}
        <div style={S.previewCol}>
          <div style={S.pLabel}>{gameHTML ? 'Live Game — Click to focus' : 'Game Preview'}</div>
          {gameHTML ? (
            <iframe srcDoc={gameHTML} style={S.frame} sandbox="allow-scripts" title="game" allow="autoplay" />
          ) : (
            <div style={S.empty}>
              {phase === 'splash' ? (
                <div style={{ textAlign: 'center', color: '#2a2a4a' }}>
                  <div style={{ fontSize: 44, marginBottom: 16 }}>🎮</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 2.2, color: '#3a3a5a' }}>
                    Real Phaser.js game engine<br/>
                    Claude designs rooms + enemies<br/>
                    fal.ai generates the art<br/>
                    Full physics + collision<br/>
                    Combat, items, minimap
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: '#2a2a4a' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#3a3a5a', lineHeight: 1.8 }}>
                    {phase === 'building' ? status || 'Building your game...' : 'Answer the questions →'}
                  </div>
                </div>
              )}
            </div>
          )}
          {gameHTML && (
            <div style={{ fontSize: 10, color: '#bbb', fontFamily: 'monospace', marginTop: 4 }}>
              WASD/Arrows = move · Z = attack · R = restart
            </div>
          )}

          {/* Stats */}
          {levelData && (
            <div style={S.stats}>
              {[
                { label: 'Rooms',   val: levelData.rooms?.length },
                { label: 'Enemies', val: levelData.rooms?.reduce((a:number,r:any)=>a+(r.enemies?.length||0),0) },
                { label: 'Items',   val: levelData.rooms?.reduce((a:number,r:any)=>a+(r.items?.length||0),0) },
                { label: 'Type',    val: levelData.meta?.perspective },
                { label: 'Art',     val: mapImageUrl ? '✓ AI' : 'placeholder' },
              ].map(({ label, val }) => (
                <div key={label} style={S.statChip}>
                  <div style={{ fontSize: 9, color: '#888' }}>{label}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#111' }}>{val}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const S = {
  app:        { fontFamily:"'Georgia',serif", background:'#f9f9f7', height:'100vh', display:'flex', flexDirection:'column' as const, overflow:'hidden' as const },
  bar:        { background:'#fff', borderBottom:'1px solid #e8e8e8', padding:'0 16px', height:44, display:'flex', alignItems:'center', gap:12, flexShrink:0 as const },
  logo:       { fontWeight:700, fontSize:13, letterSpacing:'0.18em', textTransform:'uppercase' as const, color:'#111', flexShrink:0 as const },
  pill:       { fontSize:10, fontFamily:'monospace', color:'#999', background:'#f5f5f5', padding:'2px 8px', borderRadius:20, border:'1px solid #eee' },
  track:      { flex:1, maxWidth:140, height:2, background:'#eee', borderRadius:1 },
  fill:       { height:'100%', background:'#111', borderRadius:1, transition:'width 0.5s ease' },
  regenBtn:   { background:'#f5f5f5', border:'1px solid #ddd', color:'#555', borderRadius:4, padding:'4px 12px', cursor:'pointer', fontFamily:'inherit', fontSize:11 },
  body:       { display:'flex', flex:1, overflow:'hidden' as const },
  chat:       { width:300, flexShrink:0 as const, borderRight:'1px solid #e8e8e8', background:'#fff', display:'flex', flexDirection:'column' as const, overflow:'hidden' as const },
  dots:       { display:'flex', gap:5, padding:'10px 14px 8px', borderBottom:'1px solid #f0f0f0', flexShrink:0 as const },
  dot:        (s:string) => ({ width:26, height:26, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontFamily:'monospace', fontWeight:700, flexShrink:0 as const, background:s==='done'?'#111':s==='active'?'#f0f0f0':'transparent', color:s==='done'?'#fff':s==='active'?'#111':'#ccc', border:`1px solid ${s==='done'?'#111':s==='active'?'#bbb':'#e5e5e5'}` }),
  feed:       { flex:1, overflowY:'auto' as const, padding:'14px', display:'flex', flexDirection:'column' as const, gap:8 },
  splash:     { flex:1, display:'flex', flexDirection:'column' as const, justifyContent:'center', paddingBottom:20 },
  bigTitle:   { fontSize:44, fontWeight:700, lineHeight:0.9, letterSpacing:'-0.03em', color:'#111', marginBottom:14 },
  sub:        { fontSize:12, color:'#999', lineHeight:1.8, marginBottom:12 },
  featureList:{ fontSize:11, color:'#bbb', fontFamily:'monospace', lineHeight:2.0, marginBottom:20 },
  cta:        { background:'#111', color:'#fff', border:'none', borderRadius:4, padding:'10px 22px', fontSize:13, fontFamily:"'Georgia',serif", fontWeight:700, cursor:'pointer', alignSelf:'flex-start' as const },
  msgWrap:    (role:string) => ({ display:'flex', flexDirection:'column' as const, gap:3, alignItems:role==='user'?'flex-end' as const:'flex-start' as const }),
  from:       { fontSize:9, letterSpacing:'0.14em', textTransform:'uppercase' as const, color:'#ccc', fontFamily:'monospace' },
  bubble:     (role:string) => ({ fontSize:12, lineHeight:1.75, color:'#222', background:role==='user'?'#f5f5f5':'#fff', maxWidth:'92%', padding:'8px 11px', borderRadius:8, border:'1px solid #efefef', whiteSpace:'pre-wrap' as const, wordBreak:'break-word' as const }),
  hintB:      { background:'transparent', border:'none', color:'#bbb', fontSize:11, padding:'0 11px', fontStyle:'italic' as const },
  confirmB:   { background:'#fafff5', border:'1px solid #d4edda', borderLeft:'3px solid #10b981' },
  questionB:  { background:'#fff', border:'1px solid #e0e7ff', borderLeft:'3px solid #6366f1' },
  buildingB:  { background:'#fffbeb', border:'1px solid #fde68a', borderLeft:'3px solid #f59e0b' },
  inputArea:  { borderTop:'1px solid #f0f0f0', padding:'10px 12px', flexShrink:0 as const, background:'#fff' },
  inputRow:   { display:'flex', gap:7, alignItems:'flex-end' as const },
  textarea:   (accent:string) => ({ flex:1, background:'#fafafa', border:'1px solid #eee', borderBottom:`2px solid ${accent}`, borderRadius:'4px 4px 0 0', color:'#111', fontFamily:"'Georgia',serif", fontSize:12, padding:'7px 9px', resize:'none' as const, outline:'none' }),
  sendBtn:    (c:string) => ({ background:c, border:'none', color:'#fff', fontFamily:"'Georgia',serif", fontSize:16, borderRadius:4, padding:'8px 14px', cursor:'pointer', flexShrink:0 as const, alignSelf:'flex-end' as const }),
  previewCol: { flex:1, background:'#f5f5f3', display:'flex', flexDirection:'column' as const, padding:'12px 16px', overflow:'hidden' as const, gap:8 },
  pLabel:     { fontSize:9, letterSpacing:'0.16em', textTransform:'uppercase' as const, color:'#bbb', fontFamily:'monospace' },
  frame:      { flex:1, border:'none', borderRadius:8, background:'#000', display:'block', minHeight:0, boxShadow:'0 4px 24px rgba(0,0,0,0.2)' },
  empty:      { flex:1, border:'1px dashed #ddd', borderRadius:8, display:'flex', flexDirection:'column' as const, alignItems:'center', justifyContent:'center', minHeight:0 },
  stats:      { display:'flex', gap:8, flexWrap:'wrap' as const, flexShrink:0 as const },
  statChip:   { background:'#fff', border:'1px solid #eee', borderRadius:6, padding:'5px 10px', textAlign:'center' as const, minWidth:60 },
}
