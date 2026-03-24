'use client'
import { useState, useRef, useEffect, useCallback } from 'react'

const ART_STYLES = [
  { id:'pixel',       label:'Pixel Art',       desc:'16-bit SNES style' },
  { id:'illustrated', label:'Hand-Illustrated', desc:'Ink + watercolor' },
  { id:'painterly',   label:'Painterly',        desc:'Oil painting style' },
  { id:'anime',       label:'Anime',            desc:'Japanese 2D style' },
  { id:'dark',        label:'Dark Fantasy',     desc:'Gritty, detailed' },
]

const BUILD_STEPS = [
  { id:'style',       q:'Pick an art style for your game.',                       hint:null,                                                                   isStylePicker:true },
  { id:'perspective', q:'Top-down (like Zelda) or side-scrolling platformer?',    hint:'e.g. "top-down dungeon crawler" or "side-scrolling cave platformer"' },
  { id:'theme',       q:'Describe the world and atmosphere.',                     hint:'e.g. "dark gothic dungeon with lava" or "enchanted forest ruins"' },
  { id:'layout',      q:'Describe the level and what the player needs to do.',    hint:'e.g. "3 rooms, entrance, guard room with key, locked boss chamber"' },
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
const INIT_STAGES: Stages = {
  claude:     { status:'pending', detail:'' },
  background: { status:'pending' },
  tileset:    { status:'pending' },
  sprites:    { status:'pending' },
  phaser:     { status:'pending', detail:'' },
}

// Build Phaser iframe HTML — kept as a regular function, no JSX

// Build Phaser iframe HTML
function buildPhaserHTML(levelData: any, assets: Record<string,string>): string {
  const LEVEL = JSON.stringify(levelData)
  const ASSETS = JSON.stringify(assets)

  const css = [
    '*{margin:0;padding:0;box-sizing:border-box}',
    'body{background:#000;overflow:hidden;width:100vw;height:100vh}',
    '#ui{position:fixed;top:8px;left:8px;color:#fff;font:bold 12px monospace;z-index:10;text-shadow:1px 1px 3px #000;pointer-events:none}',
    '#hb{width:130px;height:10px;background:rgba(0,0,0,.5);border-radius:3px;margin-top:4px;border:1px solid rgba(255,255,255,.2)}',
    '#hf{height:100%;background:#44ff88;border-radius:3px;transition:width .2s}',
    '#rl{margin-top:3px;font-size:10px;color:rgba(255,255,255,.5)}',
    '#kl{margin-top:2px;font-size:10px;color:#ffdd44}',
    '#msg{position:fixed;top:45%;left:50%;transform:translate(-50%,-50%);color:#fff;font:bold 20px monospace;text-shadow:2px 2px 6px #000;text-align:center;pointer-events:none;z-index:20;opacity:0;transition:opacity .4s;white-space:pre-line}',
    '#mm{position:fixed;bottom:10px;right:10px;border:1px solid rgba(255,255,255,.2);border-radius:4px;background:rgba(0,0,0,.7);z-index:10}',
    '#as{position:fixed;top:8px;right:10px;font:10px monospace;color:#ffaa44;z-index:10;transition:opacity 2s}',
    '#ctrl{position:fixed;bottom:10px;left:10px;font:10px monospace;color:rgba(255,255,255,.4);z-index:10}',
    '#dbg{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#fff;font:11px monospace;background:rgba(0,0,0,.7);padding:8px 12px;border-radius:6px;z-index:30;pointer-events:none;opacity:0;transition:opacity 1s}',
  ].join('')

  // Game logic as a plain string — no template literal nesting
  const lines = [
    'var LEVEL=' + LEVEL + ';',
    'var ASSETS=' + ASSETS + ';',
    'var T=LEVEL.meta.tileSize||32;',
    'var ITD=LEVEL.meta.perspective!=="platformer";',
    '',
    'function hx(h){return Phaser.Display.Color.HexStringToColor(h||"#888888").color;}',
    'function tw(tx,ty){return{x:tx*T+T/2,y:ty*T+T/2};}',
    '',
    '// Compute real world size from room extents',
    'function worldBounds(){',
    '  var mx=0,my=0;',
    '  LEVEL.rooms.forEach(function(r){mx=Math.max(mx,(r.x+r.w)*T+128);my=Math.max(my,(r.y+r.h)*T+128);});',
    '  return{w:Math.max(mx,600),h:Math.max(my,600)};',
    '}',
    '',
    'var G=function(){Phaser.Scene.call(this,"G");};',
    'G.prototype=Object.create(Phaser.Scene.prototype);',
    'G.prototype.constructor=G;',
    '',
    'G.prototype.preload=function(){',
    '  if(ASSETS.backgroundUrl)this.load.image("bg",ASSETS.backgroundUrl);',
    '  if(ASSETS.tilesetUrl)this.load.image("ts",ASSETS.tilesetUrl);',
    '  if(ASSETS.spriteSheetUrl)this.load.image("sp",ASSETS.spriteSheetUrl);',
    '};',
    '',
    'G.prototype.create=function(){',
    '  var bounds=worldBounds();',
    '  var W=bounds.w,H=bounds.h;',
    '  this.cameras.main.setBackgroundColor(LEVEL.palette.background||"#080810");',
    '  this.physics.world.setBounds(0,0,W,H);',
    '',
    '  // Background image tiled across world',
    '  if(ASSETS.backgroundUrl&&this.textures.exists("bg")){',
    '    var bg=this.add.image(W/2,H/2,"bg").setDisplaySize(W,H).setAlpha(0.5).setDepth(0);',
    '    setTimeout(function(){var el=document.getElementById("as");if(el)el.style.opacity="0";},3000);',
    '  } else {',
    '    document.getElementById("as").textContent="No BG image";',
    '  }',
    '',
    '  this.php=LEVEL.player.hp||100; this.mhp=this.php;',
    '  this.kys=[]; this.cr=null; this.el=0; this.pts=[]; this.sb=[]; this.it=[]; this.en=[];',
    '',
    '  // Graphics layers — drawn in world space',
    '  this.gF=this.add.graphics().setDepth(1);',
    '  this.gW=this.add.graphics().setDepth(2);',
    '  this.gI=this.add.graphics().setDepth(4);',
    '  this.gE=this.add.graphics().setDepth(5);',
    '  this.gP=this.add.graphics().setDepth(6);',
    '  this.gX=this.add.graphics().setDepth(7);',
    '',
    '  var hasTiles=!!(ASSETS.tilesetUrl&&this.textures.exists("ts"));',
    '  var self=this;',
    '',
    '  LEVEL.rooms.forEach(function(room){',
    '    var rx=room.x*T, ry=room.y*T;',
    '    room.floorTiles.forEach(function(row,ri){',
    '      row.forEach(function(cell,ci){',
    '        var wx=rx+ci*T, wy=ry+ri*T;',
    '        if(cell===1){',
    '          if(hasTiles){',
    '            // Crop top-left quadrant of tileset for floor',
    '            var img=self.add.image(wx+T/2,wy+T/2,"ts");',
    '            img.setCrop(0,0,256,256).setDisplaySize(T,T).setDepth(1);',
    '          } else {',
    '            self.gF.fillStyle(hx(LEVEL.palette.floor||"#4a5a3a"),1);',
    '            self.gF.fillRect(wx,wy,T,T);',
    '            self.gF.fillStyle(0xffffff,0.06);',
    '            self.gF.fillRect(wx,wy,T,2);',
    '            self.gF.lineStyle(0.5,0x000000,0.15);',
    '            self.gF.strokeRect(wx,wy,T,T);',
    '          }',
    '          if(!ITD){',
    '            // Platform top edge for side-scroller',
    '            self.gW.fillStyle(hx(LEVEL.palette.platform||LEVEL.palette.floor||"#5a4a3a"),1);',
    '            self.gW.fillRect(wx,wy,T,4);',
    '            self.sb.push({x:wx,y:wy,w:T,h:T,p:true});',
    '          }',
    '        } else if(ITD){',
    '          if(hasTiles){',
    '            // Crop top-right quadrant of tileset for wall',
    '            var wimg=self.add.image(wx+T/2,wy+T/2,"ts");',
    '            wimg.setCrop(256,0,256,256).setDisplaySize(T,T).setAlpha(0.9).setDepth(2);',
    '          } else {',
    '            self.gW.fillStyle(hx(LEVEL.palette.wall||"#2a2a2a"),1);',
    '            self.gW.fillRect(wx,wy,T,T);',
    '            self.gW.fillStyle(0xffffff,0.04);',
    '            self.gW.fillRect(wx+1,wy+1,T-2,4);',
    '          }',
    '          self.sb.push({x:wx,y:wy,w:T,h:T,p:false});',
    '        }',
    '      });',
    '    });',
    '    // Room label',
    '    self.add.text(rx+room.w*T/2, ry+5, room.label||room.id, {',
    '      fontSize:"9px",fontFamily:"monospace",color:"#ffffff"',
    '    }).setAlpha(0.25).setOrigin(0.5,0).setDepth(3);',
    '    // Items',
    '    (room.items||[]).forEach(function(item){',
    '      var wp=tw(room.x+item.x,room.y+item.y);',
    '      self.it.push({type:item.type,label:item.label||item.type,color:item.color||"#ffdd44",size:item.size||12,wx:wp.x,wy:wp.y,room:room.id,collected:false,bobOffset:Math.random()*6.28});',
    '    });',
    '    // Enemies',
    '    (room.enemies||[]).forEach(function(e){',
    '      var wp=tw(room.x+e.x,room.y+e.y);',
    '      var patrol=(e.patrol||[]).map(function(p){return tw(room.x+p.x,room.y+p.y);});',
    '      self.en.push({type:e.type||"patrol",color:e.color||"#ff4466",size:e.size||16,speed:e.speed||60,wx:wp.x,wy:wp.y,vx:0,vy:0,hp:e.hp||60,mhp:e.hp||60,patrol:patrol,pi:0,room:room.id,alive:true,ifc:0,acd:0,bt:Math.random()*6.28,ag:e.type==="boss"?220:130});',
    '    });',
    '  });',
    '',
    '  // Player spawn',
    '  var sr=LEVEL.rooms.find(function(r){return r.id===LEVEL.player.spawnRoom;})||LEVEL.rooms[0];',
    '  var sp=tw(sr.x+(LEVEL.player.spawnX||2), sr.y+(LEVEL.player.spawnY||2));',
    '  this.pl={x:sp.x,y:sp.y,vx:0,vy:0,w:LEVEL.player.size||14,h:LEVEL.player.size||14,speed:LEVEL.player.speed||180,color:hx(LEVEL.player.color||"#00d4ff"),og:false,ifc:0,dir:1,facing:"down",at:0,alive:true};',
    '',
    '  // Debug: show spawn position briefly',
    '  var dbg=document.getElementById("dbg");',
    '  if(dbg){dbg.textContent="Spawn: "+Math.round(sp.x)+","+Math.round(sp.y)+" World: "+W+"x"+H+" Rooms: "+LEVEL.rooms.length;dbg.style.opacity="1";setTimeout(function(){dbg.style.opacity="0";},3000);}',
    '',
    '  // Camera: follow invisible target, center immediately on spawn',
    '  this.camTarget=this.add.rectangle(sp.x,sp.y,2,2,0xff0000,0).setDepth(-1);',
    '  this.cameras.main.setBounds(0,0,W,H);',
    '  this.cameras.main.setZoom(1.8);',
    '  this.cameras.main.startFollow(this.camTarget,true,0.08,0.08);',
    '  this.cameras.main.centerOn(sp.x,sp.y);',
    '',
    '  this.ks=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",dn:"DOWN",lt:"LEFT",rt:"RIGHT",sp:"SPACE",z:"Z",r:"R"});',
    '  this.acd=0;',
    '  var mmEl=document.getElementById("mm");',
    '  this.mc=mmEl?mmEl.getContext("2d"):null;',
    '};',
    '',
    'G.prototype.update=function(time,delta){',
    '  var dt=Math.min(delta/1000,0.05);',
    '  this.el=(this.el||0)+dt;',
    '  if(!this.pl||!this.pl.alive)return;',
    '  var P=this.pl,K=this.ks;',
    '  var L=K.lt.isDown||K.a.isDown, R=K.rt.isDown||K.d.isDown;',
    '  var U=K.up.isDown||K.w.isDown, Dn=K.dn.isDown||K.s.isDown;',
    '  if(K.r.isDown){this.scene.restart();return;}',
    '  if(ITD){',
    '    P.vx=((R?1:0)-(L?1:0))*P.speed;',
    '    P.vy=((Dn?1:0)-(U?1:0))*P.speed;',
    '    var len=Math.sqrt(P.vx*P.vx+P.vy*P.vy);',
    '    if(len>0){P.vx=P.vx/len*P.speed;P.vy=P.vy/len*P.speed;}',
    '    if(R)P.facing="right"; if(L)P.facing="left";',
    '    if(Dn)P.facing="down"; if(U)P.facing="up";',
    '  } else {',
    '    P.vx=((R?1:0)-(L?1:0))*P.speed;',
    '    if(U&&P.og){P.vy=-440;P.og=false;}',
    '    P.vy=Math.min((P.vy||0)+900*dt,700);',
    '    if(R)P.dir=1; if(L)P.dir=-1;',
    '  }',
    '  if(Math.abs(P.vx)>10||Math.abs(P.vy)>10)P.at=(P.at||0)+dt*8;',
    '  this.acd=Math.max(0,(this.acd||0)-dt);',
    '  if((K.z.isDown||K.sp.isDown)&&this.acd<=0){this.doAtk();this.acd=0.32;}',
    '  P.ifc=Math.max(0,(P.ifc||0)-dt);',
    '  P.x+=P.vx*dt; this.resX(P);',
    '  P.y+=(P.vy||0)*dt; if(!ITD)P.og=false; this.resY(P);',
    '  if(this.camTarget){this.camTarget.x=P.x;this.camTarget.y=P.y;}',
    '',
    '  var self=this;',
    '  this.it.forEach(function(item){',
    '    if(item.collected)return;',
    '    if(Math.hypot(P.x-item.wx,P.y-item.wy)<22){',
    '      item.collected=true;',
    '      if(item.type==="health")self.php=Math.min(self.mhp,(self.php||100)+35);',
    '      if(item.type==="key")self.kys.push(item.label||"Key");',
    '      self.burst(item.wx,item.wy,item.color,10);',
    '      self.sm(item.type==="key"?"Key obtained!":item.type==="health"?"+35 HP!":item.label||"Item!",1800);',
    '    }',
    '  });',
    '',
    '  this.en.forEach(function(e){',
    '    if(!e.alive)return;',
    '    e.ifc=Math.max(0,(e.ifc||0)-dt);',
    '    e.acd=Math.max(0,(e.acd||0)-dt);',
    '    e.bt=(e.bt||0)+dt*2;',
    '    var dx=P.x-e.wx,dy=P.y-e.wy,dist=Math.hypot(dx,dy);',
    '    if(dist<e.ag){',
    '      var spd=e.speed||60;',
    '      if(dist>3){e.vx=dx/dist*spd;e.vy=dy/dist*spd;}',
    '      if(dist<(e.size||16)+P.w&&P.ifc<=0&&e.acd<=0){',
    '        self.php=(self.php||100)-(e.type==="boss"?22:12);',
    '        P.ifc=0.7; e.acd=1.1;',
    '        self.cameras.main.shake(150,0.005);',
    '        if(self.php<=0){self.php=0;P.alive=false;self.sm("You Died\\n\\nPress R",99999);}',
    '      }',
    '    } else if(e.patrol&&e.patrol.length>0){',
    '      var pt=e.patrol[e.pi%e.patrol.length];',
    '      var pd=Math.hypot(pt.x-e.wx,pt.y-e.wy);',
    '      if(pd<5){e.pi=(e.pi||0)+1;e.vx=0;e.vy=0;}',
    '      else{var ps=e.speed*0.55||33;e.vx=(pt.x-e.wx)/pd*ps;e.vy=(pt.y-e.wy)/pd*ps;}',
    '    } else{e.vx=(e.vx||0)*0.85;e.vy=(e.vy||0)*0.85;}',
    '    e.wx+=e.vx*dt; e.wy+=e.vy*dt;',
    '  });',
    '',
    '  // Current room detection',
    '  LEVEL.rooms.forEach(function(room){',
    '    if(P.x>room.x*T&&P.x<(room.x+room.w)*T&&P.y>room.y*T&&P.y<(room.y+room.h)*T){',
    '      if(self.cr!==room.id){self.cr=room.id;var el=document.getElementById("rl");if(el)el.textContent=room.label||room.id;}',
    '    }',
    '  });',
    '',
    '  this.rndr(dt);',
    '  this.updUI();',
    '  if(this.mc)this.drawMM();',
    '};',
    '',
    'G.prototype.resX=function(e){',
    '  var hw=e.w/2,hh=e.h/2;',
    '  this.sb.forEach(function(b){',
    '    if(b.p)return;',
    '    if(e.x+hw>b.x&&e.x-hw<b.x+b.w&&e.y+hh>b.y&&e.y-hh<b.y+b.h){',
    '      e.x=e.vx>0?b.x-hw:b.x+b.w+hw; e.vx=0;',
    '    }',
    '  });',
    '};',
    '',
    'G.prototype.resY=function(e){',
    '  var hw=e.w/2,hh=e.h/2;',
    '  this.sb.forEach(function(b){',
    '    if(b.p){',
    '      if(e.vy>=0&&e.y-(e.vy||0)*(1/60)+hh<=b.y+4&&e.y+hh>=b.y&&e.x+hw>b.x&&e.x-hw<b.x+b.w){',
    '        e.y=b.y-hh; e.vy=0; e.og=true;',
    '      }',
    '    } else {',
    '      if(e.x+hw>b.x&&e.x-hw<b.x+b.w&&e.y+hh>b.y&&e.y-hh<b.y+b.h){',
    '        if(e.vy>0){e.y=b.y-hh;e.vy=0;e.og=true;}',
    '        else{e.y=b.y+b.h+hh;e.vy=0;}',
    '      }',
    '    }',
    '  });',
    '};',
    '',
    'G.prototype.doAtk=function(){',
    '  var P=this.pl;',
    '  var dm={right:[1,0],left:[-1,0],up:[0,-1],down:[0,1]};',
    '  var d=dm[P.facing]||[P.dir,0];',
    '  var ax=P.x+d[0]*36, ay=P.y+d[1]*36;',
    '  this.pts.push({x:ax,y:ay,r:14,life:1,decay:4,color:0xffffff,type:"slash"});',
    '  var self=this;',
    '  this.en.forEach(function(e){',
    '    if(!e.alive||e.ifc>0)return;',
    '    if(Math.hypot(e.wx-ax,e.wy-ay)<30){',
    '      e.hp-=28; e.ifc=0.28;',
    '      e.vx+=d[0]*140; e.vy+=d[1]*140;',
    '      self.burst(e.wx,e.wy,"#ffffff",5);',
    '      if(e.hp<=0){e.alive=false;self.burst(e.wx,e.wy,e.color,16);}',
    '    }',
    '  });',
    '};',
    '',
    'G.prototype.burst=function(x,y,ch,n){',
    '  var c=Phaser.Display.Color.HexStringToColor(ch||"#ff9900").color;',
    '  for(var i=0;i<n;i++){',
    '    var a=Math.random()*6.28, v=40+Math.random()*90;',
    '    this.pts.push({x:x,y:y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-20,r:2+Math.random()*4,life:1,decay:2+Math.random()*2,color:c,type:"dot"});',
    '  }',
    '};',
    '',
    'G.prototype.rndr=function(dt){',
    '  this.gI.clear(); this.gE.clear(); this.gP.clear(); this.gX.clear();',
    '  var t=this.el||0, P=this.pl;',
    '',
    '  // Items',
    '  this.it.forEach(function(item){',
    '    if(item.collected)return;',
    '    var bob=Math.sin(t*3+item.bobOffset)*3;',
    '    var c=Phaser.Display.Color.HexStringToColor(item.color||"#ffdd44").color;',
    '    this.gI.fillStyle(c,0.9);',
    '    if(item.type==="key"){',
    '      this.gI.fillCircle(item.wx,item.wy+bob-3,6);',
    '      this.gI.fillRect(item.wx-1,item.wy+bob,10,3);',
    '    } else if(item.type==="health"){',
    '      this.gI.fillStyle(0xff4466,0.9);',
    '      this.gI.fillCircle(item.wx-3,item.wy+bob-2,5);',
    '      this.gI.fillCircle(item.wx+3,item.wy+bob-2,5);',
    '      this.gI.fillTriangle(item.wx-6,item.wy+bob,item.wx+6,item.wy+bob,item.wx,item.wy+bob+7);',
    '    } else {',
    '      this.gI.fillRect(item.wx-6,item.wy+bob-5,12,12);',
    '    }',
    '    this.gI.fillStyle(c,0.1);',
    '    this.gI.fillCircle(item.wx,item.wy+bob,14);',
    '  },this);',
    '',
    '  // Enemies',
    '  this.en.forEach(function(e){',
    '    if(!e.alive)return;',
    '    var fl=e.ifc>0&&Math.sin(e.ifc*40)>0;',
    '    var c=fl?0xffffff:Phaser.Display.Color.HexStringToColor(e.color||"#ff4466").color;',
    '    var s=e.size||16, bob=Math.sin(e.bt||0)*2;',
    '    this.gE.fillStyle(c,1);',
    '    this.gE.fillRect(e.wx-s/2,e.wy+bob-s/2,s,s);',
    '    if(e.type!=="boss"){',
    '      for(var i=0;i<3;i++){',
    '        this.gE.fillTriangle(e.wx-s/2+i*s/3,e.wy+bob-s/2,e.wx-s/2+i*s/3+s/6,e.wy+bob-s/2-8,e.wx-s/2+(i+1)*s/3,e.wy+bob-s/2);',
    '      }',
    '    } else {',
    '      this.gE.lineStyle(2,0xff4466,0.3+Math.sin(t*3)*0.3);',
    '      this.gE.strokeRect(e.wx-s/2-4,e.wy-s/2-4,s+8,s+8);',
    '    }',
    '    this.gE.fillStyle(0xffffff,1);',
    '    this.gE.fillRect(e.wx-s/2+3,e.wy+bob-s/2+4,4,4);',
    '    this.gE.fillRect(e.wx+2,e.wy+bob-s/2+4,4,4);',
    '    this.gE.fillStyle(0xcc0000,1);',
    '    this.gE.fillRect(e.wx-s/2+4,e.wy+bob-s/2+5,2,2);',
    '    this.gE.fillRect(e.wx+3,e.wy+bob-s/2+5,2,2);',
    '    var pct=e.hp/e.mhp;',
    '    this.gE.fillStyle(0x222222,0.8);',
    '    this.gE.fillRect(e.wx-s/2,e.wy+bob-s/2-8,s,4);',
    '    this.gE.fillStyle(pct>0.5?0x44ff88:pct>0.25?0xffaa00:0xff4444,1);',
    '    this.gE.fillRect(e.wx-s/2,e.wy+bob-s/2-8,s*pct,4);',
    '  },this);',
    '',
    '  // Player',
    '  var fl=P.ifc>0&&Math.sin(P.ifc*40)>0;',
    '  var pc=fl?0xffffff:P.color;',
    '  var ls=P.og||ITD?Math.sin(P.at||0)*5:0;',
    '  this.gP.fillStyle(0x000000,0.2);',
    '  this.gP.fillEllipse(P.x,P.y+P.h/2+3,P.w,5);',
    '  this.gP.fillStyle(Phaser.Display.Color.HexStringToColor(LEVEL.player.color||"#0066aa").color,1);',
    '  this.gP.fillRect(P.x-P.w/2+2,P.y+P.h/2,P.w/2-2,7+ls);',
    '  this.gP.fillRect(P.x+1,P.y+P.h/2,P.w/2-2,7-ls);',
    '  this.gP.fillStyle(pc,1);',
    '  this.gP.fillRect(P.x-P.w/2,P.y-P.h/2,P.w,P.h);',
    '  this.gP.fillRect(P.x-P.w/2+1,P.y-P.h/2-10,P.w-2,12);',
    '  var ex=P.dir>0||P.facing==="right"?P.x+2:P.x-P.w/2+1;',
    '  this.gP.fillStyle(0xffffff,1);',
    '  this.gP.fillRect(ex,P.y-P.h/2-7,5,5);',
    '  this.gP.fillStyle(0x000000,1);',
    '  this.gP.fillRect(ex+1,P.y-P.h/2-6,2,2);',
    '',
    '  if((this.acd||0)>0.18){',
    '    var dm2={right:[1,0],left:[-1,0],up:[0,-1],down:[0,1]};',
    '    var d2=dm2[P.facing]||[P.dir,0];',
    '    this.gP.lineStyle(3,0xffffff,(this.acd||0)/0.32);',
    '    this.gP.beginPath();',
    '    this.gP.arc(P.x,P.y,30,Math.atan2(d2[1],d2[0])-0.65,Math.atan2(d2[1],d2[0])+0.65);',
    '    this.gP.strokePath();',
    '  }',
    '',
    '  // Particles',
    '  this.pts=this.pts.filter(function(p){return p.life>0.01;});',
    '  this.pts.forEach(function(p){',
    '    p.life-=(p.decay||2)*dt;',
    '    if(p.vx!==undefined){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=90*dt;p.vx*=0.95;}',
    '    this.gX.fillStyle(p.color,Math.max(0,p.life));',
    '    if(p.type==="slash"){',
    '      this.gX.fillRect(p.x-p.r,p.y-2,p.r*2,4);',
    '      this.gX.fillRect(p.x-2,p.y-p.r,4,p.r*2);',
    '    } else {',
    '      this.gX.fillCircle(p.x,p.y,Math.max(0.5,p.r*p.life));',
    '    }',
    '  },this);',
    '};',
    '',
    'G.prototype.updUI=function(){',
    '  var hv=document.getElementById("hv"),hf=document.getElementById("hf"),kl=document.getElementById("kl");',
    '  if(hv)hv.textContent=String(Math.max(0,Math.round(this.php||0)));',
    '  if(hf){',
    '    var pct=Math.max(0,(this.php||0)/this.mhp);',
    '    hf.style.width=(pct*100)+"%";',
    '    hf.style.background=pct>0.5?"#44ff88":pct>0.25?"#ffaa00":"#ff4444";',
    '  }',
    '  if(kl&&this.kys&&this.kys.length>0)kl.textContent="Keys: "+this.kys.join(", ");',
    '};',
    '',
    'G.prototype.drawMM=function(){',
    '  var ctx=this.mc,cw=140,ch=100;',
    '  var bounds=worldBounds();',
    '  var sx=cw/bounds.w, sy=ch/bounds.h;',
    '  ctx.clearRect(0,0,cw,ch);',
    '  var self=this;',
    '  LEVEL.rooms.forEach(function(r){',
    '    ctx.fillStyle=r.id===self.cr?"#3a5a3a":"#2a2a3a";',
    '    ctx.fillRect(r.x*T*sx,r.y*T*sy,r.w*T*sx,r.h*T*sy);',
    '    ctx.strokeStyle="#555"; ctx.lineWidth=0.5;',
    '    ctx.strokeRect(r.x*T*sx,r.y*T*sy,r.w*T*sx,r.h*T*sy);',
    '    self.en.filter(function(e){return e.room===r.id&&e.alive;}).forEach(function(e){',
    '      ctx.fillStyle="#ff4466";',
    '      ctx.fillRect(e.wx*sx-1.5,e.wy*sy-1.5,3,3);',
    '    });',
    '  });',
    '  ctx.fillStyle="#00d4ff";',
    '  ctx.beginPath();',
    '  ctx.arc((this.pl.x||0)*sx,(this.pl.y||0)*sy,3,0,6.28);',
    '  ctx.fill();',
    '};',
    '',
    'G.prototype.sm=function(text,dur){',
    '  var el=document.getElementById("msg");',
    '  if(!el)return;',
    '  el.textContent=text; el.style.opacity="1";',
    '  if(this._mt)clearTimeout(this._mt);',
    '  if(dur<99000)this._mt=setTimeout(function(){el.style.opacity="0";},dur);',
    '};',
    '',
    'new Phaser.Game({',
    '  type:Phaser.AUTO,',
    '  width:window.innerWidth,',
    '  height:window.innerHeight,',
    '  backgroundColor:LEVEL.palette.background||"#0a0a12",',
    '  scene:G,',
    '  parent:document.body,',
    '  scale:{mode:Phaser.Scale.RESIZE,autoCenter:Phaser.Scale.CENTER_BOTH}',
    '});',
  ]

  const gameScript = lines.join('\n')

  return [
    '<!DOCTYPE html><html><head>',
    '<style>', css, '</style>',
    '</head><body>',
    '<div id="ui">',
    '  <div>HP: <span id="hv">100</span></div>',
    '  <div id="hb"><div id="hf" style="width:100%"></div></div>',
    '  <div id="rl"></div>',
    '  <div id="kl"></div>',
    '</div>',
    '<div id="as">AI art active</div>',
    '<div id="dbg"></div>',
    '<div id="msg"></div>',
    '<canvas id="mm" width="140" height="100"></canvas>',
    '<div id="ctrl">WASD / Arrows move | Z attack | R restart</div>',
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/phaser/3.60.0/phaser.min.js"></' + 'script>',
    '<script>', gameScript, '</' + 'script>',
    '</body></html>',
  ].join('\n')
}


// ── STAGE ROW ─────────────────────────────────────────────────
function StageRow({ label, sub, status, url }: { label:string; sub:string; status:StageStatus; url?:string }) {
  const dotBg = status==='done'?'#1D9E75':status==='active'?'#7F77DD':status==='error'?'#E24B4A':'#ccc'
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 10px', borderRadius:8, border:'0.5px solid #eee', background:'#fff', marginBottom:5 }}>
      <div style={{ width:8, height:8, borderRadius:'50%', flexShrink:0, background:dotBg }} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:500, color:'#111' }}>{label}</div>
        <div style={{ fontSize:10, color:'#888', marginTop:1 }}>{sub}</div>
      </div>
      {status==='done' && !url && <span style={{ color:'#1D9E75', fontSize:12 }}>✓</span>}
      {status==='active' && <span style={{ color:'#7F77DD', fontSize:10 }}>⟳</span>}
      {status==='done' && url && <img src={url} alt="" style={{ width:34, height:34, borderRadius:4, objectFit:'cover', border:'0.5px solid #eee', flexShrink:0 }} />}
    </div>
  )
}

// ── ITERATION MESSAGE ─────────────────────────────────────────
function IterMsg({ text, isUser }: { text:string; isUser:boolean }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:3, alignItems:isUser?'flex-end':'flex-start' }}>
      {!isUser && <div style={{ fontSize:9, letterSpacing:'0.12em', textTransform:'uppercase', color:'#aaa', fontFamily:'monospace' }}>Gameforge</div>}
      <div style={{ fontSize:12, lineHeight:1.7, color:'#222', background:isUser?'#f5f5f5':'#fff', maxWidth:'92%', padding:'8px 11px', borderRadius:8, border:'0.5px solid #eee', whiteSpace:'pre-wrap', wordBreak:'break-word' }}>
        {text}
      </div>
    </div>
  )
}

// ── MAIN COMPONENT ────────────────────────────────────────────
export default function Builder() {
  const [phase,      setPhase]      = useState<'splash'|'questions'|'building'|'done'>('splash')
  const [stepIdx,    setStepIdx]    = useState(0)
  const [buildMsgs,  setBuildMsgs]  = useState<Array<{role:string;content:string;type?:string}>>([])
  const [buildInput, setBuildInput] = useState('')
  const [stages,     setStages]     = useState<Stages>(INIT_STAGES)
  const [buildCount, setBuildCount] = useState(0)
  const [levelData,  setLevelData]  = useState<any>(null)
  const [assets,     setAssets]     = useState<Record<string,string>>({})
  const [gameHTML,   setGameHTML]   = useState<string|null>(null)
  const [answers,    setAnswers]    = useState<Record<string,string>>({})
  const [iterMsgs,   setIterMsgs]   = useState<Array<{text:string;isUser:boolean}>>([])
  const [iterInput,  setIterInput]  = useState('')
  const [iterating,  setIterating]  = useState(false)
  const [iterStage,  setIterStage]  = useState('')
  const [totalSpend, setTotalSpend] = useState(0)

  const buildEndRef   = useRef<HTMLDivElement>(null)
  const iterEndRef    = useRef<HTMLDivElement>(null)
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

  const updStage = (key: keyof Stages, patch: any) =>
    setStages(s => ({ ...s, [key]: { ...s[key], ...patch } }))

  // ── FULL BUILD ──────────────────────────────────────────────
  const build = useCallback(async (allAnswers: Record<string,string>) => {
    setPhase('building')
    setStages(INIT_STAGES)
    setAssets({})
    setIterMsgs([])
    setBuildCount(c => c+1)

    // Claude — level design
    updStage('claude', { status:'active', detail:'Designing rooms, enemies, items...' })
    const prompt =
      'Perspective: ' + allAnswers.perspective + '\n' +
      'Theme: '       + allAnswers.theme       + '\n' +
      'Layout: '      + allAnswers.layout      + '\n' +
      'Characters: '  + allAnswers.characters

    let level: any = null
    try {
      const res  = await fetch('/api/generate-level', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ prompt }) })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      level = data.levelData
      setLevelData(level)
      const ne = level.rooms?.reduce((a:number,r:any) => a+(r.enemies?.length||0), 0) || 0
      const ni = level.rooms?.reduce((a:number,r:any) => a+(r.items?.length||0), 0) || 0
      updStage('claude', { status:'done', detail: level.rooms?.length + ' rooms, ' + ne + ' enemies, ' + ni + ' items' })
    } catch(e: any) {
      updStage('claude', { status:'error', detail: e.message })
      addBuildMsg('assistant', 'Level design failed: ' + e.message, 'error')
      return
    }

    // fal.ai — stream 3 assets
    updStage('background', { status:'active' })
    updStage('tileset',    { status:'active' })
    updStage('sprites',    { status:'active' })

    const styleLabel = ART_STYLES.find(s => s.id===allAnswers.style)?.label || allAnswers.style || 'pixel art'
    const chars      = allAnswers.characters || ''
    const collected: Record<string,string> = {}

    try {
      const res = await fetch('/api/generate-assets', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          theme:             allAnswers.theme,
          style:             styleLabel,
          perspective:       level.meta?.perspective || allAnswers.perspective,
          enemyTypes:        [chars.split(/[,\.]/)[1]?.trim() || 'enemy'],
          playerDescription: chars.split(/[,\.]/)[0]?.trim() || 'hero',
        }),
      })
      if (!res.body) throw new Error('No stream')
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
              setAssets(prev => ({ ...prev, [msg.key]: msg.url }))
              const sk = msg.key==='backgroundUrl'?'background':msg.key==='tilesetUrl'?'tileset':'sprites'
              updStage(sk as keyof Stages, { status:'done', url: msg.url })
              setTotalSpend(s => s+0.003)
            }
          } catch {}
        }
      }
    } catch(e: any) {
      addBuildMsg('assistant', 'Art generation failed: ' + e.message, 'hint')
      ;(['background','tileset','sprites'] as (keyof Stages)[]).forEach(k => updStage(k, { status:'error' }))
    }

    // Launch Phaser
    updStage('phaser', { status:'active', detail:'Loading...' })
    await new Promise(r => setTimeout(r, 300))
    const html = buildPhaserHTML(level, collected)
    setGameHTML(html)
    updStage('phaser', { status:'done', detail:'Running' })
    setPhase('done')

    const hasArt = Object.keys(collected).length === 3
    const ne = level.rooms?.reduce((a:number,r:any) => a+(r.enemies?.length||0), 0) || 0
    setIterMsgs([{
      text: '🎮 Game built!\n\n' +
            level.rooms?.length + ' rooms, ' + ne + ' enemies\n' +
            (hasArt ? '✓ All AI assets loaded' : '⚠ Art generation had issues') +
            '\n\nTell me what to change — gameplay, enemies, world, or art style.',
      isUser: false
    }])
    setTimeout(() => iterInputRef.current?.focus(), 100)
  }, [])

  // ── ITERATE ─────────────────────────────────────────────────
  const iterate = async () => {
    if (!iterInput.trim() || iterating) return
    const request = iterInput.trim()
    setIterInput('')
    setIterMsgs(m => [...m, { text:request, isUser:true }])
    setIterating(true)

    try {
      setIterStage('Claude analyzing change...')
      const planRes = await fetch('/api/iterate', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          changeRequest: request,
          currentLevel:  levelRef.current,
          currentStyle:  answersRef.current.style,
          currentTheme:  answersRef.current.theme,
        }),
      })
      const { plan, error: planErr } = await planRes.json()
      if (planErr) throw new Error(planErr)

      const ct = plan.changeType as string
      let newLevel = levelRef.current ? JSON.parse(JSON.stringify(levelRef.current)) : null

      // Apply logic patches
      if ((ct==='logic'||ct==='full') && newLevel) {
        const pp = plan.playerPatch || {}
        if (pp.speed) newLevel.player.speed = pp.speed
        if (pp.hp)    newLevel.player.hp    = pp.hp
        if (pp.color) newLevel.player.color = pp.color
        if (pp.size)  newLevel.player.size  = pp.size
        ;(plan.enemyPatches||[]).forEach((ep: any) => {
          const room = newLevel.rooms?.find((r: any) => r.id===ep.roomId)
          if (room?.enemies?.[ep.index]) {
            const e = room.enemies[ep.index]
            if (ep.hp)    e.hp    = ep.hp
            if (ep.speed) e.speed = ep.speed
            if (ep.color) e.color = ep.color
          }
        })
        setLevelData(newLevel)
      }

      let newAssets = { ...assetsRef.current }

      // Regenerate art if needed
      if (ct==='art'||ct==='full'||ct==='asset') {
        setIterStage('fal.ai regenerating art...')
        const newTheme = plan.newTheme || answersRef.current.theme
        const newStyle = ART_STYLES.find(s=>s.id===(plan.newStyle||answersRef.current.style))?.label
                         || plan.newStyle || answersRef.current.style || 'pixel art'
        const chars    = answersRef.current.characters || ''

        const genRes = await fetch('/api/generate-assets', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            theme:             newTheme,
            style:             newStyle,
            perspective:       newLevel?.meta?.perspective,
            enemyTypes:        [chars.split(/[,\.]/)[1]?.trim() || 'enemy'],
            playerDescription: chars.split(/[,\.]/)[0]?.trim() || 'hero',
          }),
        })

        if (genRes.body) {
          const reader = genRes.body.getReader()
          const dec    = new TextDecoder()
          let buf = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buf += dec.decode(value, { stream:true })
            const lines = buf.split('\n')
            buf = lines.pop() || ''
            for (const line of lines) {
              try {
                const msg = JSON.parse(line)
                if (msg.type==='asset') {
                  if (ct==='asset' && plan.assetKey && msg.key!==plan.assetKey) continue
                  newAssets[msg.key] = msg.url
                  setAssets(prev => ({ ...prev, [msg.key]: msg.url }))
                  setTotalSpend(s => s+0.003)
                }
              } catch {}
            }
          }
        }

        if (plan.newTheme) setAnswers(a => ({ ...a, theme: plan.newTheme }))
        if (plan.newStyle) setAnswers(a => ({ ...a, style: plan.newStyle }))
      }

      setIterStage('Rebuilding game...')
      const html = buildPhaserHTML(newLevel || levelRef.current, newAssets)
      setGameHTML(html)

      const costMap: Record<string,string> = { logic:'free', art:'~$0.009', asset:'~$0.003', full:'~$0.012' }
      setIterMsgs(m => [...m, { text: '✓ ' + plan.summary + '\n\nChange: ' + ct + ' | Cost: ' + (costMap[ct]||'free'), isUser:false }])

    } catch(e: any) {
      setIterMsgs(m => [...m, { text: '⚠️ ' + e.message, isUser:false }])
    }

    setIterating(false)
    setIterStage('')
    iterInputRef.current?.focus()
  }

  // ── BUILD QUESTIONS ──────────────────────────────────────────
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
      setTimeout(() => buildInputRef.current?.focus(), 50)
    }
  }

  const pickStyle = (id: string) => {
    const label = ART_STYLES.find(s => s.id===id)?.label || id
    addBuildMsg('user', label)
    const newAnswers = { ...answersRef.current, style: id }
    setAnswers(newAnswers)
    const nextIdx = stepIdx+1
    setStepIdx(nextIdx)
    addBuildMsg('assistant', BUILD_STEPS[nextIdx].q, 'question')
    if (BUILD_STEPS[nextIdx].hint) addBuildMsg('assistant', BUILD_STEPS[nextIdx].hint!, 'hint')
    setTimeout(() => buildInputRef.current?.focus(), 50)
  }

  const startOver = () => {
    setPhase('splash'); setStepIdx(0); setBuildMsgs([]); setBuildInput('')
    setLevelData(null); setAssets({}); setGameHTML(null); setAnswers({})
    setStages(INIT_STAGES); setIterMsgs([]); setIterInput(''); setIterating(false)
  }

  const isDone       = phase==='done'
  const isBuildPhase = phase==='building'
  const assetsReady  = Object.keys(assets).length
  const progress     = Math.min(1, stepIdx/BUILD_STEPS.length)

  return (
    <div style={{ fontFamily:"Georgia,serif", background:'#f9f9f7', height:'100vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>

      {/* TOP BAR */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e8e8e8', padding:'0 16px', height:44, display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
        <span style={{ fontWeight:700, fontSize:13, letterSpacing:'0.18em', textTransform:'uppercase', color:'#111', flexShrink:0 }}>
          GameForge
        </span>
        <span style={{ fontSize:10, fontFamily:'monospace', color:'#999', background:'#f5f5f5', padding:'2px 8px', borderRadius:20, border:'1px solid #eee', flexShrink:0 }}>
          Claude + fal.ai + Phaser.js
        </span>
        {!isDone && (
          <div style={{ flex:1, maxWidth:120, height:2, background:'#eee', borderRadius:1 }}>
            <div style={{ height:'100%', background:'#111', borderRadius:1, transition:'width 0.5s', width: (progress*100)+'%' }} />
          </div>
        )}
        {isDone && <span style={{ flex:1, fontSize:10, fontFamily:'monospace', color:'#aaa', textAlign:'right' }}>~${totalSpend.toFixed(3)} spent</span>}
        {isDone && (
          <button onClick={startOver} style={{ background:'#f5f5f5', border:'1px solid #ddd', color:'#555', borderRadius:4, padding:'4px 12px', cursor:'pointer', fontFamily:'inherit', fontSize:11 }}>
            New Level
          </button>
        )}
      </div>

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* LEFT PANEL */}
        <div style={{ width:300, flexShrink:0, borderRight:'1px solid #e8e8e8', background:'#fff', display:'flex', flexDirection:'column', overflow:'hidden' }}>

          {!isDone ? (
            <>
              {/* Step dots */}
              {phase!=='splash' && (
                <div style={{ display:'flex', gap:5, padding:'10px 14px 8px', borderBottom:'1px solid #f0f0f0', flexShrink:0 }}>
                  {BUILD_STEPS.map((s,i) => {
                    const done=i<stepIdx, active=i===stepIdx&&phase==='questions'
                    return (
                      <div key={s.id} style={{ width:24, height:24, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontFamily:'monospace', fontWeight:700, flexShrink:0, background:done?'#111':active?'#f0f0f0':'transparent', color:done?'#fff':active?'#111':'#ccc', border:'1px solid '+(done?'#111':active?'#bbb':'#eee') }}>
                        {done?'✓':i+1}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Messages feed */}
              <div style={{ flex:1, overflowY:'auto', padding:14, display:'flex', flexDirection:'column', gap:8 }}>
                {phase==='splash' ? (
                  <div style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'center', paddingBottom:20 }}>
                    <div style={{ fontSize:42, fontWeight:700, lineHeight:0.9, letterSpacing:'-0.03em', color:'#111', marginBottom:14 }}>
                      Game<br/>Forge
                    </div>
                    <p style={{ fontSize:12, color:'#999', lineHeight:1.8, marginBottom:12 }}>
                      Claude designs the level.<br/>
                      fal.ai generates all the art.<br/>
                      Phaser runs the game.<br/>
                      Iterate until it is perfect.
                    </p>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:20 }}>
                      {['🧠 Claude logic','🎨 fal.ai art','⚙️ Phaser engine','🔄 Iterate freely'].map(f=>(
                        <div key={f} style={{ fontSize:11, color:'#bbb', fontFamily:'monospace' }}>{f}</div>
                      ))}
                    </div>
                    <button onClick={() => { setPhase('questions'); addBuildMsg('assistant',BUILD_STEPS[0].q,'question'); setTimeout(()=>buildInputRef.current?.focus(),100) }}
                      style={{ background:'#111', color:'#fff', border:'none', borderRadius:4, padding:'10px 22px', fontSize:13, fontFamily:'Georgia,serif', fontWeight:700, cursor:'pointer', alignSelf:'flex-start' }}>
                      Start Building →
                    </button>
                  </div>
                ) : buildMsgs.map((m,i) => (
                  <div key={i} style={{ display:'flex', flexDirection:'column', gap:3, alignItems:m.role==='user'?'flex-end':'flex-start' }}>
                    {m.role==='assistant' && m.type!=='hint' && (
                      <div style={{ fontSize:9, letterSpacing:'0.14em', textTransform:'uppercase', color:'#ccc', fontFamily:'monospace' }}>Gameforge</div>
                    )}
                    <div style={{ fontSize:12, lineHeight:1.75, color:'#222', background:m.role==='user'?'#f5f5f5':'#fff', maxWidth:'92%', padding:'8px 11px', borderRadius:8, border:'1px solid #efefef', whiteSpace:'pre-wrap', wordBreak:'break-word', ...(m.type==='hint'?{background:'transparent',border:'none',color:'#bbb',fontStyle:'italic'}:{}), ...(m.type==='question'?{borderLeft:'2px solid #6366f1'}:{}), ...(m.type==='error'?{borderLeft:'2px solid #ef4444'}:{}) }}>
                      {m.content}
                    </div>
                  </div>
                ))}

                {/* Style picker */}
                {phase==='questions' && BUILD_STEPS[stepIdx]?.isStylePicker && (
                  <div style={{ display:'flex', flexDirection:'column', gap:6, margin:'4px 0' }}>
                    {ART_STYLES.map(style => (
                      <button key={style.id} onClick={() => pickStyle(style.id)}
                        style={{ background:'#fafafa', border:'1px solid #eee', borderRadius:8, padding:'10px 12px', cursor:'pointer', textAlign:'left', fontFamily:'inherit' }}>
                        <div style={{ fontSize:12, fontWeight:700, color:'#111' }}>{style.label}</div>
                        <div style={{ fontSize:10, color:'#888', marginTop:2 }}>{style.desc}</div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Build progress stages */}
                {isBuildPhase && (
                  <div style={{ marginTop:4 }}>
                    <StageRow label="Claude — level design"  sub={stages.claude.detail||'waiting'}     status={stages.claude.status} />
                    <StageRow label="fal.ai — background"    sub="512x512 flux/schnell"                status={stages.background.status} url={stages.background.url} />
                    <StageRow label="fal.ai — tileset"       sub="floor and wall tiles"               status={stages.tileset.status}    url={stages.tileset.url} />
                    <StageRow label="fal.ai — sprites"       sub="player, enemies, boss"              status={stages.sprites.status}    url={stages.sprites.url} />
                    <StageRow label="Phaser — launch"        sub={stages.phaser.detail||'waiting'}    status={stages.phaser.status} />
                    <div style={{ fontSize:10, color:'#888', fontFamily:'monospace', marginTop:6, padding:'6px 10px', background:'#f9f9f9', borderRadius:6 }}>
                      {assetsReady}/3 assets ready — ~${(0.003*assetsReady).toFixed(3)} so far
                    </div>
                  </div>
                )}

                <div ref={buildEndRef} />
              </div>

              {/* Build input */}
              {phase==='questions' && !BUILD_STEPS[stepIdx]?.isStylePicker && (
                <div style={{ borderTop:'1px solid #f0f0f0', padding:'10px 12px', flexShrink:0, background:'#fff' }}>
                  <div style={{ display:'flex', gap:7, alignItems:'flex-end' }}>
                    <textarea ref={buildInputRef}
                      style={{ flex:1, background:'#fafafa', border:'1px solid #eee', borderBottom:'2px solid '+(STEP_COLORS[stepIdx]||'#6366f1'), borderRadius:'4px 4px 0 0', color:'#111', fontFamily:'Georgia,serif', fontSize:12, padding:'7px 9px', resize:'none', outline:'none', lineHeight:1.5 }}
                      value={buildInput} rows={2}
                      onChange={e => setBuildInput(e.target.value)}
                      onKeyDown={e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendBuild();} }}
                      placeholder="Your answer..."
                    />
                    <button onClick={sendBuild}
                      style={{ background:STEP_COLORS[stepIdx]||'#6366f1', border:'none', color:'#fff', fontSize:16, borderRadius:4, padding:'8px 14px', cursor:'pointer', flexShrink:0, alignSelf:'flex-end', fontFamily:'Georgia,serif' }}>
                      →
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* ITERATION CONSOLE */
            <>
              <div style={{ padding:'10px 14px', borderBottom:'1px solid #f0f0f0', flexShrink:0 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#111' }}>Iteration Console</div>
                <div style={{ fontSize:9, color:'#aaa', fontFamily:'monospace', marginTop:2 }}>
                  Describe any change — Claude decides what to regenerate
                </div>
              </div>

              <div style={{ flex:1, overflowY:'auto', padding:14, display:'flex', flexDirection:'column', gap:8 }}>
                {iterMsgs.map((m,i) => <IterMsg key={i} text={m.text} isUser={m.isUser} />)}
                {iterating && (
                  <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                    <div style={{ fontSize:9, letterSpacing:'0.12em', textTransform:'uppercase', color:'#aaa', fontFamily:'monospace' }}>Gameforge</div>
                    <div style={{ fontSize:12, color:'#888', padding:'8px 11px', background:'#fff', borderRadius:8, border:'1px solid #eee' }}>
                      ⟳ {iterStage||'Working...'}
                    </div>
                  </div>
                )}
                <div ref={iterEndRef} />
              </div>

              <div style={{ borderTop:'1px solid #f0f0f0', padding:'10px 12px', flexShrink:0, background:'#fff' }}>
                <div style={{ fontSize:10, color:'#aaa', fontFamily:'monospace', marginBottom:6 }}>
                  Logic changes: free &nbsp;·&nbsp; Art changes: ~$0.009
                </div>
                <div style={{ display:'flex', gap:7, alignItems:'flex-end' }}>
                  <textarea ref={iterInputRef}
                    style={{ flex:1, background:'#fafafa', border:'1px solid #eee', borderBottom:'2px solid #6366f1', borderRadius:'4px 4px 0 0', color:'#111', fontFamily:'Georgia,serif', fontSize:12, padding:'7px 9px', resize:'none', outline:'none', lineHeight:1.5 }}
                    value={iterInput} rows={2} disabled={iterating}
                    onChange={e => setIterInput(e.target.value)}
                    onKeyDown={e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();iterate();} }}
                    placeholder='e.g. "make the player faster" or "change to neon cyberpunk"'
                  />
                  <button onClick={iterate} disabled={iterating}
                    style={{ background:'#6366f1', border:'none', color:'#fff', fontSize:16, borderRadius:4, padding:'8px 14px', cursor:'pointer', flexShrink:0, alignSelf:'flex-end', fontFamily:'Georgia,serif' }}>
                    →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* RIGHT PANEL — PREVIEW */}
        <div style={{ flex:1, background:'#f5f5f3', display:'flex', flexDirection:'column', padding:'12px 16px', overflow:'hidden', gap:8 }}>
          <div style={{ fontSize:9, letterSpacing:'0.16em', textTransform:'uppercase', color:'#bbb', fontFamily:'monospace' }}>
            {gameHTML ? 'Live Game — Click to focus' : 'Game Preview'}
          </div>

          {gameHTML ? (
            <iframe
              key={gameHTML.length + JSON.stringify(Object.keys(assets))}
              srcDoc={gameHTML}
              style={{ flex:1, border:'none', borderRadius:8, background:'#000', display:'block', minHeight:0 }}
              sandbox="allow-scripts"
              title="game"
            />
          ) : (
            <div style={{ flex:1, border:'1px dashed #ddd', borderRadius:8, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:0 }}>
              {phase==='splash' ? (
                <div style={{ textAlign:'center', color:'#bbb' }}>
                  <div style={{ fontSize:40, marginBottom:16 }}>🎮</div>
                  <div style={{ fontSize:11, fontFamily:'monospace', lineHeight:2.2 }}>
                    fal.ai background + tileset + sprites<br/>
                    Phaser loads and runs everything<br/>
                    Claude drives all the logic
                  </div>
                </div>
              ) : (
                <div style={{ textAlign:'center', color:'#bbb' }}>
                  <div style={{ fontSize:32, marginBottom:12 }}>⏳</div>
                  <div style={{ fontSize:11, fontFamily:'monospace' }}>
                    {isBuildPhase ? (assetsReady+'/3 assets ready') : 'Answer the questions'}
                  </div>
                </div>
              )}
            </div>
          )}

          {gameHTML && (
            <div style={{ fontSize:10, color:'#bbb', fontFamily:'monospace' }}>
              WASD / Arrows = move &nbsp; Z = attack &nbsp; R = restart
            </div>
          )}

          {/* Asset thumbnails */}
          {Object.keys(assets).length > 0 && (
            <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:8, padding:'10px 12px', flexShrink:0 }}>
              <div style={{ fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:'#bbb', marginBottom:8, fontFamily:'monospace' }}>
                fal.ai generated assets
              </div>
              <div style={{ display:'flex', gap:8 }}>
                {[{key:'backgroundUrl',label:'BG'},{key:'tilesetUrl',label:'Tiles'},{key:'spriteSheetUrl',label:'Sprites'}].map(({key,label}) =>
                  assets[key] ? (
                    <div key={key} style={{ textAlign:'center' }}>
                      <img src={assets[key]} alt={label} style={{ width:60, height:60, objectFit:'cover', borderRadius:4, border:'1px solid #eee', display:'block' }} />
                      <div style={{ fontSize:9, color:'#aaa', marginTop:3, fontFamily:'monospace' }}>{label}</div>
                    </div>
                  ) : (
                    <div key={key} style={{ width:60, height:60, borderRadius:4, border:'1px solid #eee', background:'#f9f9f9', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <div style={{ fontSize:9, color:'#ccc', textAlign:'center', fontFamily:'monospace' }}>{label}<br/>⟳</div>
                    </div>
                  )
                )}
              </div>
              <div style={{ fontSize:9, color:'#aaa', fontFamily:'monospace', marginTop:6 }}>
                flux/schnell · 512x512 · {Object.keys(assets).length}/3 · ~${(0.003*Object.keys(assets).length).toFixed(3)}
              </div>
            </div>
          )}

          {/* Level stats */}
          {levelData && (
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', flexShrink:0 }}>
              {[
                { l:'Rooms',   v: levelData.rooms?.length },
                { l:'Enemies', v: levelData.rooms?.reduce((a:number,r:any)=>a+(r.enemies?.length||0),0) },
                { l:'Items',   v: levelData.rooms?.reduce((a:number,r:any)=>a+(r.items?.length||0),0) },
                { l:'Type',    v: levelData.meta?.perspective },
              ].map(({l,v}) => (
                <div key={l} style={{ background:'#fff', border:'1px solid #eee', borderRadius:6, padding:'5px 10px', textAlign:'center', minWidth:52 }}>
                  <div style={{ fontSize:9, color:'#aaa' }}>{l}</div>
                  <div style={{ fontSize:11, fontWeight:700, color:'#111' }}>{v}</div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
