'use client'
import { useState, useRef, useEffect, useCallback } from 'react'

// ── CONSTANTS ─────────────────────────────────────────────────
const ART_STYLES = [
  { id:'pixel',       label:'Pixel Art',       desc:'16-bit SNES style' },
  { id:'illustrated', label:'Hand-Illustrated', desc:'Ink + watercolor' },
  { id:'painterly',   label:'Painterly',        desc:'Oil painting style' },
  { id:'anime',       label:'Anime',            desc:'Japanese 2D style' },
  { id:'dark',        label:'Dark Fantasy',     desc:'Gritty, detailed' },
]

const STEPS = [
  { id:'style',       q:'Pick an art style for your game.',                    hint:null,                                                                    isStylePicker:true },
  { id:'perspective', q:'Top-down (like Zelda) or side-scrolling platformer?', hint:'e.g. "top-down dungeon crawler" or "side-scrolling cave platformer"' },
  { id:'theme',       q:'Describe the world and atmosphere.',                  hint:'e.g. "dark gothic dungeon with lava" or "enchanted forest ruins"' },
  { id:'layout',      q:'Describe the level and what the player needs to do.', hint:'e.g. "3 rooms — entrance, guard room with a key, locked boss chamber"' },
  { id:'characters',  q:'Describe the player character and enemy types.',      hint:'e.g. "armored knight hero, skeleton patrol guards, giant demon boss"' },
]

const STEP_COLORS = ['#6366f1','#10b981','#0ea5e9','#ef4444','#f59e0b']

// ── BUILD STAGE TYPES ─────────────────────────────────────────
type StageStatus = 'pending' | 'active' | 'done' | 'error'
interface BuildStages {
  claude:     { status: StageStatus; detail: string }
  background: { status: StageStatus; url?: string }
  tileset:    { status: StageStatus; url?: string }
  sprites:    { status: StageStatus; url?: string }
  phaser:     { status: StageStatus; detail: string }
}

const INITIAL_STAGES: BuildStages = {
  claude:     { status:'pending', detail:'' },
  background: { status:'pending' },
  tileset:    { status:'pending' },
  sprites:    { status:'pending' },
  phaser:     { status:'pending', detail:'' },
}

// ── PHASER HTML ───────────────────────────────────────────────
function buildPhaserHTML(levelData: any, assets: Record<string,string>) {
  const json     = JSON.stringify(levelData)
  const assetJs  = JSON.stringify(assets)
  return `<!DOCTYPE html><html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;overflow:hidden;width:100vw;height:100vh}
#ui{position:fixed;top:8px;left:8px;color:#fff;font:bold 12px monospace;z-index:10;text-shadow:1px 1px 3px #000;pointer-events:none}
#hpbar{width:130px;height:10px;background:rgba(0,0,0,.5);border-radius:3px;margin-top:4px;border:1px solid rgba(255,255,255,.2)}
#hpfill{height:100%;background:#44ff88;border-radius:3px;transition:width .2s}
#roomlabel{margin-top:3px;font-size:10px;color:rgba(255,255,255,.5)}
#keyslabel{margin-top:2px;font-size:10px;color:#ffdd44}
#msg{position:fixed;top:45%;left:50%;transform:translate(-50%,-50%);color:#fff;font:bold 20px monospace;text-shadow:2px 2px 6px #000;text-align:center;pointer-events:none;z-index:20;opacity:0;transition:opacity .4s;white-space:pre-line}
#minimap{position:fixed;bottom:10px;right:10px;border:1px solid rgba(255,255,255,.2);border-radius:4px;background:rgba(0,0,0,.7);z-index:10}
#controls{position:fixed;bottom:10px;left:10px;font:10px monospace;color:rgba(255,255,255,.35);z-index:10;line-height:1.8}
#aststatus{position:fixed;top:8px;right:10px;font:10px monospace;color:#ffaa44;z-index:10;text-shadow:1px 1px 2px #000;transition:opacity 1s}
</style></head><body>
<div id="ui">
  <div>HP: <span id="hpval">100</span></div>
  <div id="hpbar"><div id="hpfill" style="width:100%"></div></div>
  <div id="roomlabel"></div>
  <div id="keyslabel"></div>
</div>
<div id="aststatus">AI art active</div>
<div id="msg"></div>
<canvas id="minimap" width="140" height="100"></canvas>
<div id="controls">WASD / Arrows — move &nbsp; Z — attack &nbsp; R — restart</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/phaser/3.60.0/phaser.min.js"></script>
<script>
const LEVEL=JSON.parse(${JSON.stringify(json)});
const ASSETS=JSON.parse(${JSON.stringify(assetJs)});
const T=LEVEL.meta.tileSize||32;
const IS_TD=LEVEL.meta.perspective!=='platformer';
function hex(h){return Phaser.Display.Color.HexStringToColor(h||'#888888').color;}
function tw(tx,ty){return{x:tx*T+T/2,y:ty*T+T/2};}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

class Game extends Phaser.Scene{
  constructor(){super('Game');}
  preload(){
    if(ASSETS.backgroundUrl) this.load.image('bg',ASSETS.backgroundUrl);
    if(ASSETS.tilesetUrl)    this.load.image('ts',ASSETS.tilesetUrl);
    if(ASSETS.spriteSheetUrl)this.load.image('sp',ASSETS.spriteSheetUrl);
  }
  create(){
    const W=LEVEL.meta.width||2560,H=LEVEL.meta.height||1920;
    this.cameras.main.setBackgroundColor(LEVEL.palette.background||'#080810');
    this.physics.world.setBounds(0,0,W,H);

    if(ASSETS.backgroundUrl&&this.textures.exists('bg')){
      this.add.image(W/2,H/2,'bg').setDisplaySize(W,H).setAlpha(0.55).setDepth(0);
      setTimeout(()=>{document.getElementById('aststatus').style.opacity='0';},3000);
    }

    this.playerHp=LEVEL.player.hp||100;
    this.maxHp=LEVEL.player.hp||100;
    this.keys2=[];
    this.currentRoom=null;
    this.elapsed=0;
    this.particles=[];
    this.solidBodies=[];
    this.rooms={};
    this.items=[];
    this.enemies=[];

    this.gF=this.add.graphics().setDepth(1);
    this.gW=this.add.graphics().setDepth(2);
    this.gI=this.add.graphics().setDepth(4);
    this.gE=this.add.graphics().setDepth(5);
    this.gP=this.add.graphics().setDepth(6);
    this.gX=this.add.graphics().setDepth(7);

    const hasTiles=ASSETS.tilesetUrl&&this.textures.exists('ts');
    const TFRAME=256;

    LEVEL.rooms.forEach(room=>{
      this.rooms[room.id]=room;
      const rx=room.x*T,ry=room.y*T;
      room.floorTiles.forEach((row,ri)=>{
        row.forEach((cell,ci)=>{
          const wx=rx+ci*T,wy=ry+ri*T;
          if(cell===1){
            if(hasTiles){
              this.add.image(wx+T/2,wy+T/2,'ts').setCrop(0,0,TFRAME,TFRAME).setDisplaySize(T,T).setDepth(1);
            } else {
              this.gF.fillStyle(hex(LEVEL.palette.floor),1);this.gF.fillRect(wx,wy,T,T);
              this.gF.fillStyle(0xffffff,.05);this.gF.fillRect(wx,wy,T,2);
            }
            if(!IS_TD){
              this.gW.fillStyle(hex(LEVEL.palette.platform||LEVEL.palette.floor),1);
              this.gW.fillRect(wx,wy,T,4);
              this.solidBodies.push({x:wx,y:wy,w:T,h:T,p:true});
            }
          } else if(IS_TD){
            if(hasTiles){
              this.add.image(wx+T/2,wy+T/2,'ts').setCrop(TFRAME,0,TFRAME,TFRAME).setDisplaySize(T,T).setAlpha(.9).setDepth(2);
            } else {
              this.gW.fillStyle(hex(LEVEL.palette.wall),1);this.gW.fillRect(wx,wy,T,T);
              this.gW.fillStyle(0xffffff,.04);this.gW.fillRect(wx+1,wy+1,T-2,4);
            }
            this.solidBodies.push({x:wx,y:wy,w:T,h:T,p:false});
          }
        });
      });
      this.add.text(rx+room.w*T/2,ry+6,room.label||room.id,{fontSize:'9px',fontFamily:'monospace',color:'#ffffff',alpha:.2}).setOrigin(.5,0).setDepth(3);
      (room.items||[]).forEach(item=>{
        const wp=tw(room.x+item.x,room.y+item.y);
        this.items.push({...item,wx:wp.x,wy:wp.y,room:room.id,collected:false,bobOffset:Math.random()*Math.PI*2});
      });
      (room.enemies||[]).forEach(enemy=>{
        const wp=tw(room.x+enemy.x,room.y+enemy.y);
        const patrol=(enemy.patrol||[]).map(p=>tw(room.x+p.x,room.y+p.y));
        this.enemies.push({...enemy,wx:wp.x,wy:wp.y,vx:0,vy:0,hp:enemy.hp||60,maxHp:enemy.hp||60,patrol,patrolIdx:0,room:room.id,alive:true,iframes:0,attackCD:0,bobT:Math.random()*6.28,aggro:enemy.type==='boss'?220:130});
      });
    });

    const sr=LEVEL.rooms.find(r=>r.id===LEVEL.player.spawnRoom)||LEVEL.rooms[0];
    const sp=tw(sr.x+(LEVEL.player.spawnX||2),sr.y+(LEVEL.player.spawnY||2));
    this.player={x:sp.x,y:sp.y,vx:0,vy:0,w:LEVEL.player.size||14,h:LEVEL.player.size||14,speed:LEVEL.player.speed||180,color:hex(LEVEL.player.color||'#00d4ff'),onGround:false,iframes:0,dir:1,facing:'down',animT:0,alive:true};

    this.cameras.main.setBounds(0,0,LEVEL.meta.width||2560,LEVEL.meta.height||1920);
    this.cameras.main.setZoom(1.6);
    this.keys=this.input.keyboard.addKeys({w:'W',a:'A',s:'S',d:'D',up:'UP',down:'DOWN',left:'LEFT',right:'RIGHT',space:'SPACE',z:'Z',r:'R'});
    this.atkCD=0;
    this.mmCtx=document.getElementById('minimap').getContext('2d');
  }

  update(time,delta){
    const dt=Math.min(delta/1000,.05);
    this.elapsed+=dt;
    if(!this.player.alive)return;
    const P=this.player,K=this.keys;
    const L=K.a.isDown||K.left.isDown,R=K.d.isDown||K.right.isDown;
    const U=K.w.isDown||K.up.isDown,D=K.s.isDown||K.down.isDown;
    if(K.r.isDown){this.scene.restart();return;}
    if(IS_TD){
      P.vx=((R?1:0)-(L?1:0))*P.speed;P.vy=((D?1:0)-(U?1:0))*P.speed;
      const len=Math.sqrt(P.vx*P.vx+P.vy*P.vy);
      if(len>0){P.vx=P.vx/len*P.speed;P.vy=P.vy/len*P.speed;}
      if(R)P.facing='right';if(L)P.facing='left';if(D)P.facing='down';if(U)P.facing='up';
    } else {
      P.vx=((R?1:0)-(L?1:0))*P.speed;
      if(U&&P.onGround){P.vy=-440;P.onGround=false;}
      P.vy=Math.min(P.vy+900*dt,700);
      if(R)P.dir=1;if(L)P.dir=-1;
    }
    if(Math.abs(P.vx)>10||Math.abs(P.vy)>10)P.animT+=dt*8;
    this.atkCD=Math.max(0,this.atkCD-dt);
    if((K.z.isDown||K.space.isDown)&&this.atkCD<=0){this.doAtk();this.atkCD=0.32;}
    P.iframes=Math.max(0,P.iframes-dt);
    P.x+=P.vx*dt;this.resX(P);
    P.y+=P.vy*dt;if(!IS_TD)P.onGround=false;this.resY(P);

    this.items.forEach(item=>{
      if(item.collected)return;
      if(Math.hypot(P.x-item.wx,P.y-item.wy)<22){
        item.collected=true;
        if(item.type==='health')this.playerHp=Math.min(this.maxHp,this.playerHp+35);
        if(item.type==='key')this.keys2.push(item.label||'Key');
        this.burst(item.wx,item.wy,item.color||'#ffdd44',10);
        this.showMsg(item.type==='key'?'Key obtained!':item.type==='health'?'+35 HP!':item.label||'Item!',1800);
      }
    });

    this.enemies.forEach(e=>{
      if(!e.alive)return;
      e.iframes=Math.max(0,e.iframes-dt);e.attackCD=Math.max(0,e.attackCD-dt);e.bobT+=dt*2;
      const dx=P.x-e.wx,dy=P.y-e.wy,dist=Math.hypot(dx,dy);
      if(dist<e.aggro){
        const spd=e.speed||60;if(dist>3){e.vx=dx/dist*spd;e.vy=dy/dist*spd;}
        if(dist<(e.size||16)+P.w&&P.iframes<=0&&e.attackCD<=0){
          this.playerHp-=e.type==='boss'?22:12;P.iframes=0.7;e.attackCD=1.1;
          this.cameras.main.shake(180,.006);
          if(this.playerHp<=0){this.playerHp=0;P.alive=false;this.showMsg('You Died\n\nPress R to restart',99999);}
        }
      } else if(e.patrol.length>0){
        const pt=e.patrol[e.patrolIdx%e.patrol.length];
        const pd=Math.hypot(pt.x-e.wx,pt.y-e.wy);
        if(pd<5){e.patrolIdx++;e.vx=0;e.vy=0;}
        else{const spd=e.speed*.55||33;e.vx=(pt.x-e.wx)/pd*spd;e.vy=(pt.y-e.wy)/pd*spd;}
      } else{e.vx*=.8;e.vy*=.8;}
      e.wx+=e.vx*dt;e.wy+=e.vy*dt;
    });

    this.cameras.main.scrollX=P.x-this.cameras.main.width/(2*this.cameras.main.zoom);
    this.cameras.main.scrollY=P.y-this.cameras.main.height/(2*this.cameras.main.zoom);
    LEVEL.rooms.forEach(room=>{
      if(P.x>room.x*T&&P.x<(room.x+room.w)*T&&P.y>room.y*T&&P.y<(room.y+room.h)*T){
        if(this.currentRoom!==room.id){this.currentRoom=room.id;document.getElementById('roomlabel').textContent=room.label||room.id;}
      }
    });
    this.render(dt);this.updateUI();this.drawMM();
  }

  resX(e){const hw=e.w/2,hh=e.h/2;this.solidBodies.forEach(b=>{if(b.p)return;if(e.x+hw>b.x&&e.x-hw<b.x+b.w&&e.y+hh>b.y&&e.y-hh<b.y+b.h){e.x=e.vx>0?b.x-hw:b.x+b.w+hw;e.vx=0;}});}
  resY(e){const hw=e.w/2,hh=e.h/2;this.solidBodies.forEach(b=>{if(b.p){if(e.vy>=0&&e.y-e.vy*(1/60)+hh<=b.y+4&&e.y+hh>=b.y&&e.x+hw>b.x&&e.x-hw<b.x+b.w){e.y=b.y-hh;e.vy=0;e.onGround=true;}}else{if(e.x+hw>b.x&&e.x-hw<b.x+b.w&&e.y+hh>b.y&&e.y-hh<b.y+b.h){if(e.vy>0){e.y=b.y-hh;e.vy=0;e.onGround=true;}else{e.y=b.y+b.h+hh;e.vy=0;}}}});}

  doAtk(){
    const P=this.player;
    const d={right:[1,0],left:[-1,0],up:[0,-1],down:[0,1]}[P.facing]||[P.dir,0];
    const ax=P.x+d[0]*38,ay=P.y+d[1]*38;
    this.particles.push({x:ax,y:ay,r:16,life:1,decay:4,color:0xffffff,type:'slash'});
    this.enemies.forEach(e=>{
      if(!e.alive||e.iframes>0)return;
      if(Math.hypot(e.wx-ax,e.wy-ay)<32){
        e.hp-=28;e.iframes=.28;e.vx+=d[0]*150;e.vy+=d[1]*150;
        this.burst(e.wx,e.wy,'#ffffff',5);
        if(e.hp<=0){e.alive=false;this.burst(e.wx,e.wy,e.color||'#ff4466',18);}
      }
    });
  }

  burst(x,y,colorHex,count){
    const c=Phaser.Display.Color.HexStringToColor(colorHex||'#ff9900').color;
    for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,v=50+Math.random()*100;this.particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-20,r:2+Math.random()*4,life:1,decay:2+Math.random()*2,color:c,type:'dot'});}
  }

  render(dt){
    this.gI.clear();this.gE.clear();this.gP.clear();this.gX.clear();
    const t=this.elapsed,P=this.player;

    this.items.forEach(item=>{
      if(item.collected)return;
      const bob=Math.sin(t*3+item.bobOffset)*3;
      const c=Phaser.Display.Color.HexStringToColor(item.color||'#ffdd44').color;
      this.gI.fillStyle(c,.9);
      if(item.type==='key'){this.gI.fillCircle(item.wx,item.wy+bob-3,6);this.gI.fillRect(item.wx-1,item.wy+bob,10,3);this.gI.fillRect(item.wx+6,item.wy+bob+1,3,3);}
      else if(item.type==='health'){this.gI.fillStyle(0xff4466,.9);this.gI.fillCircle(item.wx-3,item.wy+bob-2,5);this.gI.fillCircle(item.wx+3,item.wy+bob-2,5);this.gI.fillTriangle(item.wx-7,item.wy+bob,item.wx+7,item.wy+bob,item.wx,item.wy+bob+8);}
      else{this.gI.fillRect(item.wx-7,item.wy+bob-5,14,14);}
      this.gI.fillStyle(c,.12);this.gI.fillCircle(item.wx,item.wy+bob,16);
    });

    this.enemies.forEach(e=>{
      if(!e.alive)return;
      const flash=e.iframes>0&&Math.sin(e.iframes*40)>0;
      const c=flash?0xffffff:Phaser.Display.Color.HexStringToColor(e.color||'#ff4466').color;
      const s=e.size||16,bob=Math.sin(e.bobT)*2;
      this.gE.fillStyle(c,1);this.gE.fillRect(e.wx-s/2,e.wy+bob-s/2,s,s);
      if(e.type!=='boss'){for(let i=0;i<3;i++){this.gE.fillTriangle(e.wx-s/2+i*s/3,e.wy+bob-s/2,e.wx-s/2+i*s/3+s/6,e.wy+bob-s/2-9,e.wx-s/2+(i+1)*s/3,e.wy+bob-s/2);}}
      else{this.gE.lineStyle(2,0xff4466,.4+Math.sin(t*4)*.4);this.gE.strokeRect(e.wx-s/2-5,e.wy-s/2-5,s+10,s+10);}
      this.gE.fillStyle(0xffffff,1);this.gE.fillRect(e.wx-s/2+3,e.wy+bob-s/2+4,5,5);this.gE.fillRect(e.wx+2,e.wy+bob-s/2+4,5,5);
      this.gE.fillStyle(0xcc0000,1);this.gE.fillRect(e.wx-s/2+5,e.wy+bob-s/2+6,2,2);this.gE.fillRect(e.wx+4,e.wy+bob-s/2+6,2,2);
      const pct=e.hp/e.maxHp;
      this.gE.fillStyle(0x222222,.8);this.gE.fillRect(e.wx-s/2,e.wy+bob-s/2-9,s,4);
      this.gE.fillStyle(pct>.5?0x44ff88:pct>.25?0xffaa00:0xff4444,1);this.gE.fillRect(e.wx-s/2,e.wy+bob-s/2-9,s*pct,4);
    });

    const flash=P.iframes>0&&Math.sin(P.iframes*40)>0;
    const pc=flash?0xffffff:P.color;
    const ls=P.onGround||IS_TD?Math.sin(P.animT)*5:0;
    this.gP.fillStyle(0x000000,.2);this.gP.fillEllipse(P.x,P.y+P.h/2+3,P.w,6);
    this.gP.fillStyle(Phaser.Display.Color.HexStringToColor(LEVEL.player.color||'#0066aa').color,1);
    this.gP.fillRect(P.x-P.w/2+2,P.y+P.h/2,P.w/2-2,7+ls);this.gP.fillRect(P.x+1,P.y+P.h/2,P.w/2-2,7-ls);
    this.gP.fillStyle(pc,1);this.gP.fillRect(P.x-P.w/2,P.y-P.h/2,P.w,P.h);this.gP.fillRect(P.x-P.w/2+2,P.y-P.h/2-11,P.w-4,13);
    const ex=P.dir>0||P.facing==='right'?P.x+2:P.x-P.w/2+1;
    this.gP.fillStyle(0xffffff,1);this.gP.fillRect(ex,P.y-P.h/2-8,5,5);
    this.gP.fillStyle(0x000000,1);this.gP.fillRect(ex+1,P.y-P.h/2-7,2,2);
    if(this.atkCD>.18){
      const d={right:[1,0],left:[-1,0],up:[0,-1],down:[0,1]}[P.facing]||[P.dir,0];
      this.gP.lineStyle(3,0xffffff,this.atkCD/.32);this.gP.beginPath();
      this.gP.arc(P.x,P.y,32,Math.atan2(d[1],d[0])-.65,Math.atan2(d[1],d[0])+.65);this.gP.strokePath();
    }

    this.particles=this.particles.filter(p=>p.life>.01);
    this.particles.forEach(p=>{
      p.life-=(p.decay||2)*dt;
      if(p.vx!==undefined){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=90*dt;p.vx*=.95;}
      this.gX.fillStyle(p.color,Math.max(0,p.life));
      if(p.type==='slash'){this.gX.fillRect(p.x-p.r,p.y-2,p.r*2,4);this.gX.fillRect(p.x-2,p.y-p.r,4,p.r*2);}
      else this.gX.fillCircle(p.x,p.y,Math.max(.5,p.r*p.life));
    });
  }

  updateUI(){
    document.getElementById('hpval').textContent=String(Math.max(0,Math.round(this.playerHp)));
    const pct=Math.max(0,this.playerHp/this.maxHp);
    document.getElementById('hpfill').style.width=(pct*100)+'%';
    document.getElementById('hpfill').style.background=pct>.5?'#44ff88':pct>.25?'#ffaa00':'#ff4444';
    if(this.keys2.length>0)document.getElementById('keyslabel').textContent='Key: '+this.keys2.join(', ');
  }

  drawMM(){
    const ctx=this.mmCtx,cw=140,ch=100;
    const wW=LEVEL.meta.width||2560,wH=LEVEL.meta.height||1920;
    const sx=cw/wW,sy=ch/wH;
    ctx.clearRect(0,0,cw,ch);
    LEVEL.rooms.forEach(room=>{
      ctx.fillStyle=room.id===this.currentRoom?'#3a5a3a':'#2a2a3a';
      ctx.fillRect(room.x*T*sx,room.y*T*sy,room.w*T*sx,room.h*T*sy);
      ctx.strokeStyle='#444';ctx.lineWidth=.5;ctx.strokeRect(room.x*T*sx,room.y*T*sy,room.w*T*sx,room.h*T*sy);
      this.enemies.filter(e=>e.room===room.id&&e.alive).forEach(e=>{ctx.fillStyle='#ff4466';ctx.fillRect(e.wx*sx-1.5,e.wy*sy-1.5,3,3);});
    });
    ctx.fillStyle='#00d4ff';ctx.beginPath();ctx.arc(this.player.x*sx,this.player.y*sy,3,0,Math.PI*2);ctx.fill();
  }

  showMsg(text,duration){
    const el=document.getElementById('msg');el.textContent=text;el.style.opacity='1';
    if(this._mt)clearTimeout(this._mt);
    if(duration<99000)this._mt=setTimeout(()=>el.style.opacity='0',duration);
  }
}

new Phaser.Game({
  type:Phaser.AUTO,width:window.innerWidth,height:window.innerHeight,
  backgroundColor:LEVEL.palette.background||'#0a0a12',
  scene:Game,parent:document.body,
  scale:{mode:Phaser.Scale.RESIZE,autoCenter:Phaser.Scale.CENTER_BOTH},
});
</script></body></html>`
}

// ── STAGE INDICATOR ───────────────────────────────────────────
function StageRow({ label, sub, status, url }: { label:string; sub:string; status:StageStatus; url?:string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:8, border:'0.5px solid var(--color-border-tertiary)', background:'var(--color-background-primary)', marginBottom:6 }}>
      <div style={{ width:9, height:9, borderRadius:'50%', flexShrink:0, background: status==='done'?'#1D9E75': status==='active'?'#7F77DD': status==='error'?'#E24B4A': 'var(--color-border-secondary)', animation: status==='active'?'spin 1s linear infinite':undefined }} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:500, color:'var(--color-text-primary)' }}>{label}</div>
        <div style={{ fontSize:10, color:'var(--color-text-tertiary)', marginTop:1 }}>{sub}</div>
      </div>
      {status==='done' && !url && <span style={{ fontSize:12, color:'#1D9E75' }}>✓</span>}
      {status==='active' && <span style={{ fontSize:10, color:'#7F77DD' }}>⟳</span>}
      {status==='done' && url && (
        <img src={url} alt={label} style={{ width:36, height:36, borderRadius:4, objectFit:'cover', border:'0.5px solid var(--color-border-tertiary)', flexShrink:0 }} />
      )}
    </div>
  )
}

// ── BUILDER ───────────────────────────────────────────────────
export default function Builder() {
  const [phase,     setPhase]     = useState<'splash'|'questions'|'building'|'done'>('splash')
  const [stepIdx,   setStepIdx]   = useState(0)
  const [messages,  setMessages]  = useState<Array<{role:string;content:string;type?:string}>>([])
  const [input,     setInput]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [stages,    setStages]    = useState<BuildStages>(INITIAL_STAGES)
  const [levelData, setLevelData] = useState<any>(null)
  const [assets,    setAssets]    = useState<Record<string,string>>({})
  const [gameHTML,  setGameHTML]  = useState<string|null>(null)
  const [answers,   setAnswers]   = useState<Record<string,string>>({})
  const [buildCount,setBuildCount]= useState(0)
  const chatEndRef  = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLTextAreaElement>(null)
  const answersRef  = useRef<Record<string,string>>({})
  answersRef.current = answers

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:'smooth' }) }, [messages, stages])

  const addMsg = (role:string, content:string, type?:string) =>
    setMessages(m => [...m, { role, content, type }])

  const setStage = (key: keyof BuildStages, update: Partial<BuildStages[typeof key]>) =>
    setStages(s => ({ ...s, [key]: { ...s[key], ...update } }))

  const start = () => {
    setPhase('questions')
    addMsg('assistant', STEPS[0].q, 'question')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  const generate = useCallback(async (allAnswers: Record<string,string>) => {
    setPhase('building')
    setLoading(true)
    setBuildCount(c => c + 1)
    setStages(INITIAL_STAGES)

    // ── Stage 1: Claude ───────────────────────────────────────
    setStage('claude', { status:'active', detail:'Designing rooms, enemies, items...' })

    const prompt =
      `Perspective: ${allAnswers.perspective}\n` +
      `Theme: ${allAnswers.theme}\n` +
      `Layout: ${allAnswers.layout}\n` +
      `Characters: ${allAnswers.characters}`

    let level: any = null
    try {
      const res  = await fetch('/api/generate-level', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      level = data.levelData
      setLevelData(level)
      const enemies = level.rooms?.reduce((a:number,r:any) => a + (r.enemies?.length||0), 0) || 0
      const items   = level.rooms?.reduce((a:number,r:any) => a + (r.items?.length||0), 0) || 0
      setStage('claude', { status:'done', detail:`${level.rooms?.length} rooms · ${enemies} enemies · ${items} items` })
    } catch(e:any) {
      setStage('claude', { status:'error', detail: e.message })
      addMsg('assistant', '⚠️ Level design failed: ' + e.message, 'error')
      setLoading(false); return
    }

    // ── Stage 2: fal.ai (streaming) ───────────────────────────
    setStage('background', { status:'active' })
    setStage('tileset',    { status:'active' })
    setStage('sprites',    { status:'active' })

    const charAnswer = allAnswers.characters || ''
    const styleLabel = ART_STYLES.find(s => s.id === allAnswers.style)?.label || allAnswers.style || 'pixel art'
    const collectedAssets: Record<string,string> = {}

    try {
      const res = await fetch('/api/generate-assets', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          theme:             allAnswers.theme,
          style:             styleLabel,
          perspective:       level.meta?.perspective || allAnswers.perspective,
          enemyTypes:        [charAnswer.split(/[,\.]/)[1]?.trim() || 'enemy'],
          playerDescription: charAnswer.split(/[,\.]/)[0]?.trim() || 'hero',
        }),
      })

      if (!res.body) throw new Error('No response body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)
            if (msg.type === 'asset') {
              collectedAssets[msg.key] = msg.url
              setAssets(prev => ({ ...prev, [msg.key]: msg.url }))
              const stageKey = msg.key === 'backgroundUrl' ? 'background' : msg.key === 'tilesetUrl' ? 'tileset' : 'sprites'
              setStage(stageKey as keyof BuildStages, { status:'done', url: msg.url } as any)
            } else if (msg.type === 'error') {
              throw new Error(msg.error)
            }
          } catch {}
        }
      }
    } catch(e:any) {
      addMsg('assistant', `⚠️ Art generation failed: ${e.message} — launching with placeholder art.`, 'hint')
      setStage('background', { status:'error' })
      setStage('tileset',    { status:'error' })
      setStage('sprites',    { status:'error' })
    }

    // ── Stage 3: Launch Phaser ────────────────────────────────
    setStage('phaser', { status:'active', detail:'Loading assets into engine...' })
    await new Promise(r => setTimeout(r, 400))

    const html = buildPhaserHTML(level, collectedAssets)
    setGameHTML(html)
    setStage('phaser', { status:'done', detail:'Game running' })
    setPhase('done')
    setLoading(false)

    const hasArt = Object.keys(collectedAssets).length === 3
    addMsg('assistant',
      `🎮 Game ready!\n\n` +
      `${level.rooms?.length} rooms · ${level.rooms?.reduce((a:number,r:any)=>a+(r.enemies?.length||0),0)} enemies\n` +
      (hasArt ? `✓ All 3 AI assets loaded\n` : `⚠ Partial or no AI art\n`) +
      `\nWASD move · Z attack · R restart`,
      'confirm'
    )
  }, [])

  const send = async () => {
    if (!input.trim() || loading) return
    const answer = input.trim()
    setInput('')
    const step = STEPS[stepIdx]
    addMsg('user', answer)
    const newAnswers = { ...answersRef.current, [step.id]: answer }
    setAnswers(newAnswers)
    const nextIdx = stepIdx + 1
    if (nextIdx >= STEPS.length) {
      await generate(newAnswers)
    } else {
      setStepIdx(nextIdx)
      const next = STEPS[nextIdx]
      addMsg('assistant', next.q, 'question')
      if (next.hint) addMsg('assistant', next.hint, 'hint')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const pickStyle = (styleId: string) => {
    const label = ART_STYLES.find(s => s.id === styleId)?.label || styleId
    addMsg('user', label)
    const newAnswers = { ...answersRef.current, style: styleId }
    setAnswers(newAnswers)
    const nextIdx = stepIdx + 1
    setStepIdx(nextIdx)
    addMsg('assistant', STEPS[nextIdx].q, 'question')
    if (STEPS[nextIdx].hint) addMsg('assistant', STEPS[nextIdx].hint!, 'hint')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const reset = () => {
    setPhase('splash'); setStepIdx(0); setMessages([]); setInput('')
    setLevelData(null); setAssets({}); setGameHTML(null)
    setAnswers({}); setStages(INITIAL_STAGES)
  }

  const isBuildPhase = phase === 'building'
  const progress     = Math.min(1, stepIdx / STEPS.length)
  const assetsReady  = Object.keys(assets).length
  const cost         = (buildCount * 0.01).toFixed(2)

  return (
    <div style={S.app}>
      {/* BAR */}
      <div style={S.bar}>
        <span style={S.logo}>⚙ GAMEFORGE</span>
        <span style={S.pill}>Claude · fal.ai · Phaser.js</span>
        <div style={S.track}><div style={{ ...S.fill, width:`${progress*100}%` }}/></div>
        {buildCount > 0 && <span style={S.costBadge}>~${cost} spent</span>}
        {phase==='done' && <button style={S.regenBtn} onClick={reset}>↺ New Level</button>}
      </div>

      <style>{`@keyframes spin{from{opacity:1}50%{opacity:0.3}to{opacity:1}}`}</style>

      <div style={S.body}>
        {/* CHAT */}
        <div style={S.chat}>
          {phase !== 'splash' && (
            <div style={S.dots}>
              {STEPS.map((s,i) => {
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
                <p style={S.sub}>Claude designs the level.<br/>fal.ai generates all the art.<br/>Phaser runs the game.</p>
                <div style={S.featureGrid}>
                  <div style={S.featureItem}>🧠 Claude — level logic</div>
                  <div style={S.featureItem}>🎨 fal.ai — all visuals</div>
                  <div style={S.featureItem}>⚙️ Phaser — game engine</div>
                  <div style={S.featureItem}>💰 ~$0.01 per build</div>
                </div>
                <button style={S.cta} onClick={start}>Start Building →</button>
              </div>
            ) : messages.map((m,i) => (
              <div key={i} style={S.msgWrap(m.role)}>
                {m.role==='assistant' && m.type!=='hint' && <div style={S.from}>Gameforge</div>}
                <div style={{ ...S.bubble(m.role), ...(m.type==='hint'?S.hintB:{}), ...(m.type==='confirm'?S.confirmB:{}), ...(m.type==='question'?S.questionB:{}), ...(m.type==='error'?S.errorB:{}) }}>
                  {m.content}
                </div>
              </div>
            ))}

            {/* Style picker */}
            {phase==='questions' && STEPS[stepIdx]?.isStylePicker && (
              <div style={{ display:'flex', flexDirection:'column', gap:6, margin:'4px 0' }}>
                {ART_STYLES.map(style => (
                  <button key={style.id} onClick={() => pickStyle(style.id)}
                    style={{ background:'var(--color-background-secondary)', border:'0.5px solid var(--color-border-tertiary)', borderRadius:8, padding:'10px 12px', cursor:'pointer', textAlign:'left', fontFamily:'inherit' }}>
                    <div style={{ fontSize:12, fontWeight:500, color:'var(--color-text-primary)' }}>{style.label}</div>
                    <div style={{ fontSize:10, color:'var(--color-text-tertiary)', marginTop:2 }}>{style.desc}</div>
                  </button>
                ))}
              </div>
            )}

            {/* Build progress */}
            {isBuildPhase && (
              <div style={{ marginTop:4 }}>
                <StageRow label="Claude — level design"  sub={stages.claude.detail}     status={stages.claude.status} />
                <StageRow label="fal.ai — background"    sub="512×512 · flux/schnell"   status={stages.background.status} url={stages.background.url} />
                <StageRow label="fal.ai — tileset"       sub="floor + wall tiles"        status={stages.tileset.status}    url={stages.tileset.url} />
                <StageRow label="fal.ai — sprites"       sub="player + enemies + boss"   status={stages.sprites.status}    url={stages.sprites.url} />
                <StageRow label="Phaser — launch"        sub={stages.phaser.detail}      status={stages.phaser.status} />
                <div style={{ fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'monospace', marginTop:6, padding:'6px 10px', background:'var(--color-background-secondary)', borderRadius:6 }}>
                  {assetsReady}/3 assets ready · ~${(0.003 * assetsReady).toFixed(3)} spent so far
                </div>
              </div>
            )}

            <div ref={chatEndRef}/>
          </div>

          {phase==='questions' && !STEPS[stepIdx]?.isStylePicker && (
            <div style={S.inputArea}>
              <div style={S.inputRow}>
                <textarea ref={inputRef}
                  style={S.textarea(STEP_COLORS[stepIdx]||'#7c3aed')}
                  value={input} rows={2} disabled={loading}
                  onChange={e=>setInput(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}}
                  placeholder="Your answer..."
                />
                <button style={S.sendBtn(STEP_COLORS[stepIdx]||'#7c3aed')} onClick={send} disabled={loading}>→</button>
              </div>
            </div>
          )}
        </div>

        {/* PREVIEW */}
        <div style={S.previewCol}>
          <div style={S.pLabel}>{gameHTML ? 'Live Game — Click to focus' : 'Game Preview'}</div>

          {gameHTML ? (
            <iframe srcDoc={gameHTML} style={S.frame} sandbox="allow-scripts" title="game" allow="autoplay"/>
          ) : (
            <div style={S.empty}>
              {phase==='splash' ? (
                <div style={{ textAlign:'center', color:'var(--color-text-tertiary)' }}>
                  <div style={{ fontSize:40, marginBottom:16 }}>🎮</div>
                  <div style={{ fontSize:11, fontFamily:'monospace', lineHeight:2.2 }}>
                    fal.ai background scene<br/>
                    fal.ai tileset (floor + walls)<br/>
                    fal.ai sprite sheet (characters)<br/>
                    Phaser loads + runs everything<br/>
                    Claude drives all the logic
                  </div>
                </div>
              ) : (
                <div style={{ textAlign:'center', color:'var(--color-text-tertiary)' }}>
                  <div style={{ fontSize:32, marginBottom:12 }}>⏳</div>
                  <div style={{ fontSize:11, fontFamily:'monospace', lineHeight:1.8 }}>
                    {isBuildPhase ? `${assetsReady}/3 assets ready` : 'Answer the questions →'}
                  </div>
                </div>
              )}
            </div>
          )}

          {gameHTML && (
            <div style={{ fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'monospace', marginTop:4 }}>
              WASD/Arrows = move · Z = attack · R = restart
            </div>
          )}

          {/* Asset thumbnails */}
          {Object.keys(assets).length > 0 && (
            <div style={{ background:'var(--color-background-primary)', border:'0.5px solid var(--color-border-tertiary)', borderRadius:8, padding:'10px 12px', flexShrink:0 }}>
              <div style={{ fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--color-text-tertiary)', marginBottom:8, fontFamily:'monospace' }}>fal.ai generated assets</div>
              <div style={{ display:'flex', gap:8 }}>
                {[
                  { key:'backgroundUrl', label:'Background' },
                  { key:'tilesetUrl',    label:'Tileset' },
                  { key:'spriteSheetUrl',label:'Sprites' },
                ].map(({ key, label }) => assets[key] ? (
                  <div key={key} style={{ textAlign:'center' }}>
                    <img src={assets[key]} alt={label} style={{ width:64, height:64, objectFit:'cover', borderRadius:4, border:'0.5px solid var(--color-border-tertiary)', display:'block' }}/>
                    <div style={{ fontSize:9, color:'var(--color-text-tertiary)', marginTop:3, fontFamily:'monospace' }}>{label}</div>
                  </div>
                ) : (
                  <div key={key} style={{ width:64, height:64, borderRadius:4, border:'0.5px solid var(--color-border-tertiary)', background:'var(--color-background-secondary)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <div style={{ fontSize:9, color:'var(--color-text-tertiary)', textAlign:'center', fontFamily:'monospace' }}>{label}<br/>⟳</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize:9, color:'var(--color-text-tertiary)', fontFamily:'monospace', marginTop:6 }}>
                flux/schnell · 512×512 · {Object.keys(assets).length}/3 complete · ~$0.009 total
              </div>
            </div>
          )}

          {/* Level stats */}
          {levelData && (
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', flexShrink:0 }}>
              {[
                { label:'Rooms',   val: levelData.rooms?.length },
                { label:'Enemies', val: levelData.rooms?.reduce((a:number,r:any)=>a+(r.enemies?.length||0),0) },
                { label:'Items',   val: levelData.rooms?.reduce((a:number,r:any)=>a+(r.items?.length||0),0) },
                { label:'Type',    val: levelData.meta?.perspective },
              ].map(({ label, val }) => (
                <div key={label} style={{ background:'var(--color-background-primary)', border:'0.5px solid var(--color-border-tertiary)', borderRadius:6, padding:'5px 10px', textAlign:'center', minWidth:56 }}>
                  <div style={{ fontSize:9, color:'var(--color-text-tertiary)' }}>{label}</div>
                  <div style={{ fontSize:11, fontWeight:500, color:'var(--color-text-primary)' }}>{val}</div>
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
  app:        { fontFamily:"'Georgia',serif", background:'var(--color-background-tertiary)', height:'100vh', display:'flex', flexDirection:'column' as const, overflow:'hidden' as const },
  bar:        { background:'var(--color-background-primary)', borderBottom:'0.5px solid var(--color-border-tertiary)', padding:'0 16px', height:44, display:'flex', alignItems:'center', gap:12, flexShrink:0 as const },
  logo:       { fontWeight:500, fontSize:13, letterSpacing:'0.18em', textTransform:'uppercase' as const, color:'var(--color-text-primary)', flexShrink:0 as const },
  pill:       { fontSize:10, fontFamily:'monospace', color:'var(--color-text-tertiary)', background:'var(--color-background-secondary)', padding:'2px 8px', borderRadius:20, border:'0.5px solid var(--color-border-tertiary)', flexShrink:0 as const },
  track:      { flex:1, maxWidth:120, height:2, background:'var(--color-border-tertiary)', borderRadius:1 },
  fill:       { height:'100%', background:'var(--color-text-primary)', borderRadius:1, transition:'width 0.5s ease' },
  costBadge:  { fontSize:10, fontFamily:'monospace', color:'var(--color-text-tertiary)', flexShrink:0 as const },
  regenBtn:   { background:'var(--color-background-secondary)', border:'0.5px solid var(--color-border-secondary)', color:'var(--color-text-secondary)', borderRadius:4, padding:'4px 12px', cursor:'pointer', fontFamily:'inherit', fontSize:11, flexShrink:0 as const },
  body:       { display:'flex', flex:1, overflow:'hidden' as const },
  chat:       { width:300, flexShrink:0 as const, borderRight:'0.5px solid var(--color-border-tertiary)', background:'var(--color-background-primary)', display:'flex', flexDirection:'column' as const, overflow:'hidden' as const },
  dots:       { display:'flex', gap:5, padding:'10px 14px 8px', borderBottom:'0.5px solid var(--color-border-tertiary)', flexShrink:0 as const },
  dot:        (s:string) => ({ width:24, height:24, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontFamily:'monospace', fontWeight:500, flexShrink:0 as const, background:s==='done'?'var(--color-text-primary)':s==='active'?'var(--color-background-secondary)':'transparent', color:s==='done'?'var(--color-background-primary)':s==='active'?'var(--color-text-primary)':'var(--color-border-secondary)', border:`0.5px solid ${s==='done'?'var(--color-text-primary)':s==='active'?'var(--color-border-secondary)':'var(--color-border-tertiary)'}` }),
  feed:       { flex:1, overflowY:'auto' as const, padding:'14px', display:'flex', flexDirection:'column' as const, gap:8 },
  splash:     { flex:1, display:'flex', flexDirection:'column' as const, justifyContent:'center', paddingBottom:20 },
  bigTitle:   { fontSize:42, fontWeight:500, lineHeight:0.9, letterSpacing:'-0.03em', color:'var(--color-text-primary)', marginBottom:14 },
  sub:        { fontSize:12, color:'var(--color-text-secondary)', lineHeight:1.8, marginBottom:12 },
  featureGrid:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:20 },
  featureItem:{ fontSize:11, color:'var(--color-text-tertiary)', fontFamily:'monospace' },
  cta:        { background:'var(--color-text-primary)', color:'var(--color-background-primary)', border:'none', borderRadius:4, padding:'10px 22px', fontSize:13, fontFamily:"'Georgia',serif", fontWeight:500, cursor:'pointer', alignSelf:'flex-start' as const },
  msgWrap:    (role:string) => ({ display:'flex', flexDirection:'column' as const, gap:3, alignItems:role==='user'?'flex-end' as const:'flex-start' as const }),
  from:       { fontSize:9, letterSpacing:'0.14em', textTransform:'uppercase' as const, color:'var(--color-text-tertiary)', fontFamily:'monospace' },
  bubble:     (role:string) => ({ fontSize:12, lineHeight:1.75, color:'var(--color-text-primary)', background:role==='user'?'var(--color-background-secondary)':'var(--color-background-primary)', maxWidth:'92%', padding:'8px 11px', borderRadius:8, border:'0.5px solid var(--color-border-tertiary)', whiteSpace:'pre-wrap' as const, wordBreak:'break-word' as const }),
  hintB:      { background:'transparent', border:'none', color:'var(--color-text-tertiary)', fontSize:11, padding:'0 11px', fontStyle:'italic' as const },
  confirmB:   { borderLeft:'2px solid #1D9E75', background:'var(--color-background-success)' },
  questionB:  { borderLeft:'2px solid #7F77DD' },
  errorB:     { borderLeft:'2px solid #E24B4A', background:'var(--color-background-danger)' },
  inputArea:  { borderTop:'0.5px solid var(--color-border-tertiary)', padding:'10px 12px', flexShrink:0 as const, background:'var(--color-background-primary)' },
  inputRow:   { display:'flex', gap:7, alignItems:'flex-end' as const },
  textarea:   (accent:string) => ({ flex:1, background:'var(--color-background-secondary)', border:'0.5px solid var(--color-border-tertiary)', borderBottom:`2px solid ${accent}`, borderRadius:'4px 4px 0 0', color:'var(--color-text-primary)', fontFamily:"'Georgia',serif", fontSize:12, padding:'7px 9px', resize:'none' as const, outline:'none' }),
  sendBtn:    (c:string) => ({ background:c, border:'none', color:'#fff', fontFamily:"'Georgia',serif", fontSize:16, borderRadius:4, padding:'8px 14px', cursor:'pointer', flexShrink:0 as const, alignSelf:'flex-end' as const }),
  previewCol: { flex:1, background:'var(--color-background-secondary)', display:'flex', flexDirection:'column' as const, padding:'12px 16px', overflow:'hidden' as const, gap:8 },
  pLabel:     { fontSize:9, letterSpacing:'0.16em', textTransform:'uppercase' as const, color:'var(--color-text-tertiary)', fontFamily:'monospace' },
  frame:      { flex:1, border:'none', borderRadius:8, background:'#000', display:'block', minHeight:0 },
  empty:      { flex:1, border:'0.5px dashed var(--color-border-tertiary)', borderRadius:8, display:'flex', flexDirection:'column' as const, alignItems:'center', justifyContent:'center', minHeight:0 },
}
