import * as THREE from 'file:///C:/AnimRef/node_modules/three/build/three.module.js';
import fs from 'fs';
const st=await (await fetch('http://127.0.0.1:5179/api/state')).json();
const by=Object.fromEntries(st.rig.bones.map(b=>[b.name,b]));
const T=JSON.parse(fs.readFileSync('C:/AnimRef/animations/game_katana_run.json','utf8')).tracks;
for(const n of ['RightHandIndex1','RightHandIndex2','RightHandIndex3','RightHandMiddle1','RightHandPinky1','RightHandThumb1','RightHandThumb2','RightHandThumb3']){
 const q=new THREE.Quaternion(...T[n].rot[0].slice(1)); const r=new THREE.Quaternion(...by[n].restQ);
 const d=r.clone().invert().multiply(q); if(d.w<0)d.set(-d.x,-d.y,-d.z,-d.w); const ang=2*Math.acos(Math.min(1,d.w)); const s=Math.sqrt(1-d.w*d.w)||1;
 console.log(n,'ang',(ang*180/Math.PI).toFixed(0),'axisLocal',[d.x/s,d.y/s,d.z/s].map(v=>v.toFixed(2)).join(','));}
