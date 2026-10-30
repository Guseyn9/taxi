import * as T from 'three'
import { ROUTE, tripFrame } from './motion'

export function createTripScene(host: HTMLElement) {
  const scene = new T.Scene()
  scene.background = new T.Color('#e9e4df')
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = T.PCFSoftShadowMap
  renderer.domElement.setAttribute('aria-label', '3D: такси и пассажир на демонстрационном маршруте')
  renderer.domElement.setAttribute('role', 'img')
  host.appendChild(renderer.domElement)
  const camera = new T.PerspectiveCamera(38, 1, .1, 200)
  scene.add(new T.HemisphereLight(0xffffff, 0xb6aec7, 2.7))
  const sun = new T.DirectionalLight(0xfff4e5, 3.2)
  sun.position.set(-15, 35, 20); sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 28, bottom: -28 })
  sun.shadow.bias = -.001; scene.add(sun)
  function box(parent: T.Object3D, dimensions: number[], position: number[], color: string) {
    const mesh = new T.Mesh(new T.BoxGeometry(...dimensions as [number, number, number]), new T.MeshStandardMaterial({ color, roughness: .65 }))
    mesh.position.set(...position as [number, number, number]); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh
  }
  box(scene, [42, .6, 29], [0, -.55, 0], '#e0dbcd')
  // Streets follow exactly the same points as the taxi animation.
  ROUTE.slice(1).forEach(([x,z], i) => {
    const [px,pz] = ROUTE[i]
    box(scene, [Math.abs(x-px)+3.8,.06,Math.abs(z-pz)+3.8], [(x+px)/2,-.2,(z+pz)/2], '#fdfcf8')
    const a=new T.Vector3(px,.02,pz),b=new T.Vector3(x,.02,z),dir=b.clone().sub(a)
    const tube=new T.Mesh(new T.CylinderGeometry(.07,.07,dir.length(),8),new T.MeshStandardMaterial({color:'#b51218'}))
    tube.position.copy(a.add(b).multiplyScalar(.5)); tube.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),dir.normalize());scene.add(tube)
  })
  const buildings = [[-15,-7,4,3],[-15,0,3,2],[-2,2,7,3],[-2,-11,6,2],[12,-9,5,3],[13,0,4,2],[-2,11,5,2]]
  buildings.forEach(([x,z,w,h],i)=>{
    box(scene,[w,h,3.5],[x,h/2-.15,z],i%2?'#dcbfa8':'#f4ddbd')
    box(scene,[w+.18,.18,3.7],[x,h-.05,z],'#fff6e9')
    for(let k=-1;k<=1;k++) box(scene,[.35,.65,.04],[x+k*w/3,h*.55,z+1.78],'#597c82')
  })
  function palm(x:number,z:number){
    const trunk=new T.Mesh(new T.CylinderGeometry(.13,.2,2.5,7),new T.MeshStandardMaterial({color:'#a07e59'}));trunk.position.set(x,1,z);scene.add(trunk)
    for(let i=0;i<5;i++){const leaf=new T.Mesh(new T.SphereGeometry(1,8,6),new T.MeshStandardMaterial({color:'#4d8975'}));leaf.scale.set(1.3,.15,.4);leaf.rotation.y=i*Math.PI*2/5;leaf.position.set(x+Math.cos(leaf.rotation.y)*.6,2.25,z-Math.sin(leaf.rotation.y)*.6);scene.add(leaf)}
  }
  ;[[-18,-11],[-11,12],[2,11],[18,-8],[17,11]].forEach(([x,z])=>palm(x,z))
  const car = new T.Group();scene.add(car)
  box(car,[1.7,.6,3.3],[0,.73,0],'#ffbe38')
  box(car,[1.42,.6,1.9],[0,1.28,-.1],'#283044')
  box(car,[1.5,.12,1.9],[0,1.64,-.1],'#ffce60')
  box(car,[.8,.28,.48],[0,1.86,-.1],'#fff8df')
  box(car,[.62,.14,.02],[0,1.87,.15],'#171a23')
  // Front lamps and rear lamps, bumpers, mirrors and four volumetric wheels.
  ;[-.57,.57].forEach(x=>{box(car,[.35,.17,.08],[x,.85,1.68],'#fffceb');box(car,[.3,.16,.08],[x,.85,-1.68],'#d54f5a')})
  box(car,[1.6,.15,.12],[0,.48,1.67],'#d8d9df')
  ;[-1,1].forEach(side=>{
    box(car,[.2,.16,.32],[side*.91,1.18,.42],'#ffbe38')
    ;[-1.08,1.08].forEach(z=>{const wheel=new T.Mesh(new T.CylinderGeometry(.38,.38,.22,20),new T.MeshStandardMaterial({color:'#2b2b2b'}));wheel.rotation.z=Math.PI/2;wheel.position.set(side*.84,.42,z);wheel.castShadow=true;car.add(wheel)})
    for(let j=0;j<7;j++)box(car,[.012,.13,.2],[side*.86,.85,-.7+j*.22],j%2?'#ffbe38':'#2b2b2b')
  })
  const person = new T.Group();scene.add(person)
  const skin=new T.MeshStandardMaterial({color:'#b67d58'})
  const head=new T.Mesh(new T.SphereGeometry(.29,16,12),skin);head.position.y=1.77;head.castShadow=true;person.add(head)
  box(person,[.58,.68,.32],[0,1.12,0],'#b51218')
  ;[-1,1].forEach(side=>{box(person,[.19,.65,.22],[side*.18,.46,0],'#263348');box(person,[.17,.6,.18],[side*.4,1.04,0],'#b67d58');box(person,[.22,.14,.4],[side*.18,.1,.08],'#fff9ee')})
  box(person,[.32,.46,.22],[.58,.43,0],'#e87516')
  function ring(x:number,z:number,color:string){const m=new T.Mesh(new T.TorusGeometry(.7,.08,8,32),new T.MeshStandardMaterial({color}));m.rotation.x=-Math.PI/2;m.position.set(x,.08,z);scene.add(m)}
  ring(-8,10,'#b51218');ring(16,8,'#e87516')
  let view='perspective'
  function resize(){const w=host.clientWidth,h=host.clientHeight; renderer.setSize(w,h);camera.aspect=w/Math.max(h,1);camera.updateProjectionMatrix()}
  const observer=new ResizeObserver(resize);observer.observe(host);resize()
  return {
    render(time:number){const f=tripFrame(time);car.position.set(f.x,0,f.z);car.rotation.y=f.angle;person.visible=!f.boarded;person.position.set(f.phase===3?16:-8,0,f.phase===3?8:10)
      const scale=camera.aspect<1?1.55:1
      if(view==='follow'){camera.position.set(f.x+7*scale,8*scale,f.z+10*scale);camera.lookAt(f.x,.7,f.z)}
      else {camera.position.set(view==='top'?0:30*scale,view==='top'?54*scale:34*scale,view==='top'?.1:38*scale);camera.lookAt(0,0,0)}
      renderer.render(scene,camera)
    },
    setView(value:string){view=value},
    dispose(){observer.disconnect();scene.traverse(obj=>{if(obj instanceof T.Mesh){obj.geometry.dispose();(Array.isArray(obj.material)?obj.material:[obj.material]).forEach(m=>m.dispose())}});renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove()},
  }
}
