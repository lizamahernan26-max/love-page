export function initHeart(initialWords, onHeart) {
const canvas=document.getElementById("canvas");
const ctx=canvas.getContext("2d");
const scene=document.getElementById("scene");
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let reducedMotion = motionQuery.matches;
let frameId = 0;
function requestFrame() {
  if (!frameId && !document.hidden) frameId = requestAnimationFrame(now => { frameId = 0; animate(now); });
}
let W,H,unit,halo,laneWidth,wordBag=[];

function resize(){
W=scene.clientWidth;
H=scene.clientHeight;
const dpr=Math.min(window.devicePixelRatio||1,2);
canvas.width=Math.round(W*dpr);
canvas.height=Math.round(H*dpr);
ctx.setTransform(dpr,0,0,dpr,0,0);
unit=Math.min(W*(W<600?.72:.82),H*.96,528)/32;
laneWidth=Math.max(18,W/2-unit*21.5-12);
scene.classList.toggle("narrow",laneWidth<160);
scene.style.setProperty("--word-lane-width",laneWidth+"px");
scene.querySelectorAll(".word").forEach(word=>word.remove());
wordBag=[];
halo=ctx.createRadialGradient(W/2,H*.46,0,W/2,H*.46,unit*22);
halo.addColorStop(0,"#ed45801c");halo.addColorStop(1,"#ed458000");
}
resize();
window.addEventListener("resize",()=>{resize();requestFrame();});

// 保留原有心形曲线，增加中心厚度和散开位置，用透视投影呈现立体感。
function heart(t){
return{x:16*Math.pow(Math.sin(t),3),y:13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t)};
}
const COUNT=reducedMotion?1200:(innerWidth<600?3200:5600);
const particles=[];
for(let i=0;i<COUNT;i++){
const p=heart(Math.random()*Math.PI*2);
const r=i<COUNT*.24?.90+Math.random()*.10:Math.sqrt(Math.random());
const depth=(Math.random()*2-1)*5.5*Math.sqrt(1-r*r);
particles.push({
x:p.x*r,y:(-p.y-2.5)*r,z:depth,
sx:(Math.random()-.5)*90,sy:(Math.random()-.5)*65,sz:(Math.random()-.5)*45,
delay:Math.random()*.65,size:.45+Math.random()*1.25,phase:Math.random()*Math.PI*2,
color:depth>0?"#ff8fb9":(r>.88?"#ffc5db":"#ed4d8e")
});
}
const stars=Array.from({length:100},()=>({x:Math.random(),y:Math.random(),r:Math.random()*1.1+.2,phase:Math.random()*6.28}));
const bursts=[];
let startedAt,lastTap=-Infinity;

function animate(now){
if(startedAt===undefined)startedAt=now;
const t=(now-startedAt)/1000;
const tapAge=(now-lastTap)/1000;
ctx.clearRect(0,0,W,H);
for(const s of stars){
ctx.globalAlpha=reducedMotion?.3:.18+(Math.sin(t*.7+s.phase)+1)*.18;
ctx.fillStyle="#efd9ea";
ctx.fillRect(s.x*W,s.y*H,s.r,s.r);
}
ctx.globalAlpha=1;
ctx.fillStyle=halo;ctx.fillRect(0,0,W,H);

const angle=reducedMotion?-.12:Math.sin(t*.34)*.30;
const cos=Math.cos(angle),sin=Math.sin(angle);
const cycle=t%1.25;
const beat=reducedMotion?0:.065*Math.exp(-Math.pow((cycle-.16)/.075,2))+.035*Math.exp(-Math.pow((cycle-.36)/.085,2));
const pulse=1+beat+(tapAge<1.5?Math.exp(-tapAge*4)*.15:0);
ctx.globalCompositeOperation="lighter";
for(const p of particles){
const progress=reducedMotion?1:Math.max(0,Math.min(1,(t-p.delay)/2.2));
const ease=1-Math.pow(1-progress,3);
const px=(p.sx+(p.x-p.sx)*ease)*pulse;
const py=(p.sy+(p.y-p.sy)*ease)*pulse;
const pz=(p.sz+(p.z-p.sz)*ease)*pulse;
const x=px*cos-pz*sin,z=px*sin+pz*cos;
const perspective=65/(65+z);
const size=p.size*perspective*Math.max(.65,unit/10);
ctx.globalAlpha=(.38+(p.z+5.5)/22)*(reducedMotion?1:.80+.20*Math.sin(t*1.6+p.phase));
ctx.fillStyle=p.color;
ctx.fillRect(W/2+x*unit*perspective,H*.46+py*unit*perspective,size,size);
}
for(let i=bursts.length-1;i>=0;i--){
const p=bursts[i],age=(now-p.born)/1000;
if(age>=1.4){bursts.splice(i,1);continue;}
ctx.globalAlpha=Math.pow(1-age/1.4,2);
ctx.fillStyle=p.color;
const x=W/2+Math.cos(p.angle)*p.speed*age;
const y=H*.46+Math.sin(p.angle)*p.speed*age+22*age*age;
ctx.fillRect(x,y,p.size,p.size);
}
ctx.globalCompositeOperation="source-over";
if(!reducedMotion&&tapAge<1.2){
ctx.globalAlpha=(1-tapAge/1.2)*.45;
ctx.strokeStyle="#ffb5d3";ctx.lineWidth=1;
ctx.beginPath();ctx.ellipse(W/2,H*.46,unit*13+tapAge*70,unit*12+tapAge*60,0,0,Math.PI*2);ctx.stroke();
}
ctx.globalAlpha=1;
if(!reducedMotion)requestFrame();
}
requestFrame();

let loveWords = initialWords;
let lastWord="",wordSide=0;
function nextLoveWord(){
if(!wordBag.length){
wordBag=loveWords.filter(word=>laneWidth>=160||word.length<=12);
for(let i=wordBag.length-1;i>0;i--){
const j=Math.floor(Math.random()*(i+1));
[wordBag[i],wordBag[j]]=[wordBag[j],wordBag[i]];
}
if(wordBag[wordBag.length-1]===lastWord)[wordBag[0],wordBag[wordBag.length-1]]=[wordBag[wordBag.length-1],wordBag[0]];
}
lastWord=wordBag.pop();
return lastWord;
}
function createLoveWord(){
if(document.hidden||reducedMotion)return;
const side=wordSide++%2?"right":"left";
if(scene.querySelector('.word[data-side="'+side+'"]'))return;
const div=document.createElement("div");
div.className="word";
div.dataset.side=side;
div.setAttribute("aria-hidden","true");
div.textContent=nextLoveWord();
div.style.setProperty("--word-duration",(13+Math.random()*2)+"s");
scene.appendChild(div);
const x=side==="left"?8:W-laneWidth-8;
div.style.left=(x+Math.random()*Math.max(0,laneWidth-div.offsetWidth))+"px";
const top=Math.max(12,Math.min(H*(.62+Math.random()*.18),H-div.offsetHeight-18));
div.style.top=top+"px";
div.style.setProperty("--word-travel",-Math.min(88+Math.random()*44,top-12)+"px");
div.addEventListener("animationend",()=>div.remove(),{once:true});
}
setTimeout(()=>{createLoveWord();setInterval(createLoveWord,8000);},3200);


let wordIndex = 0;
document.getElementById("heartButton").addEventListener("click", () => {
  lastTap = performance.now();
  document.getElementById("reply").textContent = loveWords[wordIndex++ % loveWords.length];
  if (!reducedMotion) {
    for (let i = 0; i < 55; i++) bursts.push({born:lastTap, angle:Math.random()*Math.PI*2, speed:35+Math.random()*120, size:1+Math.random()*2, color:i%3?"#ffc5dc":"#ff6aa5"});
    if (bursts.length > 220) bursts.splice(0, bursts.length - 220);
  }
  onHeart();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { cancelAnimationFrame(frameId); frameId = 0; }
  else requestFrame();
});
motionQuery.addEventListener("change", event => {
  reducedMotion = event.matches;
  scene.querySelectorAll(".word").forEach(word => word.remove());
  bursts.length = 0;
  requestFrame();
});
return {
  setWords(words) { loveWords = words; wordBag = []; wordIndex = 0; scene.querySelectorAll(".word").forEach(word => word.remove()); }
};
}
