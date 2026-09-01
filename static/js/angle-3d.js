import * as THREE from '/static/vendor/js/three-0.160.0.module.js?v=2026.07.25.1';

const controllerByRoot = new WeakMap();
const FALLBACK_CAMERA_COPY = Object.freeze({
    'studio.cameraRight':'right',
    'studio.cameraLeft':'left',
    'studio.cameraTop':'top view',
    'studio.cameraBottom':'low-angle view',
});
const tr = key => window.StudioI18n ? window.StudioI18n.t(key) : (FALLBACK_CAMERA_COPY[key] || key);
const trf = (key, values) => {
    if(window.StudioI18n?.format) return window.StudioI18n.format(key, values);
    if(key === 'studio.cameraRotate') return `rotate ${values.degrees}° ${values.direction}`;
    if(key === 'studio.cameraPitch') return `${values.direction} ${values.degrees}°`;
    if(key === 'studio.cameraCommand') return `Camera: ${values.instructions}`;
    return tr(key);
};

function number(value, fallback) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function valueOf(control, fallback) {
    return number(control?.value ?? control?.getAttribute?.('value'), fallback);
}
function setValue(control, value) {
    if(!control) return;
    control.value = String(value);
    control.setAttribute('value', String(value));
}

export function angleDistanceConcept(distance) {
    const value = Math.max(0.1, Math.min(8, number(distance, 4)));
    if(value <= 1.5) return 'Extreme close-up';
    if(value <= 3) return 'Close-up';
    if(value <= 3.9) return 'Medium close-up';
    if(Math.abs(value - 4) < 0.0001) return '';
    if(value <= 5) return 'Medium long shot';
    if(value <= 6.5) return 'Wide long shot';
    return 'Extreme long shot';
}

export function angleCameraCommand(horizontal=0, vertical=0, distance=4) {
    const parts = [];
    horizontal = number(horizontal, 0);
    vertical = number(vertical, 0);
    distance = number(distance, 4);
    if(horizontal !== 0) {
        const direction = tr(horizontal > 0 ? 'studio.cameraRight' : 'studio.cameraLeft');
        parts.push(trf('studio.cameraRotate', {direction, degrees:Math.abs(horizontal)}));
    }
    if(vertical !== 0) {
        const direction = tr(vertical > 0 ? 'studio.cameraTop' : 'studio.cameraBottom');
        parts.push(trf('studio.cameraPitch', {direction, degrees:Math.abs(vertical)}));
    }
    const distanceConcept = angleDistanceConcept(distance);
    if(distanceConcept) parts.push(distanceConcept);
    return parts.length
        ? trf('studio.cameraCommand', {
            instructions:parts.join(window.StudioI18n?.lang?.() === 'en' ? ', ' : '，')
        })
        : '';
}

export function replaceOwnedCameraCommand(prompt='', command='', suffix='') {
    const suffixText = String(suffix || '').trim();
    const originalLines = String(prompt || '').split(/\r?\n/);
    const hasSuffix = Boolean(suffixText) && originalLines.some(line => line.trim() === suffixText);
    const lines = hasSuffix
        ? originalLines.filter(line => line.trim() !== suffixText)
        : originalLines;
    const ownedIndex = lines.findIndex(line => /^\s*(?:将相机|Camera:)\s*/i.test(line));
    if(ownedIndex >= 0) {
        if(command) lines[ownedIndex] = command;
        else lines.splice(ownedIndex, 1);
    } else if(command) {
        lines.push(command);
    }
    if(hasSuffix) lines.push(suffixText);
    return lines.join('\n').trim();
}

function createGrid(size, divisions) {
    const half = size / 2;
    const step = size / divisions;
    const center = divisions / 2;
    const majorPositions = [];
    const minorPositions = [];
    for(let index = 0; index <= divisions; index += 1) {
        const position = -half + index * step;
        const target = index === center ? majorPositions : minorPositions;
        target.push(-half, 0, position, half, 0, position);
        target.push(position, 0, -half, position, 0, half);
    }
    const group = new THREE.Group();
    [
        {positions:minorPositions, opacity:0.5},
        {positions:majorPositions, opacity:0.6},
    ].forEach(({positions, opacity}) => {
        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({
            color:0xffffff, transparent:true, opacity, depthWrite:false,
        });
        group.add(new THREE.LineSegments(lineGeometry, material));
    });
    return group;
}

function find(root, selector, legacyId='') {
    return root?.querySelector?.(selector) || (legacyId ? document.getElementById(legacyId) : null);
}

export function createAngleCameraController(root, options={}) {
    if(!root) return null;
    if(controllerByRoot.has(root)) return controllerByRoot.get(root);
    const container = find(root, '[data-angle-viewport]', 'threeContainer');
    const sliderH = find(root, '[data-angle-horizontal]', 'rotate-h');
    const sliderV = find(root, '[data-angle-vertical]', 'rotate-v');
    const sliderD = find(root, '[data-angle-distance]', 'distance');
    const valH = find(root, '[data-angle-horizontal-value]', 'val-horizontal');
    const valV = find(root, '[data-angle-vertical-value]', 'val-vertical');
    const valD = find(root, '[data-angle-distance-value]', 'val-distance');
    const promptInput = options.promptInput || find(root, '[data-angle-prompt]', 'promptInput');
    if(!container || !sliderH || !sliderV || !sliderD || !promptInput) return null;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.replaceChildren(renderer.domElement);
    let geometry = new THREE.PlaneGeometry(3, 3);
    const plane = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color:0x444444, side:THREE.DoubleSide,
    }));
    scene.add(plane);
    scene.add(createGrid(20, 20));
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const pointLight = new THREE.DirectionalLight(0xffffff, 1);
    pointLight.position.set(5, 10, 7);
    scene.add(pointLight);

    let disposed = false;
    let animationFrame = 0;
    let texture = null;
    const listeners = [];
    const on = (target, type, listener) => {
        target?.addEventListener(type, listener);
        if(target) listeners.push(() => target.removeEventListener(type, listener));
    };
    const state = () => ({
        horizontal:valueOf(sliderH, 0),
        vertical:valueOf(sliderV, 0),
        distance:valueOf(sliderD, 4),
    });
    const notify = detail => root.dispatchEvent(new CustomEvent('angle-controller-change', {
        bubbles:true, composed:true, detail
    }));
    const update = ({syncFields=true, updatePrompt=true}={}) => {
        const current = state();
        if(syncFields) {
            setValue(valH, current.horizontal);
            setValue(valV, current.vertical);
            setValue(valD, current.distance.toFixed(1));
        }
        sliderH.setAttribute('value-text', `${current.horizontal}°`);
        sliderV.setAttribute('value-text', `${current.vertical}°`);
        sliderD.setAttribute('value-text', current.distance.toFixed(1));
        const phi = THREE.MathUtils.degToRad(90 - current.vertical);
        const theta = THREE.MathUtils.degToRad(current.horizontal);
        camera.position.set(
            current.distance * Math.sin(phi) * Math.sin(theta),
            current.distance * Math.cos(phi),
            current.distance * Math.sin(phi) * Math.cos(theta),
        );
        camera.lookAt(0, 0, 0);
        const command = angleCameraCommand(current.horizontal, current.vertical, current.distance);
        if(updatePrompt) promptInput.value = replaceOwnedCameraCommand(promptInput.value, command, options.promptSuffix);
        const detail = {...current, command, prompt:String(promptInput.value || '')};
        notify(detail);
        return detail;
    };
    const syncNumber = (numberInput, slider, fallback) => {
        setValue(slider, valueOf(numberInput, fallback));
        update({syncFields:true});
    };
    [[sliderH,valH],[sliderV,valV],[sliderD,valD]].forEach(([slider, numberInput]) => {
        on(slider, 'input', () => update({syncFields:true}));
        on(numberInput, 'input', () => syncNumber(numberInput, slider, valueOf(slider, 0)));
    });
    const reset = (slider, numberInput, value) => {
        setValue(slider, value); setValue(numberInput, value); update({syncFields:true});
    };
    on(find(root, '[data-angle-reset-horizontal]', 'resetHorizontal'), 'click', () => reset(sliderH, valH, 0));
    on(find(root, '[data-angle-reset-vertical]', 'resetVertical'), 'click', () => reset(sliderV, valV, 0));
    on(find(root, '[data-angle-reset-distance]', 'resetDistance'), 'click', () => reset(sliderD, valD, 4));
    on(promptInput, 'input', () => {
        const current = state();
        notify({...current, command:angleCameraCommand(current.horizontal,current.vertical,current.distance), prompt:String(promptInput.value || '')});
    });

    const resize = () => {
        if(disposed) return;
        const width = Math.max(1, container.clientWidth);
        const height = Math.max(1, container.clientHeight);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const animate = () => {
        if(disposed) return;
        renderer.render(scene, camera);
        animationFrame = window.requestAnimationFrame(animate);
    };
    const setTexture = url => {
        if(!url) return;
        new THREE.TextureLoader().load(url, nextTexture => {
            if(disposed) { nextTexture.dispose(); return; }
            texture?.dispose?.();
            texture = nextTexture;
            texture.colorSpace = THREE.SRGBColorSpace;
            const aspect = texture.image.width / texture.image.height;
            geometry.dispose();
            geometry = aspect > 1 ? new THREE.PlaneGeometry(3, 3 / aspect) : new THREE.PlaneGeometry(3 * aspect, 3);
            plane.geometry = geometry;
            plane.material.dispose();
            plane.material = new THREE.MeshBasicMaterial({map:texture, side:THREE.DoubleSide});
            resize();
        });
    };
    const controller = {
        update, state, setTexture,
        reset(){ setValue(sliderH,0); setValue(sliderV,0); setValue(sliderD,4); return update({syncFields:true}); },
        dispose(){
            if(disposed) return;
            disposed = true;
            controllerByRoot.delete(root);
            listeners.splice(0).forEach(remove => remove());
            observer.disconnect();
            window.cancelAnimationFrame(animationFrame);
            texture?.dispose?.(); geometry.dispose(); plane.material.dispose(); renderer.dispose();
            renderer.domElement.remove();
        }
    };
    controllerByRoot.set(root, controller);
    resize(); update(); animate();
    if(options.sourceImage) setTexture(options.sourceImage);
    return controller;
}

await Promise.all([
    customElements.whenDefined('ic-slider'),
    customElements.whenDefined('ic-number-input'),
]);

const standaloneRoot = document.querySelector('.camera-layout');
if(standaloneRoot) {
    const standalone = createAngleCameraController(standaloneRoot, {promptInput:document.getElementById('promptInput')});
    window.update3DTexture = url => standalone?.setTexture(url);
}
