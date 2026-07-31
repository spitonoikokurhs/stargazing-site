// The total-solar-eclipse farewell scene — the EXACT standalone HTML tuned in
// a prior session (OnePlus 11 portrait reference), embedded verbatim so its
// visuals/animation/timing stay byte-for-byte final. It is rendered inside an
// <iframe srcDoc> (see FarewellEclipse.tsx) so its ~250 lines of unscoped
// inline CSS (.stage/.reward/.big/.small/.hint/.moon/…) can never collide with
// the site's own farewell CSS in app/live/styles.css — a separate document is
// the only guarantee of zero cascade bleed.
//
// buildEclipseSceneHtml(footerHtml) returns the full document with the caller's
// already-escaped venue/next-session footer injected at the {{FAREWELL_FOOTER}}
// marker. The footer HTML MUST be escaped by the caller (see escapeHtml /
// buildEclipseFooterHtml in FarewellEclipse.tsx) before it reaches here — this
// module does no escaping of its own; it only splices a trusted-by-contract
// string into the marker.
const ECLIPSE_SCENE_TEMPLATE = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Total eclipse over the Asklepieion — Kos</title>
<style>
  html,body{margin:0;height:100%;background:#05060c;overflow:hidden;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    /* kill the mobile blue tap-flash + text-selection highlight when tapping
       the sun/stage — this is a tap-driven scene, taps should feel like taps,
       not select the background */
    -webkit-tap-highlight-color:transparent;
    -webkit-user-select:none;user-select:none;}
  /* bright Mediterranean midday sky — it should read clearly as DAY */
  .stage{position:relative;width:100%;height:100vh;overflow:hidden;cursor:pointer;
    background:linear-gradient(to bottom, #3f93e4 0%, #66aeef 38%, #9ccff4 70%, #d4ebfb 100%);}

  /* nightfall overlay — darkens the whole sky only in the final approach to totality */
  .nightfall{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .9s ease;
    background:linear-gradient(to bottom, #04050a 0%, #060814 60%, #0a0e1e 100%);}

  /* 360° sunset glow ringing the horizon at totality */
  .horizonglow{position:absolute;left:0;right:0;bottom:0;height:40vh;pointer-events:none;opacity:0;
    transition:opacity 1.1s ease;z-index:2;
    background:linear-gradient(to top,
      rgba(255,150,90,.6) 0%, rgba(255,120,110,.32) 22%, rgba(150,90,140,.15) 46%, transparent 74%);}

  /* stars + planets, revealed only at/near totality */
  .skyfaint{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 1.2s ease;z-index:1;}
  .fstar{position:absolute;border-radius:50%;background:#eef3ff;}
  .bgstar{position:absolute;width:var(--s);height:var(--s);margin-left:calc(var(--s)/-2);margin-top:calc(var(--s)/-2);
    background:radial-gradient(circle,#fff 0 .8px,var(--sc,#fff) 1.6px,transparent 3.4px);
    animation:twinkle var(--td,3s) ease-in-out infinite;animation-delay:var(--tl,0s);}
  .bgstar::before{content:'';position:absolute;left:0;right:0;top:50%;height:1px;margin-top:-.5px;opacity:.8;
    background:linear-gradient(to right,transparent,var(--sc,#fff),transparent);}
  .bgstar::after{content:'';position:absolute;top:0;bottom:0;left:50%;width:1px;margin-left:-.5px;opacity:.8;
    background:linear-gradient(to bottom,transparent,var(--sc,#fff),transparent);}
  @keyframes twinkle{0%,100%{opacity:.5}50%{opacity:1}}
  .planet{position:absolute;border-radius:50%;}
  .planet .ring{position:absolute;left:50%;top:50%;border:1px solid rgba(232,217,168,.85);
    border-radius:50%;transform:translate(-50%,-50%) rotate(-18deg);}
  .planet .lbl{position:absolute;left:50%;top:150%;transform:translateX(-50%);white-space:nowrap;
    font-size:9px;letter-spacing:.5px;color:rgba(210,220,240,.5);}

  /* —— seagulls (always in front of the eclipse) —— */
  .gulls{position:absolute;inset:0;pointer-events:none;z-index:8;}
  .gull{position:absolute;top:0;left:0;opacity:0;transition:opacity 1.6s ease;will-change:transform;}
  .gull .flap{display:block;transform-origin:50% 42%;animation:flap var(--fl,.5s) ease-in-out infinite;}
  .gull svg{display:block;overflow:visible;}
  @keyframes flap{0%,100%{transform:scaleY(.6)}50%{transform:scaleY(1)}}

  /* —— the eclipse, anchored where the sun sits —— */
  .eclipse{position:absolute;left:50%;top:25vh;width:0;height:0;z-index:6;}
  .disc{position:absolute;left:0;top:0;border-radius:50%;}
  .corona{position:absolute;left:0;top:0;width:150px;height:150px;margin:-75px 0 0 -75px;
    opacity:0;transition:opacity 1.1s ease;pointer-events:none;}
  .cHalo{position:absolute;left:50%;top:50%;width:300px;height:300px;margin:-150px 0 0 -150px;
    border-radius:50%;filter:blur(6px);
    background:radial-gradient(circle, transparent 46%, rgba(255,255,255,.85) 51%,
      rgba(240,246,255,.35) 60%, rgba(225,235,255,.12) 74%, rgba(220,232,255,0) 88%);}
  .cLimb{position:absolute;left:50%;top:50%;width:170px;height:170px;margin:-85px 0 0 -85px;
    border-radius:50%;filter:blur(1px);
    background:radial-gradient(circle, transparent 85%, rgba(255,255,255,.9) 90%, rgba(235,242,255,0) 99%);}
  .cRays{position:absolute;left:50%;top:50%;width:600px;height:600px;margin:-300px 0 0 -300px;
    transform:scaleX(1.04);filter:blur(0.5px);}
  .cRay{position:absolute;left:50%;bottom:50%;transform-origin:50% 100%;border-radius:2px;}
  .cPhoto{position:absolute;left:50%;top:50%;width:480px;height:480px;margin:-240px 0 0 -240px;
    background-size:cover;background-position:center;mix-blend-mode:screen;display:none;
    -webkit-mask-image:radial-gradient(circle, transparent 15%, #000 21%, #000 88%, transparent 100%);
            mask-image:radial-gradient(circle, transparent 15%, #000 21%, #000 88%, transparent 100%);}
  .chromo{position:absolute;left:0;top:0;width:150px;height:150px;margin:-75px 0 0 -75px;border-radius:50%;
    opacity:0;transition:opacity .8s ease;filter:blur(1.4px);
    box-shadow:0 0 4px 2px rgba(255,90,120,.7), inset 0 0 2px 1px rgba(255,120,140,.5);}
  .proms{position:absolute;left:0;top:0;opacity:0;transition:opacity .8s ease;}
  .prom{position:absolute;left:0;top:0;transform-origin:0 0;}
  .prom svg{position:absolute;overflow:visible;filter:drop-shadow(0 0 3px rgba(255,80,110,.8));
    animation:flick var(--fk,2.4s) ease-in-out infinite;}
  @keyframes flick{0%,100%{opacity:.82}50%{opacity:1}}
  .sunGlow{position:absolute;left:0;top:0;width:150px;height:150px;margin:-75px 0 0 -75px;border-radius:50%;
    filter:blur(6px);transition:opacity .5s ease;
    background:radial-gradient(circle, rgba(255,244,206,.98) 34%, rgba(255,214,130,.55) 52%, rgba(255,190,96,0) 72%);}
  .sun{width:150px;height:150px;margin:-75px 0 0 -75px;
    background:radial-gradient(circle at 46% 42%, #fffef4 0%, #ffe98f 46%, #ffbe52 82%, #ff9e3a 100%);}
  .sunspots{position:absolute;left:0;top:0;width:150px;height:150px;margin:-75px 0 0 -75px;
    border-radius:50%;overflow:hidden;transition:opacity .5s ease;}
  .sunspot{position:absolute;border-radius:50%;
    background:radial-gradient(circle, #7a4a12 0%, #93590f 55%, rgba(147,89,15,0) 100%);
    box-shadow:0 0 3px 1px rgba(120,70,20,.5);}
  /* drifting daytime clouds */
  .clouds{position:absolute;inset:0;pointer-events:none;z-index:1;overflow:hidden;transition:opacity .8s ease;}
  .cloud{position:absolute;pointer-events:none;filter:blur(4px);will-change:transform;}
  .cloud i{position:absolute;border-radius:50%;background:rgba(255,255,255,.92);}

  /* Baily's beads — bright points along the limb at 2nd & 3rd contact */
  .beads{position:absolute;left:0;top:0;pointer-events:none;z-index:8;}
  .beads i{position:absolute;left:0;top:0;border-radius:50%;opacity:0;
    background:radial-gradient(circle, #ffffff 0 1.8px, #fff6e2 2.6px, rgba(255,232,180,.72) 3.6px, rgba(255,232,180,0) 36%);}
  .beads.go i{animation:beadflash 1.4s ease-out;}
  @keyframes beadflash{0%{opacity:0;transform:scale(.4)}22%{opacity:1;transform:scale(1.3)}100%{opacity:0;transform:scale(.6)}}

  /* an eagle soaring in slow circles */
  .eagleOrbit{position:absolute;left:18%;top:14vh;width:0;height:0;z-index:8;pointer-events:none;
    transform-origin:0 0;animation:eorbit 24s linear infinite;transition:opacity .8s ease;}
  @keyframes eorbit{to{transform:rotate(360deg)}}
  .eagleArm{position:absolute;left:0;top:0;transform:translate(-27px,-109px);}   /* up to the 12-o'clock point, R≈92 */
  .eagleFace{transform:rotate(90deg);transform-origin:27px 17px;}                 /* head leads the circular path */
  .eagle{display:block;animation:eflap 3.4s ease-in-out infinite;}
  @keyframes eflap{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.93)}}

  /* the moon is clipped to the sun's disc — visible only where it covers the sun (no floating black disc) */
  .moonClip{position:absolute;left:0;top:0;width:150px;height:150px;margin:-75px 0 0 -75px;
    border-radius:50%;overflow:hidden;z-index:7;}
  .moon{position:absolute;left:0;top:0;width:150px;height:150px;background:#07070d;border-radius:50%;
    will-change:transform;transition:transform .55s cubic-bezier(.4,.05,.3,1);}
  .diamond{position:absolute;left:0;top:0;opacity:0;pointer-events:none;z-index:8;}
  .diamond .bead{position:absolute;left:0;top:0;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;
    background:#fff;box-shadow:0 0 10px 5px #fff,0 0 26px 12px rgba(255,240,200,.85),0 0 60px 26px rgba(255,220,150,.45);}
  .diamond .fx{position:absolute;left:0;top:0;height:2px;margin-top:-1px;background:linear-gradient(to right,transparent,#fff,transparent);}
  .diamond .fy{position:absolute;left:0;top:0;width:2px;margin-left:-1px;background:linear-gradient(to bottom,transparent,#fff,transparent);}
  .diamond.go{animation:diaflash 3.5s ease-out;}
  .diamond.goShort{animation:diaflash 1s ease-out;}
  @keyframes diaflash{0%{opacity:0;transform:scale(.4)}10%{opacity:1;transform:scale(1)}
    70%{opacity:1;transform:scale(1.05)}100%{opacity:0;transform:scale(1.25)}}

  /* —— foreground: the Asklepieion of Kos —— */
  .ruins{position:absolute;left:0;right:0;bottom:0;width:100%;height:44vh;z-index:5;}
  .ruins svg{position:absolute;left:0;bottom:0;width:100%;height:100%;display:block;}
  /* portrait phones: the eclipse is drawn at a fixed pixel size, so it's proportionally huge here —
     shrink it, drop the text below it, and (via fitRuins) show the whole sanctuary rather than cropping */
  @media (max-aspect-ratio: 3/4){
    .eclipse{transform:scale(0.62);}
    .ruins{height:35vh;}   /* ~15% shorter than 41vh — smaller foreground, more sky/eclipse, sanctuary reads whole */
    #reward{top:46%;}
    .reward .small{font-size:12px;padding:0 22px;line-height:1.5;}
    .reward .big{font-size:24px;letter-spacing:6px;}
    #farewell{top:30%;}
    /* lift the venue footer clear of the (now shorter) ruins so its text/logo
       sit over open sky, not on the dark stone (see the phone screenshot) */
    .venue-footer{bottom:calc(35vh + 12px);}
  }

  /* shadow bands — faint fast ripples of light racing the ground just before/after totality */
  .shadowbands{position:absolute;left:-10%;right:-10%;bottom:0;height:48vh;z-index:7;pointer-events:none;opacity:0;
    transition:opacity .5s ease;filter:blur(1.1px);
    background:repeating-linear-gradient(93deg,
      rgba(228,236,255,0) 0 5px, rgba(228,236,255,.07) 6px 9px, rgba(228,236,255,0) 12px 17px);
    -webkit-mask-image:linear-gradient(to top,#000 46%,transparent 92%);
            mask-image:linear-gradient(to top,#000 46%,transparent 92%);
    animation:bands 1.05s linear infinite;}
  @keyframes bands{0%{background-position:0 0}100%{background-position:64px 0}}

  .hint{position:absolute;left:0;right:0;top:calc(25vh + 96px);text-align:center;z-index:9;
    color:#e8eef8;font-size:13.5px;letter-spacing:.8px;transition:opacity .6s ease;
    animation:hintpulse 3.4s ease-in-out infinite;}
  @keyframes hintpulse{
    0%,100%{text-shadow:0 1px 8px rgba(0,0,0,.45), 0 0 6px rgba(170,215,255,.12)}
    50%{text-shadow:0 1px 8px rgba(0,0,0,.45), 0 0 18px rgba(170,215,255,.55)}}
  /* a whispered line as the light fails, before totality */
  .omen{position:absolute;left:0;right:0;top:46%;text-align:center;z-index:9;opacity:0;pointer-events:none;
    color:#b9c2d4;font-size:13px;font-style:italic;letter-spacing:.8px;transition:opacity 1s ease;
    text-shadow:0 1px 10px rgba(0,0,0,.5);}
  .reward{position:absolute;left:0;right:0;top:42%;text-align:center;z-index:9;opacity:0;pointer-events:none;
    transition:opacity 1.6s ease;}
  .reward .kicker{display:block;color:#9dc7d8;font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-bottom:10px;}
  .reward .big{display:block;color:#F4F1E9;font-size:26px;font-weight:300;letter-spacing:8px;text-indent:8px;}
  .reward .rule{display:block;width:54px;height:1px;margin:12px auto;
    background:linear-gradient(to right, transparent, rgba(200,214,230,.6), transparent);}
  .reward .small{display:block;color:#c7b9d6;font-size:13.5px;line-height:1.6;letter-spacing:.5px;
    max-width:520px;margin:0 auto;padding:0 20px;}
  .caption{position:absolute;left:0;right:0;bottom:12px;text-align:center;z-index:9;
    color:#7f8a9e;font-size:12px;letter-spacing:.6px;}
  /* the farewell appears over the bright day sky — luminous text, no dark box */
  #farewell{top:34%;padding:30px 0;}
  #farewell .kicker,#farewell .big,#farewell .small{
    text-shadow:0 1px 8px rgba(8,16,32,.55), 0 0 22px rgba(255,255,255,.28);}
  #farewell .big{color:#FFFFFF;}
  #farewell .small{color:#F4F1F7;}
  #farewell .kicker{color:#eaf6fb;}

  /* venue / next-session footer — injected by the host (see FarewellEclipse.tsx).
     Sits at the bottom, revealed only after first totality so it complements the
     totality sequence rather than colliding with the bright-day opening. Styled to
     match the scene's luminous-text-on-sky treatment. */
  .venue-footer{position:absolute;left:0;right:0;bottom:34px;text-align:center;z-index:9;
    opacity:0;pointer-events:none;transition:opacity 1.4s ease;padding:0 22px;}
  .venue-footer.show{opacity:1;}
  .venue-footer .vf-logo{display:block;height:30px;width:auto;margin:0 auto 8px;opacity:.9;
    filter:drop-shadow(0 1px 6px rgba(8,16,32,.5));}
  .venue-footer .vf-lead{display:block;color:#dfe7f2;font-size:12px;letter-spacing:.6px;margin-bottom:3px;
    text-shadow:0 1px 8px rgba(8,16,32,.6);}
  .venue-footer .vf-schedule{display:block;color:#f2eef8;font-size:13px;letter-spacing:.4px;line-height:1.5;
    text-shadow:0 1px 8px rgba(8,16,32,.6), 0 0 18px rgba(255,255,255,.18);}

  /* a breeze before the eclipse — trees sway, then go still at totality */
  .sway{transform-box:fill-box;transform-origin:50% 100%;}
  .sway1{animation:sway 4.0s ease-in-out infinite;}
  .sway2{animation:sway 5.0s ease-in-out infinite;animation-delay:-1.4s;}
  .sway3{animation:sway 4.5s ease-in-out infinite;animation-delay:-2.6s;}
  @keyframes sway{0%,100%{transform:rotate(-1.9deg)}50%{transform:rotate(1.9deg)}}
  .stage.calm .sway1,.stage.calm .sway2,.stage.calm .sway3{animation-name:swayCalm;animation-duration:11s;}
  @keyframes swayCalm{0%,100%{transform:rotate(-.35deg)}50%{transform:rotate(.35deg)}}
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <filter id="coronaWisp" x="-40%" y="-40%" width="180%" height="180%">
    <feTurbulence type="fractalNoise" baseFrequency="0.014 0.022" numOctaves="2" seed="7" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="22" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
</defs></svg>
<div class="stage" id="stage">
  <div class="nightfall" id="nightfall"></div>
  <div class="clouds" id="clouds"></div>
  <div class="eagleOrbit" id="eagleOrbit"><div class="eagleArm"><div class="eagleFace"><svg class="eagle" viewBox="0 0 140 90" width="54" xmlns="http://www.w3.org/2000/svg"><path fill="#242019" d="M70 6 L74 12 L77 22 L95 20 L112 21 L123 25 L133 24 L127 29 L138 30 L129 33 L140 36 L128 37 L136 42 L125 41 L130 47 L117 44 L103 44 L90 45 L84 53 L83 61 L87 66 L70 72 L53 66 L57 61 L56 53 L50 45 L37 44 L23 44 L10 47 L15 41 L4 42 L12 37 L0 36 L11 33 L2 30 L13 29 L7 24 L17 25 L28 21 L45 20 L63 22 L66 12 Z"/></svg></div></div></div>
  <div class="skyfaint" id="skyfaint"></div>
  <div class="horizonglow" id="horizonglow"></div>
  <div class="gulls" id="gulls"></div>

  <div class="eclipse" id="eclipse">
    <div class="corona" id="corona"><div class="cHalo"></div><div class="cLimb"></div><div class="cRays" id="cRays"></div><div class="cPhoto" id="cPhoto"></div></div>
    <div class="chromo" id="chromo"></div>
    <div class="proms" id="proms"></div>
    <div class="sunGlow" id="sunGlow"></div>
    <div class="disc sun" id="sun"></div>
    <div class="sunspots" id="sunspots"></div>
    <div class="moonClip"><div class="moon" id="moon"></div></div>
    <div class="diamond" id="diamond"><div class="bead"></div><div class="fx"></div><div class="fy"></div></div>
    <div class="beads" id="beads"></div>
  </div>

  <div class="ruins" id="ruins">
    <svg id="ruinsSvg" viewBox="0 0 1000 300" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg"></svg>
  </div>

  <div class="hint" id="hint">Tap the sun to witness a rare celestial miracle&nbsp;&nbsp;…</div>
  <div class="omen" id="omen">the birds fall silent · the wind drops · the day is going out</div>
  <div class="shadowbands" id="shadowbands"></div>
  <div class="reward" id="reward">
    <span class="kicker">the corona — the sun's crown</span>
    <span class="big">TOTALITY</span>
    <span class="rule"></span>
    <span class="small">For two minutes at midday, night falls and the stars return —
      over the Asklepieion of Kos, where the ancients once came to be healed beneath this same sky.</span>
  </div>
  <div class="reward" id="farewell">
    <span class="kicker">the sun returns — and so will we</span>
    <span class="big" style="font-size:21px;letter-spacing:2.5px">Thank you for looking up with us ✨</span>
    <span class="rule"></span>
    <span class="small">Καληνύχτα — the sky over Kos keeps its light for you,
      until we gather beneath it again.</span>
  </div>
  <div class="venue-footer" id="venueFooter">{{FAREWELL_FOOTER}}</div>
</div>

<script>
(function(){
  var R=75, STEPS=10, A0=-28*Math.PI/180;
  var moon=document.getElementById('moon'), sunGlow=document.getElementById('sunGlow');
  var corona=document.getElementById('corona'), chromo=document.getElementById('chromo');
  var proms=document.getElementById('proms'), diamond=document.getElementById('diamond');
  var nightfall=document.getElementById('nightfall'), horizonglow=document.getElementById('horizonglow');
  var skyfaint=document.getElementById('skyfaint'), hint=document.getElementById('hint');
  var reward=document.getElementById('reward'), stage=document.getElementById('stage');
  var omen=document.getElementById('omen');
  var ruins=document.getElementById('ruins');
  var clouds=document.getElementById('clouds');
  var beads=document.getElementById('beads');
  var eagleOrbit=document.getElementById('eagleOrbit');
  var venueFooter=document.getElementById('venueFooter');

  /* —— drifting random clouds —— */
  (function(){
    for(var i=0;i<6;i++){
      var w=100+Math.random()*130, h=w*(0.3+Math.random()*0.1);
      var el=document.createElement('div'); el.className='cloud';
      el.style.width=w.toFixed(0)+'px'; el.style.height=h.toFixed(0)+'px';
      var np=3+Math.floor(Math.random()*3), html='';
      html+='<i style="width:'+w.toFixed(0)+'px;height:'+(h*0.55).toFixed(0)+'px;left:0;bottom:0;border-radius:'+h.toFixed(0)+'px"></i>';
      for(var p=0;p<np;p++){
        var pw=h*(0.7+Math.random()*0.85);
        var px=(np>1?(p/(np-1)):0.5)*(w-pw);
        var py=Math.random()*h*0.28;
        html+='<i style="width:'+pw.toFixed(0)+'px;height:'+pw.toFixed(0)+'px;left:'+px.toFixed(0)+'px;bottom:'+py.toFixed(0)+'px"></i>';
      }
      el.innerHTML=html;
      var top=(2+Math.random()*10).toFixed(1), dur=(75+Math.random()*80).toFixed(0);   // upper sky only — clear of the sun
      var dir=Math.random()<.5?1:-1, x0=dir>0?-24:120, x1=dir>0?120:-24;
      var delay=(-Math.random()*dur).toFixed(0);
      el.style.top=top+'vh'; el.style.opacity=(0.5+Math.random()*0.4).toFixed(2);
      var kf='cloudfly'+i, sheet=document.createElement('style');
      sheet.textContent='@keyframes '+kf+'{from{transform:translateX('+x0+'vw)}to{transform:translateX('+x1+'vw)}}';
      document.head.appendChild(sheet);
      el.style.animation=kf+' '+dur+'s linear '+delay+'s infinite';
      clouds.appendChild(el);
    }
  })();
  var gullsLayer=document.getElementById('gulls');
  var sunspots=document.getElementById('sunspots');

  /* —— build the Asklepieion of Kos: three terraces climbing the hill —— */
  (function buildRuins(){
    var svg=document.getElementById('ruinsSvg');
    var g='';
    var STONE1='#2c2820', STONE2='#322c24', GROUND='#1e1a14', VOID='#0a0908',
        COL='#c4bdad', STONE3='#3e372e', STAIR='#39332b', STEP='#221e18',
        CYP='#0f1b11', RIM='rgba(255,158,104,.16)';

    /* left edges extended to x=-120 (was 0) so the portrait view's rightward
       shift — see fitRuins — leaves no transparent gap in the sky-line/ground
       on the far left; the extra span just continues each layer's leftmost
       height flat outward. */
    g+='<path d="M-120 60 L100 46 L200 56 L300 40 L410 54 L520 44 L630 58 L730 46 L840 56 L940 48 L1000 54 '
      +'L1000 300 L-120 300 Z" fill="#3c4d63" opacity=".5"/>';
    g+='<path d="M-120 80 L120 68 L250 80 L370 66 L500 76 L620 68 L740 80 L860 70 L1000 78 '
      +'L1000 300 L-120 300 Z" fill="#2c3a49" opacity=".6"/>';
    g+='<path d="M-120 98 L70 92 L150 98 L240 88 L320 82 L400 68 L460 56 L500 53 L540 56 L600 68 '
      +'L680 82 L760 88 L840 96 L920 90 L1000 98 L1000 300 L-120 300 Z" fill="#14241a"/>';
    function cyp(x,tip,w,cls){return '<path class="sway '+cls+'" d="M'+x+' 116 C'+(x+w)+' '+(tip+50)+','+(x+w*0.7)+' 112,'+x+' 116 '
      +'C'+(x-w*0.7)+' 112,'+(x-w)+' '+(tip+50)+','+x+' '+tip+' Z" fill="'+CYP+'"/>';}
    g+=cyp(150,58,12,'sway1')+cyp(250,64,10,'sway2')+cyp(650,56,12,'sway3')+cyp(730,66,10,'sway1')+cyp(825,60,11,'sway2');

    g+='<g id="eaglePerch" style="opacity:0;transition:opacity 2s ease" fill="'+CYP+'">'
      +'<path d="M150 58 C147 54 148 49 152 47 C156 45 160 47 161 51 C164 50 166 52 165 55 '
      +'C168 55 169 58 166 59 C168 61 166 64 163 64 L143 64 C139 64 138 61 141 59 C138 58 139 55 142 55 '
      +'C140 51 143 47 147 48 C148 50 149 53 150 58 Z"/></g>';

    g+='<rect x="150" y="106" width="700" height="14" fill="'+STONE3+'"/>';
    (function(){
      var t='';
      t+='<polygon points="433,76 500,60 567,76" fill="'+COL+'"/>';
      t+='<rect x="431" y="76" width="138" height="6" fill="'+COL+'"/>';
      for(var i=0;i<6;i++){var tx=440+i*22; t+='<rect x="'+tx+'" y="82" width="5" height="20" fill="'+COL+'"/>';}
      t+='<rect x="428" y="102" width="144" height="5" fill="'+COL+'"/>';
      g+=t;
    })();

    g+='<rect x="95" y="120" width="360" height="50" fill="'+STONE2+'"/>';
    g+='<rect x="560" y="120" width="220" height="50" fill="'+STONE2+'"/>';
    var cols='';
    for(var c=0;c<5;c++){
      var ccx=250+c*28;
      cols+='<rect x="'+ccx+'" y="120" width="6" height="50"/>';
      cols+='<path d="M'+(ccx-2)+' 120 L'+(ccx-3)+' 116 L'+ccx+' 112 L'+(ccx+6)+' 112 L'+(ccx+9)+' 116 L'+(ccx+8)+' 120 Z"/>';
    }
    g+='<g fill="'+COL+'">'+cols+'</g>';
    g+='<polygon points="458,170 468,120 552,120 562,170" fill="'+STAIR+'"/>';
    var st2='';
    for(var s3=0;s3<10;s3++){
      var y3=124+s3*4.4, f3=(y3-120)/(170-120);
      var l3=468-(468-458)*f3, r3=552+(562-552)*f3;
      st2+='<line x1="'+l3.toFixed(0)+'" y1="'+y3.toFixed(0)+'" x2="'+r3.toFixed(0)+'" y2="'+y3.toFixed(0)+'"/>';
    }
    g+='<g stroke="'+STEP+'" stroke-width="1.3">'+st2+'</g>';

    g+='<rect x="30" y="170" width="940" height="82" fill="'+STONE1+'"/>';
    /* ground bands extended left to x=-120 (see the sky-line note above) so the
       shifted portrait view shows continuous ground, no transparent wedge. */
    g+='<rect x="-120" y="252" width="1120" height="48" fill="'+GROUND+'"/>';
    g+='<rect x="-120" y="278" width="1120" height="22" fill="#3a2f21"/>';
    g+='<rect x="-120" y="278" width="1120" height="3" fill="rgba(210,180,140,.22)"/>';
    g+='<g fill="#463825"><ellipse cx="150" cy="288" rx="22" ry="7"/><ellipse cx="835" cy="292" rx="26" ry="8"/>'
      +'<ellipse cx="500" cy="295" rx="18" ry="6"/><ellipse cx="330" cy="291" rx="14" ry="5"/><ellipse cx="670" cy="289" rx="16" ry="5"/></g>';
    var arch='', pitch=54, aw=42, r=aw/2, spring=208, baseY=248;
    for(var x=48; x+aw<=420; x+=pitch){
      arch+='<path d="M'+x+' '+baseY+' L'+x+' '+spring+' A'+r+' '+r+' 0 0 1 '+(x+aw)+' '+spring+' L'+(x+aw)+' '+baseY+' Z" fill="'+VOID+'"/>';
      g+='<path d="M'+x+' '+spring+' A'+r+' '+r+' 0 0 1 '+(x+aw)+' '+spring+'" fill="none" stroke="rgba(120,110,95,.22)" stroke-width="1"/>';
    }
    g+=arch;
    g+='<path d="M748 248 L748 214 A22 22 0 0 1 792 214 L792 248 Z" fill="'+VOID+'"/>';

    g+='<polygon points="420,252 438,170 562,170 580,252" fill="'+STAIR+'"/>';
    var steps='';
    for(var s2=0;s2<16;s2++){
      var yy=174+s2*4.8, f=(yy-170)/(252-170);
      var lx=438-(438-420)*f, rx=562+(580-562)*f;
      steps+='<line x1="'+lx.toFixed(0)+'" y1="'+yy.toFixed(0)+'" x2="'+rx.toFixed(0)+'" y2="'+yy.toFixed(0)+'"/>';
    }
    g+='<g stroke="'+STEP+'" stroke-width="1.5">'+steps+'</g>';

    g+='<g fill="none" stroke="'+RIM+'" stroke-width="1.3">'
      +'<path d="M150 106 h700"/><path d="M95 120 h360 M560 120 h220"/><path d="M30 170 h940"/></g>';

    svg.innerHTML=g;
  })();

  (function fitRuins(){
    var svg=document.getElementById('ruinsSvg');
    function fit(){
      var portrait=(window.innerWidth/window.innerHeight)<0.75;
      // Portrait: a WIDE window into the 1000-wide artwork so almost the whole
      // sanctuary is visible — the left arcade through the right propylaea, not
      // the centered slice that used to crop them off. Origin nudged left
      // (40 -> -70) to shift the foreground RIGHT on screen so the middle-
      // terrace colonnade clears the left edge, while keeping the temple's
      // pediment (upper right) from riding off the right side.
      //
      // Landscape: the art is 1000x300 (aspect 3.33). The .ruins band is
      // width:100% x 44vh, whose aspect on a WIDE desktop exceeds 3.33 — with
      // "slice" that cropped the top and cut the temple pediment. When the band
      // is wider-aspect than the art, switch to "meet" so the WHOLE scene fits
      // (temple included), anchored to the bottom-centre; the surrounding sky
      // (a full-bleed gradient behind the ruins) fills the sides seamlessly, so
      // there's no visible letterbox. Narrower screens keep "slice" (fills edge
      // to edge with only a harmless sliver of foreground cropped).
      var ruinsEl=document.getElementById('ruins');
      var bandH=ruinsEl?ruinsEl.getBoundingClientRect().height:(window.innerHeight*0.44);
      var bandAspect=window.innerWidth/Math.max(1,bandH);
      var wideBand=bandAspect>(1000/300); // art aspect
      svg.setAttribute('viewBox', portrait?'-70 20 900 280':'0 0 1000 300');
      svg.setAttribute('preserveAspectRatio', portrait?'xMidYMax slice':(wideBand?'xMidYMax meet':'xMidYMax slice'));
    }
    fit(); window.addEventListener('resize',fit);
  })();
  var shadowbands=document.getElementById('shadowbands');

  (function(){
    var n=1+Math.floor(Math.random()*4);
    for(var i=0;i<n;i++){
      var a=Math.random()*Math.PI*2, r=Math.random()*54;
      var cx=75+Math.cos(a)*r, cy=75+Math.sin(a)*r;
      var sz=3+Math.random()*6;
      var s=document.createElement('span');s.className='sunspot';
      s.style.width=sz.toFixed(1)+'px';s.style.height=(sz*(0.7+Math.random()*0.4)).toFixed(1)+'px';
      s.style.left=(cx-sz/2).toFixed(1)+'px';s.style.top=(cy-sz/2).toFixed(1)+'px';
      sunspots.appendChild(s);
    }
  })();

  (function(){
    for(var i=0;i<46;i++){
      var s=document.createElement('span');s.className='fstar';
      var sz=(Math.random()<.2?1.8:1.1);
      s.style.width=sz+'px';s.style.height=sz+'px';
      s.style.left=(Math.random()*100).toFixed(1)+'%';s.style.top=(Math.random()*58).toFixed(1)+'%';
      s.style.opacity=(.4+Math.random()*.6).toFixed(2);skyfaint.appendChild(s);
    }
    var SC=['#cfe2ff','#f8f7ff','#fff3e0','#ffe9c4'];
    for(var j=0;j<7;j++){
      var st=document.createElement('span');st.className='bgstar';
      st.style.left=(Math.random()*100).toFixed(1)+'%';st.style.top=(Math.random()*50).toFixed(1)+'%';
      st.style.setProperty('--s',(6+Math.random()*7).toFixed(1)+'px');
      st.style.setProperty('--sc',SC[Math.floor(Math.random()*SC.length)]);
      st.style.setProperty('--td',(2.5+Math.random()*3).toFixed(1)+'s');
      st.style.setProperty('--tl',(-Math.random()*3).toFixed(1)+'s');skyfaint.appendChild(st);
    }
  })();

  (function(){
    var STARS=[
      ['Alcyone',   0.0,   0.0, 2.87],
      ['Atlas',   -23.3,   3.0, 3.63],
      ['Electra',  35.6,  -1.0, 3.70],
      ['Maia',     23.3, -16.0, 3.87],
      ['Merope',   16.4,   9.0, 4.18],
      ['Taygeta',  31.5, -22.0, 4.30],
      ['Pleione', -23.3,  -2.0, 5.05],
      ['Celaeno',  36.7, -11.0, 5.45],
      ['Asterope', 21.9, -27.0, 5.60]
    ];
    var SCALE=0.62;
    var wrap=document.createElement('div');
    wrap.style.cssText='position:absolute;left:73%;top:11%;pointer-events:none;';
    var neb=document.createElement('div');
    // ~15% more visible blue reflection nebulosity around the cluster: peak
    // alpha .18 -> .21 and the fade pushed outward (70% -> 80%) so the haze
    // reads a touch stronger, with a slightly larger footprint to match.
    neb.style.cssText='position:absolute;left:-30px;top:-27px;width:80px;height:69px;border-radius:50%;'
      +'filter:blur(9px);background:radial-gradient(ellipse,rgba(150,185,255,.21),rgba(150,185,255,0) 80%);';
    wrap.appendChild(neb);
    STARS.forEach(function(st){
      var d=1.4+(5.6-st[3])*0.72;
      var el=document.createElement('div');
      el.style.cssText='position:absolute;border-radius:50%;'
        +'left:'+(st[1]*SCALE).toFixed(1)+'px;top:'+(st[2]*SCALE).toFixed(1)+'px;'
        +'width:'+d.toFixed(1)+'px;height:'+d.toFixed(1)+'px;margin:'+(-d/2).toFixed(1)+'px 0 0 '+(-d/2).toFixed(1)+'px;'
        +'background:radial-gradient(circle,#ffffff 0 30%,#d3e2ff 60%,rgba(190,214,255,0) 100%);'
        +'box-shadow:0 0 '+(d*1.4).toFixed(1)+'px '+(d*0.4).toFixed(1)+'px rgba(200,220,255,.6);';
      wrap.appendChild(el);
    });
    var lbl=document.createElement('span');
    lbl.className='lbl'; lbl.textContent='Pleiades';
    lbl.style.cssText='position:absolute;left:8px;top:26px;white-space:nowrap;font-size:9px;letter-spacing:.5px;color:rgba(210,220,240,.5);';
    wrap.appendChild(lbl);
    skyfaint.appendChild(wrap);
  })();

  (function(){
    var SUNX=50, SUNY=25, SLOPE=-0.441;
    function eclY(x){return SUNY+SLOPE*(x-SUNX);}
    function jit(r){return (Math.random()*2-1)*r;}

    var showSaturn=Math.random()<0.62, showJupiter=Math.random()<0.62;
    if(!showSaturn && !showJupiter){ if(Math.random()<0.5) showSaturn=true; else showJupiter=true; }

    var list=[];
    var vx=26+jit(8); list.push({n:'Venus', x:vx, y:eclY(vx)+jit(4), s:5.5, c:'#fff4d6', g:'0 0 9px 2.5px rgba(255,246,214,.9)'});
    if(showSaturn){ var sx=12+jit(6); list.push({n:'Saturn', x:sx, y:eclY(sx)+jit(6), s:4.4, c:'#e8d9a8', g:'0 0 6px 2px rgba(232,217,168,.68)', ring:1}); }
    if(showJupiter){ var jx=90+jit(3); list.push({n:'Jupiter', x:jx, y:eclY(jx)+jit(3), s:9, jupiter:1}); }

    list.forEach(function(d){
      var el=document.createElement('div');el.className='planet';
      el.style.left=d.x.toFixed(1)+'%';el.style.top=d.y.toFixed(1)+'%';
      el.style.width=d.s+'px';el.style.height=d.s+'px';
      if(d.jupiter){
        el.style.background='radial-gradient(circle at 34% 30%, rgba(255,255,255,.35), rgba(255,255,255,0) 55%),'
          +'linear-gradient(180deg, #e9d7b4 0%, #e9d7b4 11%, #c9975f 11%, #c9975f 20%, #f1e4c6 20%, #f1e4c6 34%,'
          +' #b97d47 34%, #b97d47 44%, #f4ebd4 44%, #f4ebd4 58%, #cc9c66 58%, #cc9c66 68%, #eddbb4 68%, #eddbb4 100%)';
        el.style.boxShadow='0 0 9px 2px rgba(242,231,207,.8)';
        el.innerHTML='<span style="position:absolute;left:58%;top:57%;width:38%;height:22%;border-radius:50%;'
          +'background:#b5573a;opacity:.85;"></span>';
      } else {
        el.style.background=d.c;el.style.boxShadow=d.g;
        if(d.ring){el.innerHTML='<span class="ring" style="width:'+(d.s*2.3).toFixed(1)+'px;height:'+(d.s*.9).toFixed(1)+'px"></span>';}
      }
      var l=document.createElement('span');l.className='lbl';l.textContent=d.n;el.appendChild(l);
      skyfaint.appendChild(el);
    });
  })();

  var gulls=[];
  (function(){
    for(var i=0;i<6;i++){
      var g=document.createElement('div');g.className='gull';
      g.innerHTML='<span class="flap"><svg width="30" height="12" viewBox="0 0 30 12">'
        +'<path d="M1 9 C 7 8, 11 2, 15 6 C 19 2, 23 8, 29 9 '
        +'C 23 6, 19 6, 15 8 C 11 6, 7 6, 1 9 Z" fill="#1b1d27"/></svg></span>';
      var dir=Math.random()<.5?1:-1;
      var top=(6+Math.random()*36).toFixed(1);
      var dur=(16+Math.random()*16).toFixed(1);
      var delay=(-Math.random()*dur).toFixed(1);
      var scale=(0.6+Math.random()*0.7).toFixed(2);
      g.style.setProperty('--fl',(0.36+Math.random()*0.28).toFixed(2)+'s');
      var kf='gfly'+i;
      var x0=dir>0?-12:112, x1=dir>0?112:-12;
      var bob=(6+Math.random()*8).toFixed(1);
      var sheet=document.createElement('style');
      sheet.textContent='@keyframes '+kf+'{'
        +'0%{transform:translate('+x0+'vw,'+top+'vh) scale('+scale+')}'
        +'50%{transform:translate('+((+x0+ +x1)/2).toFixed(1)+'vw,'+(top-bob)+'vh) scale('+scale+')}'
        +'100%{transform:translate('+x1+'vw,'+top+'vh) scale('+scale+')}}';
      document.head.appendChild(sheet);
      g.style.animation=kf+' '+dur+'s linear '+delay+'s infinite';
      gullsLayer.appendChild(g);gulls.push(g);
    }
  })();
  function setGulls(n){for(var i=0;i<gulls.length;i++){gulls[i].style.opacity=(i<n?'0.9':'0');}}

  function flyAwayBirds(){
    var n=7+Math.floor(Math.random()*4);
    for(var i=0;i<n;i++){
      var b=document.createElement('div'); b.className='gull';
      b.innerHTML='<span class="flap"><svg width="30" height="12" viewBox="0 0 30 12">'
        +'<path d="M1 9 C 7 8, 11 2, 15 6 C 19 2, 23 8, 29 9 C 23 6, 19 6, 15 8 C 11 6, 7 6, 1 9 Z" fill="#1b1d27"/></svg></span>';
      var sx=20+Math.random()*60, sy=54+Math.random()*12;
      var side=Math.random()<.5?-16:116;
      var ex=side+(Math.random()*20-10), ey=2+Math.random()*22;
      var durN=1.7+Math.random()*1.6, sc=(0.55+Math.random()*0.5).toFixed(2);
      b.style.setProperty('--fl',(0.2+Math.random()*0.12).toFixed(2)+'s');
      var kf='flee'+Math.floor(Math.random()*1e7), sheet=document.createElement('style');
      sheet.textContent='@keyframes '+kf+'{0%{transform:translate('+sx.toFixed(1)+'vw,'+sy.toFixed(1)+'vh) scale('+sc+');opacity:.9}'
        +'80%{opacity:.9}100%{transform:translate('+ex.toFixed(1)+'vw,'+ey.toFixed(1)+'vh) scale('+sc+');opacity:0}}';
      document.head.appendChild(sheet);
      b.style.animation=kf+' '+durN.toFixed(2)+'s ease-in '+(Math.random()*0.4).toFixed(2)+'s forwards';
      gullsLayer.appendChild(b);
      (function(el,st,d){setTimeout(function(){el.remove();st.remove();}, d*1000+700);})(b,sheet,durN);
    }
  }

  function loopProm(w,h){
    return '<svg width="'+(w+4)+'" height="'+(h+4)+'" viewBox="0 0 '+(w+4)+' '+(h+4)+'">'
      +'<path d="M2 '+(h+2)+' A '+(w/2)+' '+h+' 0 0 1 '+(w+2)+' '+(h+2)+'" fill="none" '
      +'stroke="#ff6a86" stroke-width="2.4" stroke-linecap="round"/></svg>';
  }
  function flameProm(w,h){
    return '<svg width="'+(w+4)+'" height="'+(h+4)+'" viewBox="0 0 '+(w+4)+' '+(h+4)+'">'
      +'<defs><linearGradient id="fg'+Math.floor(Math.random()*1e6)+'" x1="0" y1="1" x2="0" y2="0">'
      +'</linearGradient></defs>'
      +'<path d="M'+(w/2+2)+' '+(h+2)+' C '+(2)+' '+(h*0.5)+', '+(w*0.35+2)+' '+(h*0.35)+', '+(w/2+2)+' 2 '
      +'C '+(w*0.65+2)+' '+(h*0.35)+', '+(w+2)+' '+(h*0.5)+', '+(w/2+2)+' '+(h+2)+' Z" '
      +'fill="#ff5b7d"/></svg>';
  }
  var PROM_ANGLES=[200, 18];
  function placeProm(Adeg,kind){
    var rad=Adeg*Math.PI/180, px=Math.sin(rad)*R, py=-Math.cos(rad)*R;
    var g=document.createElement('div');g.className='prom';
    g.style.transform='translate('+px.toFixed(1)+'px,'+py.toFixed(1)+'px) rotate('+Adeg.toFixed(1)+'deg)';
    var w,h,svg;
    if(kind==='loop'){w=9+Math.random()*6;h=6+Math.random()*4;svg=loopProm(w,h);}
    else{w=6+Math.random()*3;h=10+Math.random()*7;svg=flameProm(w,h);}
    g.innerHTML=svg;var s=g.querySelector('svg');
    s.style.left=(-(w+4)/2)+'px';s.style.top=(-(h+4))+'px';
    s.style.setProperty('--fk',(2+Math.random()*1.6).toFixed(1)+'s');
    proms.appendChild(g);
  }
  function buildProms(){
    proms.innerHTML='';
    placeProm(PROM_ANGLES[0]+(-6+Math.random()*12), 'flame');
    if(Math.random()<0.6) placeProm(PROM_ANGLES[1]+(-10+Math.random()*20), 'loop');
  }
  buildProms();

  var CB=[0.98,0.98,0.99,0.99,0.99,0.99,0.99,0.98,0.98,0.97,0.96,0.95,0.94,0.94,0.93,0.94,0.95,0.94,0.92,0.93,
          0.93,0.93,0.96,0.98,0.99,0.99,0.99,0.99,0.99,0.99,0.98,0.98,0.98,0.98,0.98,0.98,0.97,0.97,0.97,0.96,
          0.90,0.84,0.75,0.66,0.56,0.50,0.43,0.35,0.30,0.24,0.16,0.13,0.10,0.11,0.15,0.29,0.42,0.60,0.74,0.86,
          0.92,0.95,0.96,0.96,0.96,0.96,0.96,0.96,0.97,0.97,0.98,0.98];
  var CRE=[0.29,0.31,0.34,0.36,0.38,0.40,0.43,0.46,0.47,0.50,0.48,0.48,0.52,0.58,0.52,0.54,0.54,0.47,0.32,0.27,
           0.23,0.17,0.20,0.22,0.25,0.35,0.38,0.34,0.37,0.40,0.27,0.25,0.23,0.18,0.19,0.18,0.17,0.22,0.25,0.26,
           0.41,0.56,0.65,0.68,0.79,0.83,0.84,0.89,0.87,0.84,0.75,0.72,0.69,0.73,0.69,0.63,0.55,0.46,0.42,0.33,
           0.31,0.23,0.22,0.15,0.21,0.34,0.39,0.45,0.48,0.41,0.34,0.35];
  function cprof(A,arr){var f=(((A%360)+360)%360)/5;var i=Math.floor(f)%72;var t=f-Math.floor(f);
    return arr[i]*(1-t)+arr[(i+1)%72]*t;}

  (function(){ document.getElementById('cRays').style.display='none'; })();

  var CORONA_IMAGE_URL = '';
  var hasPhoto = !!CORONA_IMAGE_URL;
  (function(){
    if(!hasPhoto) return;
    var cp=document.getElementById('cPhoto');
    cp.style.backgroundImage='url("'+CORONA_IMAGE_URL+'")';
    cp.style.display='block';
    document.getElementById('cRays').style.opacity='0';
    document.querySelector('.cHalo').style.opacity='0';
    document.querySelector('.cLimb').style.opacity='0';
  })();

  function placeDiamond(ang){
    diamond.style.left=(Math.cos(ang)*R).toFixed(1)+'px';diamond.style.top=(Math.sin(ang)*R).toFixed(1)+'px';
    var fx=diamond.querySelector('.fx'),fy=diamond.querySelector('.fy');
    fx.style.width='120px';fx.style.left='-60px';fx.style.top='0';
    fy.style.height='120px';fy.style.top='-60px';fy.style.left='0';
  }
  function flashDiamond(ang,short){placeDiamond(ang);diamond.classList.remove('go','goShort');void diamond.offsetWidth;diamond.classList.add(short?'goShort':'go');}

  function flashBeads(centerAng){
    var n=6, span=0.95, html='';
    for(var i=0;i<n;i++){
      var a=centerAng - span/2 + span*(i/(n-1)) + (Math.random()-0.5)*0.10;
      var bx=Math.cos(a)*R, by=Math.sin(a)*R;
      var sz=16.5+Math.random()*9.4;
      html+='<i style="left:'+bx.toFixed(1)+'px;top:'+by.toFixed(1)+'px;width:'+sz.toFixed(1)+'px;height:'+sz.toFixed(1)+'px;'
        +'margin:'+(-sz/2).toFixed(1)+'px 0 0 '+(-sz/2).toFixed(1)+'px;'
        +'animation-delay:'+(Math.random()*0.18).toFixed(2)+'s"></i>';
    }
    beads.innerHTML=html;
    beads.classList.remove('go');void beads.offsetWidth;beads.classList.add('go');
    setTimeout(function(){beads.innerHTML='';},1600);
  }

  function uncoveredDist(dist){
    var r=Math.min(1, Math.abs(dist)/(2*R));
    if(r>=1) return 1;
    var covered=(2*Math.acos(r) - 2*r*Math.sqrt(1-r*r))/Math.PI;
    return 1-covered;
  }

  var TOTALITY_MS=9000;
  var EGRESS_MS=6000;
  var TOTAL_EPS=1.5;
  var c=0, wasTotal=false, animating=false, idleReset, fwTimer;
  var postTotality=false;
  // Once-guard: the delayed 'eclipse-complete' (review-panel reveal) fires only
  // on the FIRST totality, never again on a replay.
  var completeSent=false;
  // Latches true the first time totality is reached and NEVER resets — once the
  // day has gone dark, the daytime clouds and birds do not come back, not even
  // if the guest replays the eclipse. (setGulls/eagle/cloud opacity below all
  // check this so a redo starts from an already-empty sky.)
  var firstCycleDone=false;
  var eaglePerch=document.getElementById('eaglePerch');

  function applyD(d){
    moon.style.transform='translate('+(Math.cos(A0)*d).toFixed(1)+'px,'+(Math.sin(A0)*d).toFixed(1)+'px)';
    var u=uncoveredDist(d);
    var coverage=1-u;
    var dark = u>0.28 ? (1-u)*0.125 : 0.09 + Math.pow((0.28-u)/0.28, 1.7)*0.91;

    nightfall.style.opacity=Math.min(.97,dark).toFixed(3);
    sunGlow.style.opacity=Math.pow(Math.max(0,u),0.5).toFixed(3);
    skyfaint.style.opacity=Math.max(0,(coverage-0.6)/0.4).toFixed(3);
    horizonglow.style.opacity=Math.max(0,(dark-0.55)*2.5).toFixed(3);
    // Birds (gulls + circling eagle): thin out as the light fails, and once the
    // first totality has happened (firstCycleDone) they stay gone entirely — a
    // replay begins on an empty, already-eclipsed-once sky.
    setGulls((postTotality||firstCycleDone)?0:Math.round(6*Math.max(0, 1-coverage/0.5)));
    stage.classList.toggle('calm', dark>0.35);
    ruins.style.filter='brightness('+(0.32+0.68*(1-dark)).toFixed(2)+')';
    // Clouds: driven by CLICK COUNT, not darkness — fully present through step 6,
    // fading out to nothing by step 8 (2 clicks before totality at step 10), so
    // they've cleared well before the corona. After the first cycle they never
    // return (firstCycleDone), so a replay has a clean sky from the start.
    clouds.style.opacity=firstCycleDone?'0':Math.max(0, Math.min(1, (STEPS-2-c)/2)).toFixed(3);
    eagleOrbit.style.opacity=(postTotality||firstCycleDone)?0:Math.max(0,1-coverage/0.5).toFixed(3);

    var total=(Math.abs(d) < TOTAL_EPS);
    shadowbands.style.opacity=(!total)?(Math.max(0,(dark-0.28)/0.6)*0.55).toFixed(3):'0';
    omen.style.opacity=(!total)?Math.max(0,(dark-0.30)/0.35).toFixed(3):'0';
    corona.style.opacity=total?'1':'0';
    chromo.style.opacity=(total&&!hasPhoto)?'1':'0';
    proms.style.opacity=(total&&!hasPhoto)?'1':'0';
    reward.style.opacity=total?'1':'0';
    hint.style.opacity=(u>0.999 && !animating)?'1':'0';

    if(total && !wasTotal){ buildProms();
      postTotality=true; firstCycleDone=true;   // from here on, clouds & birds never return, even on a replay
      if(eaglePerch) eaglePerch.style.opacity='1';
      if(venueFooter) venueFooter.classList.add('show');   // reveal venue footer at first totality
      // ADDITIVE, standalone-safe: notify the host page (when embedded) that totality was reached, so it can reveal the review invitation. No-op when opened as a standalone file (window.parent===window) — nothing listens and nothing changes visually.
      try{ if(window.parent && window.parent!==window){ window.parent.postMessage({type:'eclipse-totality'},'*'); } }catch(e){}
      // Reveal the review/socials panel a few seconds INTO totality — after the
      // guest has taken in the corona, but guaranteed to fire (unlike waiting for
      // full egress, which a replay-tap can skip). Once per farewell view.
      if(!completeSent){ completeSent=true; setTimeout(function(){
        try{ if(window.parent && window.parent!==window){ window.parent.postMessage({type:'eclipse-complete'},'*'); } }catch(e){}
      }, 4000); }
    }
    if(!total && wasTotal){ flashBeads(A0); flashDiamond(A0,true);
      shadowbands.style.opacity='.32'; setTimeout(function(){shadowbands.style.opacity='0';},1000);
    }
    wasTotal=total;
  }
  applyD(2*R);

  function startEgress(){
    moon.style.transition='none';
    var t0=null;
    function frame(now){
      if(t0===null)t0=now;
      var p=Math.min(1,(now-t0)/EGRESS_MS);
      var e=p<0.5 ? 2*p*p : 1-Math.pow(-2*p+2,2)/2;
      applyD(-(2*R)*e);
      if(p<1){requestAnimationFrame(frame);}
      else {
        c=0; applyD(2*R);
        void moon.offsetWidth;
        moon.style.transition=''; animating=false;
        var fw=document.getElementById('farewell');
        fw.style.opacity='1'; hint.style.opacity='0';
        fwTimer=setTimeout(function(){ fw.style.opacity='0'; hint.style.opacity='1'; }, 8000);
      }
    }
    requestAnimationFrame(frame);
  }

  stage.addEventListener('click',function(){
    if(animating) return;
    clearTimeout(idleReset); clearTimeout(fwTimer);
    document.getElementById('farewell').style.opacity='0';
    if(postTotality && c===0){ postTotality=false; if(eaglePerch) eaglePerch.style.opacity='0'; }
    if(c<STEPS){ c++; applyD(2*R*(1-c/STEPS)); }
    if(c===STEPS-1){ flashBeads(A0+Math.PI); flashDiamond(A0+Math.PI); if(!firstCycleDone) flyAwayBirds(); }  // startled flock only on the first eclipse, not replays
    if(c>=STEPS){
      animating=true;
      setTimeout(startEgress, TOTALITY_MS);
    } else {
      idleReset=setTimeout(function(){ c=0; applyD(2*R); }, 8000);
    }
  });
})();
</script>
</body>
</html>`

// Splice the caller's pre-escaped footer HTML into the scene at the marker.
// A String.prototype.replace with a string (not regex) argument, so any `$`
// sequences in the footer are treated literally — no accidental replacement-
// pattern interpretation.
export function buildEclipseSceneHtml(footerHtml: string): string {
  return ECLIPSE_SCENE_TEMPLATE.split('{{FAREWELL_FOOTER}}').join(footerHtml)
}
