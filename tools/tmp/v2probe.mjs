import * as THREE from 'file:///C:/AnimRef/node_modules/three/build/three.module.js';
const BASE='http://127.0.0.1:5179';
const st=await (await fetch(BASE+'/api/state')).json();
const bones=st.rig.bones; const by=Object.fromEntries(bones.map(b=>[b.name,b]));
const V=(x,y,z)=>new THREE.Vector3(x,y,z), Q=a=>new THREE.Quaternion(...a);
const restW={},restPos={};
for(const b of bones){const q=Q(b.restQ); if(!b.parent){restW[b.name]=q;restPos[b.name]=V(...b.restP);} else {restW[b.name]=restW[b.parent].clone().multiply(q);restPos[b.name]=restPos[b.parent].clone().add(V(...b.restP).applyQuaternion(restW[b.parent]));}}
for(const n of ['Hips','Spine02','Spine01','Spine','neck','Head','LeftShoulder','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand','RightHandIndex1','RightHandIndex3','RightHandPinky1','RightHandThumb1','RightUpLeg','RightLeg','RightFoot','RightToeBase','LeftFoot']) console.log(n, restPos[n].toArray().map(v=>+v.toFixed(3)).join(','));
console.log('L1',V(...by.RightLeg.restP).length(),'L2',V(...by.RightFoot.restP).length());
console.log(JSON.stringify(st.anim?.name), st.props.map(p=>p.id));
const rad=THREE.MathUtils.degToRad,deg=THREE.MathUtils.radToDeg;
const restDir=(bone,child)=>V(...by[child].restP).applyQuaternion(restW[bone]).normalize();
const pr=st.props.find(p=>p.id==='katana').rot;
const Qp=new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(pr[0]),rad(pr[1]),rad(pr[2]),'XYZ'));
const b0=V(0,0,1).applyQuaternion(Qp).normalize(); const fr0=restDir('RightForeArm','RightHand');
console.log('b0',b0.toArray().map(v=>+v.toFixed(3)),'fr0',fr0.toArray().map(v=>+v.toFixed(3)),'angle',deg(b0.angleTo(fr0)));
const u0=restDir('RightArm','RightForeArm');console.log('u0',u0.toArray().map(v=>+v.toFixed(3)),'rest elbow bend',deg(u0.angleTo(fr0)));
for(const W of [0,10,14]){const nW=b0.clone().cross(fr0).normalize();const b1=b0.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(nW,rad(W)));console.log('WRIST',W,'alpha',deg(Math.acos(fr0.dot(b1))));}
console.log('upperArm len',V(...by.RightForeArm.restP).length(),'fore',V(...by.RightHand.restP).length());
console.log(JSON.stringify(st.props));
