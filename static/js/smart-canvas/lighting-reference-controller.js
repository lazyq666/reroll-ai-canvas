import * as THREE from '/static/vendor/js/three-0.160.0.module.js?v=2026.07.25.1';
import './lighting-intent.js';

const Lighting = globalThis.InfiniteCanvasLightingIntent;
const controllerByRoot = new WeakMap();
const KEY_LIGHT_SAMPLE_OFFSETS = Object.freeze([
    Object.freeze([0, 0]),
    Object.freeze([-0.72, -0.72]),
    Object.freeze([0, -0.72]),
    Object.freeze([0.72, -0.72]),
    Object.freeze([-0.72, 0]),
    Object.freeze([0.72, 0]),
    Object.freeze([-0.72, 0.72]),
    Object.freeze([0, 0.72]),
    Object.freeze([0.72, 0.72])
]);

function find(root, selector) {
    return root?.querySelector?.(selector) || null;
}
function numericValue(control, fallback=0) {
    const value = Number(control?.value ?? control?.getAttribute?.('value'));
    return Number.isFinite(value) ? value : fallback;
}
function setValue(control, value) {
    if(!control) return;
    control.value = String(value);
    control.setAttribute('value', String(value));
}
function evIntensity(value, base=1) {
    return base * (2 ** Number(value || 0));
}

function createLightingScene(width=1024, height=768) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x303238);
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 2.7, 7);
    camera.lookAt(0, 1.12, 0);

    const floorMaterial = new THREE.MeshStandardMaterial({color:0x8b8d91, roughness:0.86, metalness:0});
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const referenceMaterial = new THREE.MeshPhysicalMaterial({
        color:0x85878b,
        roughness:0.58,
        metalness:0,
        clearcoat:0.85,
        clearcoatRoughness:0.08
    });
    const referenceBall = new THREE.Mesh(new THREE.SphereGeometry(1.3, 96, 64), referenceMaterial);
    referenceBall.position.set(0, 1.32, 0);
    referenceBall.castShadow = true;
    referenceBall.receiveShadow = true;
    scene.add(referenceBall);

    const target = new THREE.Object3D();
    target.position.set(0, 1.15, 0);
    scene.add(target);
    const keySamples = KEY_LIGHT_SAMPLE_OFFSETS.map(offset => {
        const key = new THREE.DirectionalLight(0xffffff, 2.8 / KEY_LIGHT_SAMPLE_OFFSETS.length);
        key.castShadow = true;
        key.target = target;
        key.shadow.mapSize.set(512, 512);
        key.shadow.camera.left = -5;
        key.shadow.camera.right = 5;
        key.shadow.camera.top = 5;
        key.shadow.camera.bottom = -3;
        key.shadow.camera.near = 0.1;
        key.shadow.camera.far = 30;
        key.shadow.bias = -0.00035;
        key.userData.lightingSampleOffset = offset;
        scene.add(key);
        return key;
    });
    const key = keySamples[0];
    const ambient = new THREE.AmbientLight(0xffffff, 0.18);
    scene.add(ambient);

    const gizmoMaterial = new THREE.MeshBasicMaterial({color:0xffd166});
    const gizmo = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 24), gizmoMaterial);
    scene.add(gizmo);
    const rayMaterial = new THREE.LineDashedMaterial({color:0xffd166, dashSize:0.18, gapSize:0.12, transparent:true, opacity:0.86});
    const rayGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const ray = new THREE.Line(rayGeometry, rayMaterial);
    ray.computeLineDistances();
    scene.add(ray);

    return {scene, camera, key, keySamples, ambient, target, gizmo, ray, rayGeometry};
}
function configureRenderer(renderer, width, height) {
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
}
function disposeScene(bundle) {
    bundle.scene.traverse(object => {
        object.geometry?.dispose?.();
        if(Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.());
        else object.material?.dispose?.();
    });
}
function applyIntent(bundle, intent, {showGizmo=true}={}) {
    const normalized = Lighting.normalizeLightingIntent(intent);
    const light = normalized.lights[0];
    const direction = Lighting.lightingDirectionVector(normalized);
    const centerDirection = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    const referenceAxis = Math.abs(centerDirection.y) < 0.92
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
    const tangent = new THREE.Vector3().crossVectors(referenceAxis, centerDirection).normalize();
    const bitangent = new THREE.Vector3().crossVectors(centerDirection, tangent).normalize();
    const angularRadius = THREE.MathUtils.degToRad(light.angular_size_degrees / 2);
    const sampleExtent = Math.tan(angularRadius);
    const resolvedColor = Lighting.resolvedLightColor(normalized);
    const sampleIntensity = evIntensity(light.relative_exposure_ev, 2.8) / bundle.keySamples.length;
    bundle.keySamples.forEach(sample => {
        const [u, v] = sample.userData.lightingSampleOffset;
        const sampleDirection = centerDirection.clone()
            .addScaledVector(tangent, u * sampleExtent)
            .addScaledVector(bitangent, v * sampleExtent)
            .normalize();
        const samplePosition = sampleDirection.multiplyScalar(7);
        samplePosition.y += 1.15;
        sample.position.copy(samplePosition);
        sample.color.set(resolvedColor);
        sample.intensity = sampleIntensity;
        sample.castShadow = light.casts_shadow;
    });
    const position = centerDirection.clone().multiplyScalar(7);
    position.y += 1.15;
    bundle.ambient.intensity = evIntensity(normalized.environment.relative_exposure_ev, 0.72);
    bundle.gizmo.visible = showGizmo;
    bundle.ray.visible = showGizmo;
    bundle.gizmo.position.copy(position);
    bundle.ray.geometry.setFromPoints([position, bundle.target.position]);
    bundle.ray.computeLineDistances();
    return normalized;
}

export function createLightingReferenceController(root, options={}) {
    if(!root) return null;
    if(controllerByRoot.has(root)) return controllerByRoot.get(root);
    const viewport = find(root, '[data-lighting-viewport]');
    if(!viewport || !Lighting) return null;
    const controls = {
        azimuth:find(root, '[data-lighting-azimuth-value]'),
        azimuthSlider:find(root, '[data-lighting-azimuth]'),
        elevation:find(root, '[data-lighting-elevation-value]'),
        elevationSlider:find(root, '[data-lighting-elevation]'),
        colorMode:find(root, '[data-lighting-color-mode]'),
        temperature:find(root, '[data-lighting-temperature-value]'),
        temperatureSlider:find(root, '[data-lighting-temperature]'),
        rgb:find(root, '[data-lighting-rgb]'),
        keyExposure:find(root, '[data-lighting-key-exposure-value]'),
        keyExposureSlider:find(root, '[data-lighting-key-exposure]'),
        ambientExposure:find(root, '[data-lighting-ambient-exposure-value]'),
        ambientExposureSlider:find(root, '[data-lighting-ambient-exposure]'),
        angularSize:find(root, '[data-lighting-angular-size-value]'),
        angularSizeSlider:find(root, '[data-lighting-angular-size]'),
        castsShadow:find(root, '[data-lighting-casts-shadow]'),
        promptZh:find(root, '[data-lighting-prompt-zh]'),
        promptEn:find(root, '[data-lighting-prompt-en]')
    };
    let intent = Lighting.normalizeLightingIntent(options.intent || Lighting.defaultLightingIntent());
    let disposed = false;
    let animationFrame = 0;
    let dragging = null;
    const listeners = [];
    const bundle = createLightingScene();
    const renderer = new THREE.WebGLRenderer({antialias:true, alpha:false});
    configureRenderer(renderer, Math.max(1, viewport.clientWidth), Math.max(1, viewport.clientHeight));
    viewport.replaceChildren(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', window.StudioI18n?.t?.('smart.lightingControlSphere') || 'Draggable lighting control');

    const on = (target, type, listener, listenerOptions) => {
        target?.addEventListener(type, listener, listenerOptions);
        if(target) listeners.push(() => target.removeEventListener(type, listener, listenerOptions));
    };
    const scheduleRender = () => {
        if(disposed || animationFrame) return;
        animationFrame = requestAnimationFrame(() => {
            animationFrame = 0;
            if(!disposed) renderer.render(bundle.scene, bundle.camera);
        });
    };
    const updatePreview = () => {
        intent = applyIntent(bundle, intent, {showGizmo:true});
        scheduleRender();
    };
    const writeControls = () => {
        const light = intent.lights[0];
        setValue(controls.azimuth, light.azimuth_degrees);
        setValue(controls.azimuthSlider, light.azimuth_degrees);
        setValue(controls.elevation, light.elevation_degrees);
        setValue(controls.elevationSlider, light.elevation_degrees);
        setValue(controls.colorMode, light.color_mode);
        setValue(controls.temperature, light.temperature_kelvin);
        setValue(controls.temperatureSlider, light.temperature_kelvin);
        setValue(controls.rgb, light.rgb);
        setValue(controls.keyExposure, light.relative_exposure_ev);
        setValue(controls.keyExposureSlider, light.relative_exposure_ev);
        setValue(controls.ambientExposure, intent.environment.relative_exposure_ev);
        setValue(controls.ambientExposureSlider, intent.environment.relative_exposure_ev);
        setValue(controls.angularSize, light.angular_size_degrees);
        setValue(controls.angularSizeSlider, light.angular_size_degrees);
        if(controls.castsShadow) controls.castsShadow.checked = light.casts_shadow;
        root.dataset.lightingColorMode = light.color_mode;
        const prompts = Lighting.compileLightingPrompts(intent);
        if(controls.promptZh) controls.promptZh.value = prompts.zh;
        if(controls.promptEn) controls.promptEn.value = prompts.en;
    };
    const notify = () => {
        const prompts = Lighting.compileLightingPrompts(intent);
        root.dispatchEvent(new CustomEvent('lighting-controller-change', {
            bubbles:true,
            composed:true,
            detail:{intent:Lighting.normalizeLightingIntent(intent), prompts}
        }));
    };
    const commit = next => {
        intent = Lighting.normalizeLightingIntent(next);
        writeControls();
        updatePreview();
        notify();
        return intent;
    };
    const patchLight = patch => commit({
        ...intent,
        lights:[{...intent.lights[0], ...patch}]
    });
    const patchEnvironment = patch => commit({
        ...intent,
        environment:{...intent.environment, ...patch}
    });
    const pair = (numberControl, sliderControl, key, fallback) => {
        on(numberControl, 'input', () => patchLight({[key]:numericValue(numberControl, fallback)}));
        on(sliderControl, 'input', () => patchLight({[key]:numericValue(sliderControl, fallback)}));
    };
    pair(controls.azimuth, controls.azimuthSlider, 'azimuth_degrees', -45);
    pair(controls.elevation, controls.elevationSlider, 'elevation_degrees', 35);
    pair(controls.temperature, controls.temperatureSlider, 'temperature_kelvin', 4200);
    pair(controls.keyExposure, controls.keyExposureSlider, 'relative_exposure_ev', 0);
    pair(controls.angularSize, controls.angularSizeSlider, 'angular_size_degrees', 8);
    on(controls.ambientExposure, 'input', () => patchEnvironment({relative_exposure_ev:numericValue(controls.ambientExposure, -2)}));
    on(controls.ambientExposureSlider, 'input', () => patchEnvironment({relative_exposure_ev:numericValue(controls.ambientExposureSlider, -2)}));
    on(controls.colorMode, 'ic-change', event => patchLight({
        color_mode:String(event.detail?.value || controls.colorMode.getAttribute('value') || '')
    }));
    on(controls.rgb, 'input', () => patchLight({rgb:String(controls.rgb.value || '')}));
    on(controls.rgb, 'change', () => patchLight({rgb:String(controls.rgb.value || '')}));
    on(controls.castsShadow, 'change', () => patchLight({casts_shadow:Boolean(controls.castsShadow.checked)}));
    on(find(root, '[data-lighting-reset-direction]'), 'click', () => patchLight({azimuth_degrees:-45,elevation_degrees:35}));

    const onPointerMove = event => {
        if(!dragging || disposed) return;
        const deltaX = event.clientX - dragging.x;
        const deltaY = event.clientY - dragging.y;
        patchLight({
            azimuth_degrees:dragging.azimuth + deltaX * 0.45,
            elevation_degrees:dragging.elevation - deltaY * 0.32
        });
    };
    const endDrag = event => {
        if(!dragging) return;
        renderer.domElement.releasePointerCapture?.(event.pointerId);
        dragging = null;
        viewport.dataset.dragging = 'false';
    };
    on(renderer.domElement, 'pointerdown', event => {
        if(event.button !== 0) return;
        event.preventDefault();
        const light = intent.lights[0];
        dragging = {x:event.clientX,y:event.clientY,azimuth:light.azimuth_degrees,elevation:light.elevation_degrees};
        renderer.domElement.setPointerCapture?.(event.pointerId);
        viewport.dataset.dragging = 'true';
    });
    on(renderer.domElement, 'pointermove', onPointerMove);
    on(renderer.domElement, 'pointerup', endDrag);
    on(renderer.domElement, 'pointercancel', endDrag);

    const resize = () => {
        if(disposed) return;
        const width = Math.max(1, viewport.clientWidth);
        const height = Math.max(1, viewport.clientHeight);
        bundle.camera.aspect = width / height;
        bundle.camera.updateProjectionMatrix();
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height, false);
        scheduleRender();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);

    const controller = {
        state:() => Lighting.normalizeLightingIntent(intent),
        setIntent:value => commit(value),
        dispose() {
            if(disposed) return;
            disposed = true;
            controllerByRoot.delete(root);
            listeners.splice(0).forEach(remove => remove());
            observer.disconnect();
            if(animationFrame) cancelAnimationFrame(animationFrame);
            animationFrame = 0;
            disposeScene(bundle);
            renderer.dispose();
            renderer.forceContextLoss?.();
            renderer.domElement.remove();
            viewport.dataset.dragging = 'false';
        }
    };
    controllerByRoot.set(root, controller);
    writeControls();
    updatePreview();
    resize();
    notify();
    return controller;
}
