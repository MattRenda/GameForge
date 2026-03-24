'use client'
import { useState, useRef, useEffect, useCallback } from 'react'

// ── CONSTANTS ─────────────────────────────────────────────────
const ART_STYLES = [
  { id:'pixel',       label:'Pixel Art',        desc:'16-bit SNES style' },
  { id:'illustrated', label:'Hand-Illustrated',  desc:'Ink + watercolor' },
  { id:'painterly',   label:'Painterly',         desc:'Oil painting style' },
  { id:'anime',       label:'Anime',             desc:'Japanese 2D style' },
  { id:'dark',        label:'Dark Fantasy',      desc:'Gritty, detailed' },
]

const BUILD_STEPS = [
  { id:'style',       q:'Pick an art style for your game.',                       hint:null,                                                                    isStylePicker:true },
  { id:'perspective', q:'Top-down (like Zelda) or side-scrolling platformer?',    hint:'e.g. "top-down dungeon crawler" or "side-scrolling cave platformer"' },
  { id:'theme',       q:'Describe the world and atmosphere.',                     hint:'e.g. "dark gothic dungeon with lava" or "enchanted forest ruins"' },
  { id:'layout',      q:'Describe the level and what the player needs to do.',    hint:'e.g. "3 rooms — entrance, guard room with key, locked boss chamber"' },
  { id:'characters',  q:'Describe the player character and enemy types.',         hint:'e.g. "armored knight, skeleton patrol guards, giant demon boss"' },
]
const STEP_COLORS = ['#6366f1','#10b981','#0ea5e9','#ef4444','#f59e0b']

type StageStatus = 'pending'|'active'|'done'|'error'
interface Stages {
  claude:     { status:StageStatus; detail:string }
  background: { status:StageStatus; url?:string }
  tileset:    { status:StageStatus; url?:string }
  sprites:    { status:StageStatus; url?:string }
  phaser:     { status:StageStatus; detail:string }
}
const INIT_STAGES:Stages = {
  claude:{status:'pending',detail:''},
  background:{status:'pending'},
  tileset:{status:'pending'},
  sprites:{status:'pending'},
  phaser:{status:'pending',detail:''},
}

// ── PHASER HTML ───────────────────────────────────────────────
function buildPhaserHTML(levelData:any, assets:Record<string,string>) {
  // Single JSON.stringify — injected directly as JS object literals
  const LJ = JSON.stringify(levelData)
  const AJ = JSON.stringify(assets)
  return `<!DOCTYPE html><html><head><style>
*{margin:0;padding:0;box-sizing:border-box}body{background:#000;overflow:hidden;width:100vw;height:100vh}
#ui{position:fixed;top:8px;left:8px;color:#fff;font:bold 12px monospace;z-index:10;text-shadow:1px 1px 3px #000;pointer-events:none}
#hb{width:130px;height:10px;background:rgba(0,0,0,.5);border-radius:3px;margin-top:4px;border:1px solid rgba(255,255,255,.2)}
#hf{height:100%;background:#44ff88;border-radius:3px;transition:width .2s}
#rl{margin-top:3px;font-size:10px;color:rgba(255,255,255,.5)}
#kl{margin-top:2px;font-size:10px;color:#ffdd44}
#msg{position:fixed;top:45%;left:50%;transform:translate(-50%,-50%);color:#fff;font:bold 20px monospace;text-shadow:2px 2px 6px #000;text-align:center;pointer-events:none;z-index:20;opacity:0;transition:opacity .4s;white-space:pre-line}
#mm{position:fixed;bottom:10px;right:10px;border:1px solid rgba(255,255,255,.2);border-radius:4px;background:rgba(0,0,0,.7);z-index:10}
#ctrl{position:fixed;bottom:10px;left:10px;font:10px monospace;color:rgba(255,255,255,.35);z-index:10;line-height:1.8}
#as{position:fixed;top:8px;right:10px;font:10px monospace;color:#ffaa44;z-index:10;text-shadow:1px 1px 2px #000;transition:opacity 1s}
</style></head><body>
<div id="ui"><div>HP: <span id="hv">100</span></div><div id="hb"><div id="hf" style="width:100%"></div></div><div id="rl"></div><div id="kl"></div></div>
<div id="as" style="position:fixed;top:8px;right:10px;font:10px monospace;color:#ffaa44;z-index:10;text-shadow:1px 1px 2px #000;transition:opacity 1s">AI art active</div>
<div id="msg"></div>
<canvas id="mm" width="140" height="100"></canvas>
<div style="position:fixed;bottom:10px;left:10px;font:10px monospace;color:rgba(255,255,255,.35);z-index:10;line-height:1.8">WASD / Arrows — move &nbsp; Z — attack &nbsp; R — restart</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/phaser/3.60.0/phaser.min.js"></script>
<script>
const LEVEL=${LJ};
const ASSETS=${AJ};
const T=LEVEL.meta.tileSize||32,ITD=LEVEL.meta.perspective!=='platformer';
function hx(h){return Phaser.Display.Color.HexStringToColor(h||'#888').color;}
function tw(tx,ty){return{x:tx*T+T/2,y:ty*T+T/2};}
class G extends Phaser.Scene{
  constructor(){super('G');}
  preload(){
    if(ASSETS.backgroundUrl)this.load.image('bg',ASSETS.backgroundUrl);
    if(ASSETS.tilesetUrl)this.load.image('ts',ASSETS.tilesetUrl);
    if(ASSETS.spriteSheetUrl)this.load.image('sp',ASSETS.spriteSheetUrl);
  }
  create(){
    const W=LEVEL.meta.width||2560,H=LEVEL.meta.height||1920;
    this.cameras.main.setBackgroundColor(LEVEL.palette.background||'#080810');
    this.physics.world.setBounds(0,0,W,H);
    if(ASSETS.backgroundUrl&&this.textures.exists('bg')){
      this.add.image(W/2,H/2,'bg').setDisplaySize(W,H).setAlpha(0.55).setDepth(0);
      setTimeout(()=>{const el=document.getElementById('as');if(el)el.style.opacity='0';},3000);
    }
    this.php=LEVEL.player.hp||100;this.mhp=LEVEL.player.hp||100;
    this.kys=[];this.cr=null;this.el=0;this.pts=[];this.sb=[];this.rm={};this.it=[];this.en=[];
    this.gF=this.add.graphics().setDepth(1);this.gW=this.add.graphics().setDepth(2);
    this.gI=this.add.graphics().setDepth(4);this.gE=this.add.graphics().setDepth(5);
    this.gP=this.add.graphics().setDepth(6);this.gX=this.add.graphics().setDepth(7);
    const ht=ASSETS.tilesetUrl&&this.textures.exists('ts'),TF=256;
    LEVEL.rooms.forEach(room=>{
      this.rm[room.id]=room;
      const rx=room.x*T,ry=room.y*T;
      room.floorTiles.forEach((row,ri)=>{
        row.forEach((cell,ci)=>{
          const wx=rx+ci*T,wy=ry+ri*T;
          if(cell===1){
            if(ht){this.add.image(wx+T/2,wy+T/2,'ts').setCrop(0,0,TF,TF).setDisplaySize(T,T).setDepth(1);}
            else{this.gF.fillStyle(hx(LEVEL.palette.floor),1);this.gF.fillRect(wx,wy,T,T);this.gF.fillStyle(0xffffff,.05);this.gF.fillRect(wx,wy,T,2);}
            if(!ITD){this.gW.fillStyle(hx(LEVEL.palette.platform||LEVEL.palette.floor),1);this.gW.fillRect(wx,wy,T,4);this.sb.push({x:wx,y:wy,w:T,h:T,p:true});}
          } else if(ITD){
            if(ht){this.add.image(wx+T/2,wy+T/2,'ts').setCrop(TF,0,TF,TF).setDisplaySize(T,T).setAlpha(.9).setDepth(2);}
            else{this.gW.fillStyle(hx(LEVEL.palette.wall),1);this.gW.fillRect(wx,wy,T,T);this.gW.fillStyle(0xffffff,.04);this.gW.fillRect(wx+1,wy+1,T-2,4);}
            this.sb.push({x:wx,y:wy,w:T,h:T,p:false});
          }
        });
      });
      this.add.text(rx+room.w*T/2,ry+6,room.label||room.id,{fontSize:'9px',fontFamily:'monospace',color:'#ffffff',alpha:.2}).setOrigin(.5,0).setDepth(3);
      (room.items||[]).forEach(item=>{const wp=tw(room.x+item.x,room.y+item.y);this.it.push({...item,wx:wp.x,wy:wp.y,room:room.id,collected:false,bobOffset:Math.random()*Math.PI*2});});
      (room.enemies||[]).forEach(e=>{const wp=tw(room.x+e.x,room.y+e.y);const pt=(e.patrol||[]).map(p=>tw(room.x+p.x,room.y+p.y));this.en.push({...e,wx:wp.x,wy:wp.y,vx:0,vy:0,hp:e.hp||60,mhp:e.hp||60,patrol:pt,pi:0,room:room.id,alive:true,if:0,acd:0,bt:Math.random()*6.28,ag:e.type==='boss'?220:130});});
    });
    const sr=LEVEL.rooms.find(r=>r.id===LEVEL.player.spawnRoom)||LEVEL.rooms[0];
    const sp=tw(sr.x+(LEVEL.player.spawnX||2),sr.y+(LEVEL.player.spawnY||2));
    this.pl={x:sp.x,y:sp.y,vx:0,vy:0,w:LEVEL.player.size||14,h:LEVEL.player.size||14,speed:LEVEL.player.speed||180,color:hx(LEVEL.player.color||'#00d4ff'),og:false,if:0,dir:1,facing:'down',at:0,alive:true};
    // Use a camera target object Phaser can follow — updates every frame
    this.camTarget=this.add.rectangle(sp.x,sp.y,1,1,0x000000,0).setDepth(-1);
    this.cameras.main.setBounds(0,0,W,H);
    this.cameras.main.setZoom(1.6);
    this.cameras.main.startFollow(this.camTarget,true,0.1,0.1);
    this.cameras.main.centerOn(sp.x,sp.y);
    this.ks=this.input.keyboard.addKeys({w:'W',a:'A',s:'S',d:'D',up:'UP',down:'DOWN',left:'LEFT',right:'RIGHT',space:'SPACE',z:'Z',r:'R'});
    this.acd=0;this.mc=document.getElementById('mm').getContext('2d');
  }
  update(time,delta){
    const dt=Math.min(delta/1000,.05);this.el+=dt;
    if(!this.pl.alive)return;
    const P=this.pl,K=this.ks;
    const L=K.a.isDown||K.left.isDown,R=K.d.isDown||K.right.isDown;
    const U=K.w.isDown||K.up.isDown,Dn=K.s.isDown||K.down.isDown;
    if(K.r.isDown){this.scene.restart();return;}
    if(ITD){
      P.vx=((R?1:0)-(L?1:0))*P.speed;P.vy=((Dn?1:0)-(U?1:0))*P.speed;
      const len=Math.sqrt(P.vx*P.vx+P.vy*P.vy);if(len>0){P.vx=P.vx/len*P.speed;P.vy=P.vy/len*P.speed;}
      if(R)P.facing='right';if(L)P.facing='left';if(Dn)P.facing='down';if(U)P.facing='up';
    } else {
      P.vx=((R?1:0)-(L?1:0))*P.speed;
      if(U&&P.og){P.vy=-440;P.og=false;}
      P.vy=Math.min(P.vy+900*dt,700);if(R)P.dir=1;if(L)P.dir=-1;
    }
    if(Math.abs(P.vx)>10||Math.abs(P.vy)>10)P.at+=dt*8;
    this.acd=Math.max(0,this.acd-dt);
    if((K.z.isDown||K.space.isDown)&&this.acd<=0){this.atk();this.acd=0.32;}
    P.if=Math.max(0,P.if-dt);
    P.x+=P.vx*dt;this.rx(P);P.y+=P.vy*dt;if(!ITD)P.og=false;this.ry(P);
    this.it.forEach(item=>{
      if(item.collected)return;
      if(Math.hypot(P.x-item.wx,P.y-item.wy)<22){
        item.collected=true;
        if(item.type==='health')this.php=Math.min(this.mhp,this.php+35);
        if(item.type==='key')this.kys.push(item.label||'Key');
        this.burst(item.wx,item.wy,item.color||'#ffdd44',10);
        this.sm(item.type==='key'?'Key obtained!':item.type==='health'?'+35 HP!':item.label||'Item!',1800);
      }
    });
    this.en.forEach(e=>{
      if(!e.alive)return;
      e.if=Math.max(0,e.if-dt);e.acd=Math.max(0,e.acd-dt);e.bt+=dt*2;
      const dx=P.x-e.wx,dy=P.y-e.wy,dist=Math.hypot(dx,dy);
      if(dist<e.ag){
        const spd=e.speed||60;if(dist>3){e.vx=dx/dist*spd;e.vy=dy/dist*spd;}
        if(dist<(e.size||16)+P.w&&P.if<=0&&e.acd<=0){
          this.php-=e.type==='boss'?22:12;P.if=0.7;e.acd=1.1;
          this.cameras.main.shake(180,.006);
          if(this.php<=0){this.php=0;P.alive=false;this.sm('You Died\n\nPress R to restart',99999);}
        }
      } else if(e.patrol.length>0){
        const pt=e.patrol[e.pi%e.patrol.length];const pd=Math.hypot(pt.x-e.wx,pt.y-e.wy);
        if(pd<5){e.pi++;e.vx=0;e.vy=0;}else{const spd=e.speed*.55||33;e.vx=(pt.x-e.wx)/pd*spd;e.vy=(pt.y-e.wy)/pd*spd;}
      } else{e.vx*=.8;e.vy*=.8;}
      e.wx+=e.vx*dt;e.wy+=e.vy*dt;
    });
    // Update camera target to follow player smoothly
    if(this.camTarget){this.camTarget.x=P.x;this.camTarget.y=P.y;}
    LEVEL.rooms.forEach(room=>{
      if(P.x>room.x*T&&P.x<(room.x+room.w)*T&&P.y>room.y*T&&P.y<(room.y+room.h)*T){
        if(this.cr!==room.id){this.cr=room.id;const el=document.getElementById('rl');if(el)el.textContent=room.label||room.id;}
      }
    });
    this.rndr(dt);this.ui();this.dmm();
  }
  rx(e){const hw=e.w/2,hh=e.h/2;this.sb.forEach(b=>{if(b.p)return;if(e.x+hw>b.x&&e.x-hw<b.x+b.w&&e.y+hh>b.y&&e.y-hh<b.y+b.h){e.x=e.vx>0?b.x-hw:b.x+b.w+hw;e.vx=0;}});}
  ry(e){const hw=e.w/2,hh=e.h/2;this.sb.forEach(b=>{if(b.p){if(e.vy>=0&&e.y-e.vy*(1/60)+hh<=b.y+4&&e.y+hh>=b.y&&e.x+hw>b.x&&e.x-hw<b.x+b.w){e.y=b.y-hh;e.vy=0;e.og=true;}}else{if(e.x+hw>b.x&&e.x-hw<b.x+b.w&&e.y+hh>b.y&&e.y-hh<b.y+b.h){if(e.vy>0){e.y=b.y-hh;e.vy=0;e.og=true;}else{e.y=b.y+b.h+hh;e.vy=0;}}}});}
  atk(){
    const P=this.pl,dirs={right:[1,0],left:[-1,0],up:[0,-1],down:[0,1]};
    const d=dirs[P.facing]||[P.dir,0];const ax=P.x+d[0]*38,ay=P.y+d[1]*38;
    this.pts.push({x:ax,y:ay,r:16,life:1,decay:4,color:0xffffff,type:'slash'});
    this.en.forEach(e=>{if(!e.alive||e.if>0)return;if(Math.hypot(e.wx-ax,e.wy-ay)<32){e.hp-=28;e.if=.28;e.vx+=d[0]*150;e.vy+=d[1]*150;this.burst(e.wx,e.wy,'#ffffff',5);if(e.hp<=0){e.alive=false;this.burst(e.wx,e.wy,e.color||'#ff4466',18);}}});
  }
  burst(x,y,ch,n){const c=Phaser.Display.Color.HexStringToColor(ch||'#ff9900').color;for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,v=50+Math.random()*100;this.pts.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-20,r:2+Math.random()*4,life:1,decay:2+Math.random()*2,color:c,type:'dot'});}}
  rndr(dt){
    this.gI.clear();this.gE.clear();this.gP.clear();this.gX.clear();
    const t=this.el,P=this.pl;
    this.it.forEach(item=>{
      if(item.collected)return;
      const bob=Math.sin(t*3+item.bobOffset)*3,c=Phaser.Display.Color.HexStringToColor(item.color||'#ffdd44').color;
      this.gI.fillStyle(c,.9);
      if(item.type==='key'){this.gI.fillCircle(item.wx,item.wy+bob-3,6);this.gI.fillRect(item.wx-1,item.wy+bob,10,3);this.gI.fillRect(item.wx+6,item.wy+bob+1,3,3);}
      else if(item.type==='health'){this.gI.fillStyle(0xff4466,.9);this.gI.fillCircle(item.wx-3,item.wy+bob-2,5);this.gI.fillCircle(item.wx+3,item.wy+bob-2,5);this.gI.fillTriangle(item.wx-7,item.wy+bob,item.wx+7,item.wy+bob,item.wx,item.wy+bob+8);}
      else{this.gI.fillRect(item.wx-7,item.wy+bob-5,14,14);}
      this.gI.fillStyle(c,.12);this.gI.fillCircle(item.wx,item.wy+bob,16);
    });
    this.en.forEach(e=>{
      if(!e.alive)return;
      const fl=e.if>0&&Math.sin(e.if*40)>0,c=fl?0xffffff:Phaser.Display.Color.HexStringToColor(e.color||'#ff4466').color;
      const s=e.size||16,bob=Math.sin(e.bt)*2;
      this.gE.fillStyle(c,1);this.gE.fillRect(e.wx-s/2,e.wy+bob-s/2,s,s);
      if(e.type!=='boss'){for(let i=0;i<3;i++){this.gE.fillTriangle(e.wx-s/2+i*s/3,e.wy+bob-s/2,e.wx-s/2+i*s/3+s/6,e.wy+bob-s/2-9,e.wx-s/2+(i+1)*s/3,e.wy+bob-s/2);}}
      else{this.gE.lineStyle(2,0xff4466,.4+Math.sin(t*4)*.4);this.gE.strokeRect(e.wx-s/2-5,e.wy-s/2-5,s+10,s+10);}
      this.gE.fillStyle(0xffffff,1);this.gE.fillRect(e.wx-s/2+3,e.wy+bob-s/2+4,5,5);this.gE.fillRect(e.wx+2,e.wy+bob-s/2+4,5,5);
      this.gE.fillStyle(0xcc0000,1);this.gE.fillRect(e.wx-s/2+5,e.wy+bob-s/2+6,2,2);this.gE.fillRect(e.wx+4,e.wy+bob-s/2+6,2,2);
      const pct=e.hp/e.mhp;this.gE.fillStyle(0x222222,.8);this.gE.fillRect(e.wx-s/2,e.wy+bob-s/2-9,s,4);this.gE.fillStyle(pct>.5?0x44ff88:pct>.25?0xffaa00:0xff4444,1);this.gE.fillRect(e.wx-s/2,e.wy+bob-s/2-9,s*pct,4);
    });
    const fl=P.if>0&&Math.sin(P.if*40)>0,pc=fl?0xffffff:P.color;
    const ls=P.og||ITD?Math.sin(P.at)*5:0;
    this.gP.fillStyle(0x000000,.2);this.gP.fillEllipse(P.x,P.y+P.h/2+3,P.w,6);
    this.gP.fillStyle(Phaser.Display.Color.HexStringToColor(LEVEL.player.color||'#0066aa').color,1);
    this.gP.fillRect(P.x-P.w/2+2,P.y+P.h/2,P.w/2-2,7+ls);this.gP.fillRect(P.x+1,P.y+P.h/2,P.w/2-2,7-ls);
    this.gP.fillStyle(pc,1);this.gP.fillRect(P.x-P.w/2,P.y-P.h/2,P.w,P.h);this.gP.fillRect(P.x-P.w/2+2,P.y-P.h/2-11,P.w-4,13);
    const ex=P.dir>0||P.facing==='right'?P.x+2:P.x-P.w/2+1;
    this.gP.fillStyle(0xffffff,1);this.gP.fillRect(ex,P.y-P.h/2-8,5,5);this.gP.fillStyle(0x000000,1);this.gP.fillRect(ex+1,P.y-P.h/2-7,2,2);
    if(this.acd>.18){const d={right:[1,0],left:[-1,0],up:[0,-1],down:[0,1]}[P.facing]||[P.dir,0];this.gP.lineStyle(3,0xffffff,this.acd/.32);this.gP.beginPath();this.gP.arc(P.x,P.y,32,Math.atan2(d[1],d[0])-.65,Math.atan2(d[1],d[0])+.65);this.gP.strokePath();}
    this.pts=this.pts.filter(p=>p.life>.01);
    this.pts.forEach(p=>{p.life-=(p.decay||2)*dt;if(p.vx!==undefined){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=90*dt;p.vx*=.95;}this.gX.fillStyle(p.color,Math.max(0,p.life));if(p.type==='slash'){this.gX.fillRect(p.x-p.r,p.y-2,p.r*2,4);this.gX.fillRect(p.x-2,p.y-p.r,4,p.r*2);}else this.gX.fillCircle(p.x,p.y,Math.max(.5,p.r*p.life));});
  }
  ui(){
    const hv=document.getElementById('hv'),hf=document.getElementById('hf'),kl=document.getElementById('kl');
    if(hv)hv.textContent=String(Math.max(0,Math.round(this.php)));
    if(hf){const pct=Math.max(0,this.php/this.mhp);hf.style.width=(pct*100)+'%';hf.style.background=pct>.5?'#44ff88':pct>.25?'#ffaa00':'#ff4444';}
    if(kl&&this.kys.length>0)kl.textContent='Key: '+this.kys.join(', ');
  }
  dmm(){
    const ctx=this.mc,cw=140,ch=100,wW=LEVEL.meta.width||2560,wH=LEVEL.meta.height||1920;
    const sx=cw/wW,sy=ch/wH;ctx.clearRect(0,0,cw,ch);
    LEVEL.rooms.forEach(room=>{
      ctx.fillStyle=room.id===this.cr?'#3a5a3a':'#2a2a3a';ctx.fillRect(room.x*T*sx,room.y*T*sy,room.w*T*sx,room.h*T*sy);
      ctx.strokeStyle='#444';ctx.lineWidth=.5;ctx.strokeRect(room.x*T*sx,room.y*T*sy,room.w*T*sx,room.h*T*sy);
      this.en.filter(e=>e.room===room.id&&e.alive).forEach(e=>{ctx.fillStyle='#ff4466';ctx.fillRect(e.wx*sx-1.5,e.wy*sy-1.5,3,3);});
    });
    ctx.fillStyle='#00d4ff';ctx.beginPath();ctx.arc(this.pl.x*sx,this.pl.y*sy,3,0,Math.PI*2);ctx.fill();
  }
  sm(text,dur){const el=document.getElementById('msg');if(!el)return;el.textContent=text;el.style.opacity='1';if(this._mt)clearTimeout(this._mt);if(dur<99000)this._mt=setTimeout(()=>el.style.opacity='0',dur);}
}
new Phaser.Game({type:Phaser.AUTO,width:window.innerWidth,height:window.innerHeight,backgroundColor:LEVEL.palette.background||'#0a0a12',scene:G,parent:document.body,scale:{mode:Phaser.Scale.RESIZE,autoCenter:Phaser.Scale.CENTER_BOTH}});
</script></body></html>`
}

// ── FAL.AI HELPER ─────────────────────────────────────────────
async function falGenOne(prompt:string, falKey:string):Promise<string> {
  const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method:'POST',
    headers:{ 'Authorization':`Key ${falKey}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ prompt, image_size:{width:512,height:512}, num_inference_steps:4, num_images:1, enable_safety_checker:false }),
  })
  if (!res.ok) throw new Error(`fal.ai ${res.status}`)
  const data = await res.json()
  const url = data.images?.[0]?.url
  if (!url) throw new Error('No URL from fal.ai')
  return url
}

// ── STAGE INDICATOR ROW ───────────────────────────────────────
function StageRow({ label, sub, status, url }:{ label:string; sub:string; status:StageStatus; url?:string }) {
  const dotColor = status==='done'?'#1D9E75':status==='active'?'#7F77DD':status==='error'?'#E24B4A':'var(--color-border-secondary)'
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 10px', borderRadius:8, border:'0.5px solid var(--color-border-tertiary)', background:'var(--color-background-primary)', marginBottom:5 }}>
      <div style={{ width:8, height:8, borderRadius:'50%', flexShrink:0, background:dotColor, opacity: status==='active'?undefined:1 }} className={status==='active'?'pulse':''} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:500, color:'var(--color-text-primary)' }}>{label}</div>
        <div style={{ fontSize:10, color:'var(--color-text-tertiary)', marginTop:1 }}>{sub}</div>
      </div>
      {status==='done' && !url && <span style={{ color:'#1D9E75', fontSize:12 }}>✓</span>}
      {status==='active' && <span style={{ color:'#7F77DD', fontSize:10 }}>⟳</span>}
      {status==='done' && url && <img src={url} alt="" style={{ width:34, height:34, borderRadius:4, objectFit:'cover', border:'0.5px solid var(--color-border-tertiary)', flexShrink:0 }} />}
    </div>
  )
}

// ── ITERATION HISTORY ITEM ────────────────────────────────────
function IterItem({ msg, isUser }:{ msg:string; isUser:boolean }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:3, alignItems: isUser?'flex-end':'flex-start' }}>
      {!isUser && <div style={{ fontSize:9, letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--color-text-tertiary)', fontFamily:'monospace' }}>Gameforge</div>}
      <div style={{ fontSize:12, lineHeight:1.7, color:'var(--color-text-primary)', background: isUser?'var(--color-background-secondary)':'var(--color-background-primary)', maxWidth:'92%', padding:'8px 11px', borderRadius:8, border:'0.5px solid var(--color-border-tertiary)', whiteSpace:'pre-wrap', wordBreak:'break-word' }}>
        {msg}
      </div>
    </div>
  )
}

// ── MAIN BUILDER ──────────────────────────────────────────────
export default function Builder() {
  // Build flow state
  const [phase,      setPhase]      = useState<'splash'|'questions'|'building'|'done'>('splash')
  const [stepIdx,    setStepIdx]    = useState(0)
  const [buildMsgs,  setBuildMsgs]  = useState<Array<{role:string;content:string;type?:string}>>([])
  const [buildInput, setBuildInput] = useState('')
  const [stages,     setStages]     = useState<Stages>(INIT_STAGES)
  const [buildCount, setBuildCount] = useState(0)

  // Game state
  const [levelData,  setLevelData]  = useState<any>(null)
  const [assets,     setAssets]     = useState<Record<string,string>>({})
  const [gameHTML,   setGameHTML]   = useState<string|null>(null)
  const [answers,    setAnswers]    = useState<Record<string,string>>({})

  // Iteration state
  const [iterMsgs,   setIterMsgs]   = useState<Array<{text:string;isUser:boolean;tag?:string}>>([])
  const [iterInput,  setIterInput]  = useState('')
  const [iterating,  setIterating]  = useState(false)
  const [iterStage,  setIterStage]  = useState('')
  const [totalSpend, setTotalSpend] = useState(0)

  const buildEndRef = useRef<HTMLDivElement>(null)
  const iterEndRef  = useRef<HTMLDivElement>(null)
  const buildInputRef = useRef<HTMLTextAreaElement>(null)
  const iterInputRef  = useRef<HTMLTextAreaElement>(null)
  const answersRef    = useRef<Record<string,string>>({})
  const levelRef      = useRef<any>(null)
  const assetsRef     = useRef<Record<string,string>>({})
  answersRef.current  = answers
  levelRef.current    = levelData
  assetsRef.current   = assets

  useEffect(() => { buildEndRef.current?.scrollIntoView({ behavior:'smooth' }) }, [buildMsgs, stages])
  useEffect(() => { iterEndRef.current?.scrollIntoView({ behavior:'smooth' }) }, [iterMsgs, iterating])

  const addBuildMsg = (role:string, content:string, type?:string) =>
    setBuildMsgs(m => [...m, { role, content, type }])

  const setStage = (key:keyof Stages, update:any) =>
    setStages(s => ({ ...s, [key]:{ ...s[key], ...update } }))

  // ── FULL BUILD ──────────────────────────────────────────────
  const build = useCallback(async (allAnswers:Record<string,string>) => {
    setPhase('building')
    setStages(INIT_STAGES)
    setAssets({})
    setIterMsgs([])
    setBuildCount(c => c+1)

    // Stage 1: Claude level design
    setStage('claude', { status:'active', detail:'Designing rooms, enemies, items...' })
    const prompt =
      `Perspective: ${allAnswers.perspective}\n` +
      `Theme: ${allAnswers.theme}\n` +
      `Layout: ${allAnswers.layout}\n` +
      `Characters: ${allAnswers.characters}`

    let level:any = null
    try {
      const res  = await fetch('/api/generate-level', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ prompt }) })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      level = data.levelData
      setLevelData(level)
      const ne = level.rooms?.reduce((a:number,r:any)=>a+(r.enemies?.length||0),0)||0
      const ni = level.rooms?.reduce((a:number,r:any)=>a+(r.items?.length||0),0)||0
      setStage('claude', { status:'done', detail:`${level.rooms?.length} rooms · ${ne} enemies · ${ni} items` })
    } catch(e:any) {
      setStage('claude', { status:'error', detail:e.message })
      addBuildMsg('assistant', '⚠️ Level design failed: '+e.message, 'error')
      return
    }

    // Stage 2: fal.ai streaming
    setStage('background', { status:'active' })
    setStage('tileset',    { status:'active' })
    setStage('sprites',    { status:'active' })

    const styleLabel = ART_STYLES.find(s=>s.id===allAnswers.style)?.label || allAnswers.style || 'pixel art'
    const chars      = allAnswers.characters || ''
    const collected:Record<string,string> = {}

    try {
      const res = await fetch('/api/generate-assets', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          theme:             allAnswers.theme,
          style:             styleLabel,
          perspective:       level.meta?.perspective || allAnswers.perspective,
          enemyTypes:        [chars.split(/[,\.]/)[1]?.trim()||'enemy'],
          playerDescription: chars.split(/[,\.]/)[0]?.trim()||'hero',
        }),
      })
      if (!res.body) throw new Error('No stream body')
      const reader = res.body.getReader()
      const dec    = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream:true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)
            if (msg.type === 'asset') {
              collected[msg.key] = msg.url
              setAssets(prev => ({ ...prev, [msg.key]:msg.url }))
              const sk = msg.key==='backgroundUrl'?'background':msg.key==='tilesetUrl'?'tileset':'sprites'
              setStage(sk, { status:'done', url:msg.url })
              setTotalSpend(s => s+0.003)
            }
          } catch {}
        }
      }
    } catch(e:any) {
      addBuildMsg('assistant', `⚠️ Art generation failed: ${e.message}`, 'hint')
      ;['background','tileset','sprites'].forEach(k => setStage(k as keyof Stages, { status:'error' }))
    }

    // Stage 3: Launch
    setStage('phaser', { status:'active', detail:'Loading...' })
    await new Promise(r => setTimeout(r, 300))
    const html = buildPhaserHTML(level, collected)
    setGameHTML(html)
    setStage('phaser', { status:'done', detail:'Running' })
    setPhase('done')

    const hasArt = Object.keys(collected).length === 3
    setIterMsgs([{ text:`🎮 Game built!\n\n${level.rooms?.length} rooms · ${level.rooms?.reduce((a:number,r:any)=>a+(r.enemies?.length||0),0)} enemies${hasArt?'\n✓ All AI assets loaded':'\n⚠ Art generation had issues'}\n\nTell me what to change — anything about the gameplay, enemies, world, or art style.`, isUser:false, tag:'welcome' }])
    iterInputRef.current?.focus()
  }, [])

  // ── ITERATE ─────────────────────────────────────────────────
  const iterate = async () => {
    if (!iterInput.trim() || iterating) return
    const request = iterInput.trim()
    setIterInput('')
    setIterMsgs(m => [...m, { text:request, isUser:true }])
    setIterating(true)

    const falKey = '' // client can't use this — routed through API

    try {
      // Ask Claude what to change
      setIterStage('Claude analyzing change...')
      const planRes  = await fetch('/api/iterate', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          changeRequest: request,
          currentLevel:  levelRef.current,
          currentStyle:  answersRef.current.style,
          currentTheme:  answersRef.current.theme,
        }),
      })
      const { plan, error:planErr } = await planRes.json()
      if (planErr) throw new Error(planErr)

      const ct = plan.changeType as string

      // Apply logic patches to levelData
      let newLevel = levelRef.current ? JSON.parse(JSON.stringify(levelRef.current)) : null

      if ((ct==='logic'||ct==='full') && newLevel) {
        const pp = plan.playerPatch || {}
        if (pp.speed) newLevel.player.speed = pp.speed
        if (pp.hp)    { newLevel.player.hp = pp.hp; newLevel.player.hp = pp.hp }
        if (pp.color) newLevel.player.color = pp.color
        if (pp.size)  newLevel.player.size  = pp.size

        ;(plan.enemyPatches||[]).forEach((ep:any) => {
          const room = newLevel.rooms?.find((r:any) => r.id === ep.roomId)
          if (room?.enemies?.[ep.index]) {
            const e = room.enemies[ep.index]
            if (ep.hp)    e.hp = ep.hp
            if (ep.speed) e.speed = ep.speed
            if (ep.color) e.color = ep.color
          }
        })
        setLevelData(newLevel)
      }

      // Regenerate art if needed
      let newAssets = { ...assetsRef.current }

      if (ct==='art'||ct==='full'||ct==='asset') {
        setIterStage('fal.ai regenerating art...')
        const newTheme = plan.newTheme || answersRef.current.theme
        const newStyle = (ART_STYLES.find(s=>s.id===(plan.newStyle||answersRef.current.style))?.label) || plan.newStyle || answersRef.current.style || 'pixel art'
        const chars    = answersRef.current.characters || ''

        if (ct==='asset' && plan.assetKey) {
          // Regenerate just one asset
          const prompts:Record<string,string> = {
            backgroundUrl: `${newStyle} 2D game ${newLevel?.meta?.perspective!=='platformer'?'top-down overhead':'side-scrolling'} environment, ${newTheme}, atmospheric game background, no characters, no UI`,
            tilesetUrl:    `${newStyle} 2D game tileset sheet, 2x2 grid, 4 tiles: floor, wall, platform, ground, ${newTheme} style, each tile separated, game asset`,
            spriteSheetUrl:`${newStyle} 2D game sprite sheet, white background, 3 characters: player (${chars.split(/[,\.]/)[0]?.trim()||'hero'}), enemy, boss, facing right, no shadow`,
          }
          const genRes = await fetch('/api/generate-assets', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ theme:newTheme, style:newStyle, perspective:newLevel?.meta?.perspective, enemyTypes:[chars.split(/[,\.]/)[1]?.trim()||'enemy'], playerDescription:chars.split(/[,\.]/)[0]?.trim()||'hero' }),
          })
          // Read stream for just the one key we want
          if (genRes.body) {
            const reader = genRes.body.getReader()
            const dec = new TextDecoder()
            let buf2 = ''
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              buf2 += dec.decode(value, { stream:true })
              const lines2 = buf2.split('\n')
              buf2 = lines2.pop()||''
              for (const line of lines2) {
                try {
                  const msg = JSON.parse(line)
                  if (msg.type==='asset' && msg.key===plan.assetKey) {
                    newAssets[msg.key] = msg.url
                    setAssets(prev=>({...prev,[msg.key]:msg.url}))
                    setTotalSpend(s=>s+0.003)
                  }
                } catch {}
              }
            }
          }
        } else {
          // Full art regen — use streaming endpoint
          const genRes = await fetch('/api/generate-assets', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ theme:newTheme, style:newStyle, perspective:newLevel?.meta?.perspective, enemyTypes:[chars.split(/[,\.]/)[1]?.trim()||'enemy'], playerDescription:chars.split(/[,\.]/)[0]?.trim()||'hero' }),
          })
          if (genRes.body) {
            const reader = genRes.body.getReader()
            const dec = new TextDecoder()
            let buf3 = ''
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              buf3 += dec.decode(value, { stream:true })
              const lines3 = buf3.split('\n')
              buf3 = lines3.pop()||''
              for (const line of lines3) {
                try {
                  const msg = JSON.parse(line)
                  if (msg.type==='asset') {
                    newAssets[msg.key] = msg.url
                    setAssets(prev=>({...prev,[msg.key]:msg.url}))
                    setTotalSpend(s=>s+0.003)
                  }
                } catch {}
              }
            }
          }
          // Update answers so future iterations have new theme/style
          if (plan.newTheme) setAnswers(a=>({...a,theme:plan.newTheme}))
          if (plan.newStyle) setAnswers(a=>({...a,style:plan.newStyle}))
        }
      }

      // Rebuild game
      setIterStage('Rebuilding game...')
      const html = buildPhaserHTML(newLevel || levelRef.current, newAssets)
      setGameHTML(html)

      const costMap:Record<string,string> = { logic:'free','art':'~$0.009', asset:'~$0.003', full:'~$0.012' }
      setIterMsgs(m => [...m, { text:`✓ ${plan.summary}\n\nChange type: ${ct} · Cost: ${costMap[ct]||'free'}`, isUser:false }])

    } catch(e:any) {
      setIterMsgs(m => [...m, { text:'⚠️ '+e.message, isUser:false }])
    }

    setIterating(false)
    setIterStage('')
    iterInputRef.current?.focus()
  }

  // ── BUILD QUESTION FLOW ──────────────────────────────────────
  const sendBuild = async () => {
    if (!buildInput.trim()) return
    const answer = buildInput.trim()
    setBuildInput('')
    const step = BUILD_STEPS[stepIdx]
    addBuildMsg('user', answer)
    const newAnswers = { ...answersRef.current, [step.id]: answer }
    setAnswers(newAnswers)
    const nextIdx = stepIdx+1
    if (nextIdx >= BUILD_STEPS.length) {
      await build(newAnswers)
    } else {
      setStepIdx(nextIdx)
      addBuildMsg('assistant', BUILD_STEPS[nextIdx].q, 'question')
      if (BUILD_STEPS[nextIdx].hint) addBuildMsg('assistant', BUILD_STEPS[nextIdx].hint!, 'hint')
      setTimeout(()=>buildInputRef.current?.focus(),50)
    }
  }

  const pickStyle = (id:string) => {
    const label = ART_STYLES.find(s=>s.id===id)?.label||id
    addBuildMsg('user', label)
    const newAnswers = { ...answersRef.current, style:id }
    setAnswers(newAnswers)
    const nextIdx = stepIdx+1
    setStepIdx(nextIdx)
    addBuildMsg('assistant', BUILD_STEPS[nextIdx].q, 'question')
    if (BUILD_STEPS[nextIdx].hint) addBuildMsg('assistant', BUILD_STEPS[nextIdx].hint!, 'hint')
    setTimeout(()=>buildInputRef.current?.focus(),50)
  }

  const startOver = () => {
    setPhase('splash'); setStepIdx(0); setBuildMsgs([]); setBuildInput('')
    setLevelData(null); setAssets({}); setGameHTML(null); setAnswers({})
    setStages(INIT_STAGES); setIterMsgs([]); setIterInput(''); setIterating(false)
  }

  const isBuildPhase = phase==='building'
  const isDone       = phase==='done'
  const assetsReady  = Object.keys(assets).length
  const progress     = Math.min(1, stepIdx/BUILD_STEPS.length)

  return (
    <div style={S.app}>
      <style>{`.pulse{animation:blink 1s ease-in-out infinite}@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}`}</style>

      {/* TOP BAR */}
      <div style={S.bar}>
        <span style={S.logo}>⚙ GAMEFORGE</span>
        <span style={S.pill}>Claude · fal.ai · Phaser.js</span>
        {!isDone && <div style={S.track}><div style={{...S.fill,width:`${progress*100}%`}}/></div>}
        {isDone && <span style={{fontSize:10,fontFamily:'monospace',color:'var(--color-text-tertiary)',flex:1,textAlign:'right'}}>Total spent: ~${totalSpend.toFixed(3)}</span>}
        {isDone && <button style={S.regenBtn} onClick={startOver}>↺ Start Over</button>}
      </div>

      <div style={S.body}>
        {/* LEFT: build questions OR iteration console */}
        <div style={S.left}>
          {!isDone ? (
            // ── BUILD PHASE ──────────────────────────────────
            <>
              {phase!=='splash' && (
                <div style={S.dots}>
                  {BUILD_STEPS.map((s,i)=>{
                    const done=i<stepIdx,active=i===stepIdx&&phase==='questions'
                    return <div key={s.id} style={S.dot(done?'done':active?'active':'idle')}>{done?'✓':i+1}</div>
                  })}
                </div>
              )}
              <div style={S.feed}>
                {phase==='splash' ? (
                  <div style={S.splash}>
                    <div style={S.bigTitle}>Game<br/>Forge</div>
                    <p style={S.sub}>Claude designs the level.<br/>fal.ai generates all the art.<br/>Phaser runs the game.<br/>You iterate until it's perfect.</p>
                    <div style={S.featureGrid}>
                      <div style={S.fi}>🧠 Claude — level logic</div>
                      <div style={S.fi}>🎨 fal.ai — all visuals</div>
                      <div style={S.fi}>⚙️ Phaser — game engine</div>
                      <div style={S.fi}>🔄 Iterate freely after build</div>
                    </div>
                    <button style={S.cta} onClick={()=>{setPhase('questions');addBuildMsg('assistant',BUILD_STEPS[0].q,'question');setTimeout(()=>buildInputRef.current?.focus(),100)}}>Start Building →</button>
                  </div>
                ) : buildMsgs.map((m,i)=>(
                  <div key={i} style={{ display:'flex', flexDirection:'column', gap:3, alignItems:m.role==='user'?'flex-end':'flex-start' }}>
                    {m.role==='assistant'&&m.type!=='hint'&&<div style={S.from}>Gameforge</div>}
                    <div style={{...S.bubble(m.role),...(m.type==='hint'?S.hintB:{}),(m.type==='question'?S.questionB:{}),(m.type==='error'?S.errorB:{})}}>{m.content}</div>
                  </div>
                ))}

                {phase==='questions' && BUILD_STEPS[stepIdx]?.isStylePicker && (
                  <div style={{display:'flex',flexDirection:'column',gap:6,margin:'4px 0'}}>
                    {ART_STYLES.map(style=>(
                      <button key={style.id} onClick={()=>pickStyle(style.id)}
                        style={{background:'var(--color-background-secondary)',border:'0.5px solid var(--color-border-tertiary)',borderRadius:8,padding:'10px 12px',cursor:'pointer',textAlign:'left',fontFamily:'inherit'}}>
                        <div style={{fontSize:12,fontWeight:500,color:'var(--color-text-primary)'}}>{style.label}</div>
                        <div style={{fontSize:10,color:'var(--color-text-tertiary)',marginTop:2}}>{style.desc}</div>
                      </button>
                    ))}
                  </div>
                )}

                {isBuildPhase && (
                  <div style={{marginTop:4}}>
                    <StageRow label="Claude — level design"   sub={stages.claude.detail}           status={stages.claude.status} />
                    <StageRow label="fal.ai — background"     sub="512×512 · flux/schnell"          status={stages.background.status} url={stages.background.url} />
                    <StageRow label="fal.ai — tileset"        sub="floor + wall tiles"              status={stages.tileset.status}    url={stages.tileset.url} />
                    <StageRow label="fal.ai — sprites"        sub="player + enemies + boss"         status={stages.sprites.status}    url={stages.sprites.url} />
                    <StageRow label="Phaser — launch"         sub={stages.phaser.detail||'waiting'} status={stages.phaser.status} />
                    <div style={{fontSize:10,color:'var(--color-text-tertiary)',fontFamily:'monospace',marginTop:6,padding:'6px 10px',background:'var(--color-background-secondary)',borderRadius:6}}>
                      {assetsReady}/3 assets · ~${(0.003*assetsReady).toFixed(3)} so far
                    </div>
                  </div>
                )}
                <div ref={buildEndRef}/>
              </div>

              {phase==='questions' && !BUILD_STEPS[stepIdx]?.isStylePicker && (
                <div style={S.inputArea}>
                  <div style={S.inputRow}>
                    <textarea ref={buildInputRef} style={S.textarea(STEP_COLORS[stepIdx]||'#7c3aed')}
                      value={buildInput} rows={2}
                      onChange={e=>setBuildInput(e.target.value)}
                      onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendBuild();}}}
                      placeholder="Your answer..." />
                    <button style={S.sendBtn(STEP_COLORS[stepIdx]||'#7c3aed')} onClick={sendBuild}>→</button>
                  </div>
                </div>
              )}
            </>
          ) : (
            // ── ITERATION CONSOLE ────────────────────────────
            <>
              <div style={S.iterHeader}>
                <div style={{fontSize:10,fontWeight:500,color:'var(--color-text-primary)'}}>Iteration Console</div>
                <div style={{fontSize:9,color:'var(--color-text-tertiary)',fontFamily:'monospace'}}>Describe any change — Claude decides what to regenerate</div>
              </div>
              <div style={S.feed}>
                {iterMsgs.map((m,i)=>(
                  <IterItem key={i} msg={m.text} isUser={m.isUser}/>
                ))}
                {iterating && (
                  <div style={{display:'flex',flexDirection:'column',gap:3}}>
                    <div style={{fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--color-text-tertiary)',fontFamily:'monospace'}}>Gameforge</div>
                    <div style={{fontSize:12,color:'var(--color-text-tertiary)',padding:'8px 11px',background:'var(--color-background-primary)',borderRadius:8,border:'0.5px solid var(--color-border-tertiary)'}}>
                      <span style={{opacity:.4}}>⟳</span> {iterStage||'Working...'}
                    </div>
                  </div>
                )}
                <div ref={iterEndRef}/>
              </div>
              <div style={S.inputArea}>
                <div style={{fontSize:10,color:'var(--color-text-tertiary)',fontFamily:'monospace',marginBottom:6,display:'flex',gap:8}}>
                  <span>Logic changes: free</span>
                  <span>·</span>
                  <span>Art changes: ~$0.009</span>
                </div>
                <div style={S.inputRow}>
                  <textarea ref={iterInputRef} style={S.textarea('#6366f1')}
                    value={iterInput} rows={2} disabled={iterating}
                    onChange={e=>setIterInput(e.target.value)}
                    onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();iterate();}}}
                    placeholder='e.g. "make the player faster" or "change to neon cyberpunk style"' />
                  <button style={S.sendBtn('#6366f1')} onClick={iterate} disabled={iterating}>→</button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* RIGHT: preview */}
        <div style={S.right}>
          <div style={S.pLabel}>{gameHTML?'Live Game — Click to focus':'Game Preview'}</div>

          {gameHTML ? (
            <iframe key={JSON.stringify(assets)+String(levelData?.player?.speed)} srcDoc={gameHTML} style={S.frame} sandbox="allow-scripts" title="game" allow="autoplay"/>
          ) : (
            <div style={S.empty}>
              {phase==='splash' ? (
                <div style={{textAlign:'center',color:'var(--color-text-tertiary)'}}>
                  <div style={{fontSize:40,marginBottom:16}}>🎮</div>
                  <div style={{fontSize:11,fontFamily:'monospace',lineHeight:2.2}}>
                    fal.ai background + tileset + sprites<br/>
                    Phaser loads and runs everything<br/>
                    Claude drives all the logic<br/>
                    Iterate after build to refine
                  </div>
                </div>
              ):(
                <div style={{textAlign:'center',color:'var(--color-text-tertiary)'}}>
                  <div style={{fontSize:32,marginBottom:12}}>⏳</div>
                  <div style={{fontSize:11,fontFamily:'monospace'}}>{isBuildPhase?`${assetsReady}/3 assets ready`:'Answer the questions →'}</div>
                </div>
              )}
            </div>
          )}

          {gameHTML && <div style={{fontSize:10,color:'var(--color-text-tertiary)',fontFamily:'monospace',marginTop:4}}>WASD/Arrows = move · Z = attack · R = restart</div>}

          {/* Asset thumbnails */}
          {Object.keys(assets).length>0 && (
            <div style={{background:'var(--color-background-primary)',border:'0.5px solid var(--color-border-tertiary)',borderRadius:8,padding:'10px 12px',flexShrink:0}}>
              <div style={{fontSize:9,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--color-text-tertiary)',marginBottom:8,fontFamily:'monospace'}}>fal.ai assets</div>
              <div style={{display:'flex',gap:8}}>
                {[{key:'backgroundUrl',label:'BG'},{key:'tilesetUrl',label:'Tiles'},{key:'spriteSheetUrl',label:'Sprites'}].map(({key,label})=>
                  assets[key]
                    ? <div key={key} style={{textAlign:'center'}}><img src={assets[key]} alt={label} style={{width:56,height:56,objectFit:'cover',borderRadius:4,border:'0.5px solid var(--color-border-tertiary)',display:'block'}}/><div style={{fontSize:9,color:'var(--color-text-tertiary)',marginTop:3,fontFamily:'monospace'}}>{label}</div></div>
                    : <div key={key} style={{width:56,height:56,borderRadius:4,border:'0.5px solid var(--color-border-tertiary)',background:'var(--color-background-secondary)',display:'flex',alignItems:'center',justifyContent:'center'}}><div style={{fontSize:9,color:'var(--color-text-tertiary)',textAlign:'center',fontFamily:'monospace'}}>{label}<br/>⟳</div></div>
                )}
              </div>
              <div style={{fontSize:9,color:'var(--color-text-tertiary)',fontFamily:'monospace',marginTop:6}}>flux/schnell · 512×512 · ~${(0.003*Object.keys(assets).length).toFixed(3)}</div>
            </div>
          )}

          {/* Level stats */}
          {levelData && (
            <div style={{display:'flex',gap:8,flexWrap:'wrap',flexShrink:0}}>
              {[
                {l:'Rooms',   v:levelData.rooms?.length},
                {l:'Enemies', v:levelData.rooms?.reduce((a:number,r:any)=>a+(r.enemies?.length||0),0)},
                {l:'Items',   v:levelData.rooms?.reduce((a:number,r:any)=>a+(r.items?.length||0),0)},
                {l:'Type',    v:levelData.meta?.perspective},
              ].map(({l,v})=>(
                <div key={l} style={{background:'var(--color-background-primary)',border:'0.5px solid var(--color-border-tertiary)',borderRadius:6,padding:'5px 10px',textAlign:'center',minWidth:52}}>
                  <div style={{fontSize:9,color:'var(--color-text-tertiary)'}}>{l}</div>
                  <div style={{fontSize:11,fontWeight:500,color:'var(--color-text-primary)'}}>{v}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── STYLES ────────────────────────────────────────────────────
const S = {
  app:      {fontFamily:"'Georgia',serif",background:'var(--color-background-tertiary)',height:'100vh',display:'flex',flexDirection:'column' as const,overflow:'hidden' as const},
  bar:      {background:'var(--color-background-primary)',borderBottom:'0.5px solid var(--color-border-tertiary)',padding:'0 16px',height:44,display:'flex',alignItems:'center',gap:12,flexShrink:0 as const},
  logo:     {fontWeight:500,fontSize:13,letterSpacing:'0.18em',textTransform:'uppercase' as const,color:'var(--color-text-primary)',flexShrink:0 as const},
  pill:     {fontSize:10,fontFamily:'monospace',color:'var(--color-text-tertiary)',background:'var(--color-background-secondary)',padding:'2px 8px',borderRadius:20,border:'0.5px solid var(--color-border-tertiary)',flexShrink:0 as const},
  track:    {flex:1,maxWidth:120,height:2,background:'var(--color-border-tertiary)',borderRadius:1},
  fill:     {height:'100%',background:'var(--color-text-primary)',borderRadius:1,transition:'width 0.5s ease'},
  regenBtn: {background:'var(--color-background-secondary)',border:'0.5px solid var(--color-border-secondary)',color:'var(--color-text-secondary)',borderRadius:4,padding:'4px 12px',cursor:'pointer',fontFamily:'inherit',fontSize:11,flexShrink:0 as const},
  body:     {display:'flex',flex:1,overflow:'hidden' as const},
  left:     {width:300,flexShrink:0 as const,borderRight:'0.5px solid var(--color-border-tertiary)',background:'var(--color-background-primary)',display:'flex',flexDirection:'column' as const,overflow:'hidden' as const},
  dots:     {display:'flex',gap:5,padding:'10px 14px 8px',borderBottom:'0.5px solid var(--color-border-tertiary)',flexShrink:0 as const},
  dot:      (s:string)=>({width:24,height:24,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontFamily:'monospace',fontWeight:500,flexShrink:0 as const,background:s==='done'?'var(--color-text-primary)':s==='active'?'var(--color-background-secondary)':'transparent',color:s==='done'?'var(--color-background-primary)':s==='active'?'var(--color-text-primary)':'var(--color-border-secondary)',border:`0.5px solid ${s==='done'?'var(--color-text-primary)':s==='active'?'var(--color-border-secondary)':'var(--color-border-tertiary)'}`}),
  feed:     {flex:1,overflowY:'auto' as const,padding:'14px',display:'flex',flexDirection:'column' as const,gap:8},
  iterHeader:{padding:'10px 14px',borderBottom:'0.5px solid var(--color-border-tertiary)',flexShrink:0 as const},
  splash:   {flex:1,display:'flex',flexDirection:'column' as const,justifyContent:'center',paddingBottom:20},
  bigTitle: {fontSize:42,fontWeight:500,lineHeight:0.9,letterSpacing:'-0.03em',color:'var(--color-text-primary)',marginBottom:14},
  sub:      {fontSize:12,color:'var(--color-text-secondary)',lineHeight:1.8,marginBottom:12},
  featureGrid:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:20},
  fi:       {fontSize:11,color:'var(--color-text-tertiary)',fontFamily:'monospace'},
  cta:      {background:'var(--color-text-primary)',color:'var(--color-background-primary)',border:'none',borderRadius:4,padding:'10px 22px',fontSize:13,fontFamily:"'Georgia',serif",fontWeight:500,cursor:'pointer',alignSelf:'flex-start' as const},
  from:     {fontSize:9,letterSpacing:'0.14em',textTransform:'uppercase' as const,color:'var(--color-text-tertiary)',fontFamily:'monospace'},
  bubble:   (role:string)=>({fontSize:12,lineHeight:1.75,color:'var(--color-text-primary)',background:role==='user'?'var(--color-background-secondary)':'var(--color-background-primary)',maxWidth:'92%',padding:'8px 11px',borderRadius:8,border:'0.5px solid var(--color-border-tertiary)',whiteSpace:'pre-wrap' as const,wordBreak:'break-word' as const}),
  hintB:    {background:'transparent',border:'none',color:'var(--color-text-tertiary)',fontSize:11,padding:'0 11px',fontStyle:'italic' as const},
  questionB:{borderLeft:'2px solid #7F77DD'},
  errorB:   {borderLeft:'2px solid #E24B4A',background:'var(--color-background-danger)'},
  inputArea:{borderTop:'0.5px solid var(--color-border-tertiary)',padding:'10px 12px',flexShrink:0 as const,background:'var(--color-background-primary)'},
  inputRow: {display:'flex',gap:7,alignItems:'flex-end' as const},
  textarea: (accent:string)=>({flex:1,background:'var(--color-background-secondary)',border:'0.5px solid var(--color-border-tertiary)',borderBottom:`2px solid ${accent}`,borderRadius:'4px 4px 0 0',color:'var(--color-text-primary)',fontFamily:"'Georgia',serif",fontSize:12,padding:'7px 9px',resize:'none' as const,outline:'none'}),
  sendBtn:  (c:string)=>({background:c,border:'none',color:'#fff',fontFamily:"'Georgia',serif",fontSize:16,borderRadius:4,padding:'8px 14px',cursor:'pointer',flexShrink:0 as const,alignSelf:'flex-end' as const}),
  right:    {flex:1,background:'var(--color-background-secondary)',display:'flex',flexDirection:'column' as const,padding:'12px 16px',overflow:'hidden' as const,gap:8},
  pLabel:   {fontSize:9,letterSpacing:'0.16em',textTransform:'uppercase' as const,color:'var(--color-text-tertiary)',fontFamily:'monospace'},
  frame:    {flex:1,border:'none',borderRadius:8,background:'#000',display:'block',minHeight:0},
  empty:    {flex:1,border:'0.5px dashed var(--color-border-tertiary)',borderRadius:8,display:'flex',flexDirection:'column' as const,alignItems:'center',justifyContent:'center',minHeight:0},
}
