// three.js viewer for the 3D preview. Imported lazily by Preview so three.js stays out of the startup bundle.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'

export interface ModelInfo {
  triangles: number
}

export interface MountedModel {
  info: ModelInfo
  dispose(): void
}

/**
 * Parses `data` by extension and renders it into `host` with orbit controls.
 * `resolve` maps relative URIs (a .gltf's buffers and textures) to fetchable URLs.
 */
export async function mountModel(host: HTMLElement, data: ArrayBuffer, ext: string, resolve: (uri: string) => string): Promise<MountedModel> {
  const object = await parse(data, ext, resolve)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.toneMapping = THREE.NeutralToneMapping
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  scene.environment = pmrem.fromScene(room, 0.04).texture
  room.dispose()
  pmrem.dispose()
  // Image-based light only reaches PBR materials; OBJ's Phong needs real lights too.
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000)
  const key = new THREE.DirectionalLight(0xffffff, 1)
  key.position.set(1, 2, 3)
  camera.add(key)
  scene.add(camera, new THREE.HemisphereLight(0xffffff, 0x444444, 0.5), object)

  // Frame the model: centre on its bounds, back off until the bounding sphere fits.
  const box = new THREE.Box3().setFromObject(object)
  const sphere = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 1) : box.getBoundingSphere(new THREE.Sphere())
  const radius = sphere.radius || 1
  const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.3
  camera.near = distance / 100
  camera.far = distance * 100
  camera.position.copy(sphere.center).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(distance))

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(sphere.center)
  controls.minDistance = radius * 0.05
  controls.maxDistance = distance * 10

  // Render on demand: a still model costs nothing while the preview sits open.
  const render = (): void => renderer.render(scene, camera)
  const resize = (): void => {
    const { clientWidth: w, clientHeight: h } = host
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    render()
  }
  controls.addEventListener('change', render)
  controls.update()
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()

  return {
    info: { triangles: countTriangles(object) },
    dispose() {
      observer.disconnect()
      controls.dispose()
      disposeObject(object)
      scene.environment?.dispose()
      renderer.dispose()
      // Chromium caps live WebGL contexts; arrowing through a folder of models must not exhaust them.
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }
}

async function parse(data: ArrayBuffer, ext: string, resolve: (uri: string) => string): Promise<THREE.Object3D> {
  switch (ext) {
    case 'glb':
    case 'gltf': {
      const manager = new THREE.LoadingManager()
      manager.setURLModifier((url) => (/^[a-z][a-z\d+.-]*:/i.test(url) ? url : resolve(url)))
      return (await new GLTFLoader(manager).parseAsync(data, '')).scene
    }
    case 'obj':
      return new OBJLoader().parse(new TextDecoder().decode(data))
    case 'stl': {
      // Facet normals are often written as 0 0 0 – recompute them (flat shading either way).
      const geometry = new STLLoader().parse(data)
      geometry.deleteAttribute('normal')
      return zUp(mesh(geometry))
    }
    case 'ply': {
      const geometry = new PLYLoader().parse(data)
      if (!geometry.index && !geometry.attributes.normal) geometry.computeVertexNormals()
      // A PLY without faces is a point cloud.
      return geometry.index ? mesh(geometry) : new THREE.Points(geometry, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: !!geometry.attributes.color }))
    }
    case '3mf':
      return zUp(new ThreeMFLoader().parse(data))
  }
  throw new Error(`Unsupported model format: ${ext}`)
}

function mesh(geometry: THREE.BufferGeometry): THREE.Mesh {
  if (!geometry.attributes.normal) geometry.computeVertexNormals()
  const vertexColors = !!geometry.attributes.color
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: vertexColors ? 0xffffff : 0x8f96a3, vertexColors, metalness: 0.1, roughness: 0.6 }))
}

/** CAD and 3D-printing formats are Z-up; three.js is Y-up. */
function zUp(object: THREE.Object3D): THREE.Object3D {
  object.rotation.x = -Math.PI / 2
  object.updateMatrixWorld(true)
  return object
}

function countTriangles(object: THREE.Object3D): number {
  let n = 0
  object.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const g = o.geometry as THREE.BufferGeometry
    n += (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3
  })
  return Math.round(n)
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((o) => {
    if (!(o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line)) return
    o.geometry.dispose()
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose()
      m.dispose()
    }
  })
}
