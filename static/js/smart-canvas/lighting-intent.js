(function installInfiniteCanvasLightingIntent(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.InfiniteCanvasLightingIntent = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createLightingIntentApi() {
    'use strict';

    const SCHEMA = 'ic-lighting-intent/1';
    const COMPILER_VERSION = 'lighting-prompt/2';
    const COORDINATE_SPACE = Object.freeze({
        reference:'camera',
        x:'camera_right',
        y:'camera_up',
        z:'toward_camera',
        angle_unit:'degree'
    });
    const DEFAULT_LIGHT = Object.freeze({
        id:'key',
        role:'key',
        type:'directional',
        azimuth_degrees:-45,
        elevation_degrees:35,
        color_mode:'temperature',
        temperature_kelvin:4200,
        rgb:'#ffd7b3',
        relative_exposure_ev:0,
        angular_size_degrees:8,
        casts_shadow:true
    });
    const DEFAULT_INTENT = Object.freeze({
        schema:SCHEMA,
        coordinate_space:COORDINATE_SPACE,
        environment:Object.freeze({relative_exposure_ev:-2}),
        lights:Object.freeze([DEFAULT_LIGHT]),
        compiler_version:COMPILER_VERSION
    });

    function finite(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }
    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }
    function round(value, precision=2) {
        const scale = 10 ** precision;
        return Math.round((value + Number.EPSILON) * scale) / scale;
    }
    function bounded(value, fallback, minimum, maximum, precision=2) {
        return round(clamp(finite(value, fallback), minimum, maximum), precision);
    }
    function normalizeHex(value, fallback=DEFAULT_LIGHT.rgb) {
        const raw = String(value || '').trim().toLowerCase();
        const short = /^#?([0-9a-f]{3})$/i.exec(raw);
        if (short) return `#${[...short[1]].map(character => character + character).join('')}`;
        const full = /^#?([0-9a-f]{6})$/i.exec(raw);
        return full ? `#${full[1]}` : fallback;
    }
    function normalizeLightingIntent(value={}) {
        const source = value && typeof value === 'object' ? value : {};
        const sourceLight = Array.isArray(source.lights) && source.lights[0]
            ? source.lights[0]
            : source.light || {};
        const colorMode = sourceLight.color_mode === 'rgb' ? 'rgb' : 'temperature';
        return {
            schema:SCHEMA,
            coordinate_space:{...COORDINATE_SPACE},
            environment:{
                relative_exposure_ev:bounded(
                    source.environment?.relative_exposure_ev,
                    DEFAULT_INTENT.environment.relative_exposure_ev,
                    -8,
                    4,
                    1
                )
            },
            lights:[{
                id:'key',
                role:'key',
                type:'directional',
                azimuth_degrees:bounded(sourceLight.azimuth_degrees, DEFAULT_LIGHT.azimuth_degrees, -180, 180, 1),
                elevation_degrees:bounded(sourceLight.elevation_degrees, DEFAULT_LIGHT.elevation_degrees, -10, 90, 1),
                color_mode:colorMode,
                temperature_kelvin:Math.round(bounded(sourceLight.temperature_kelvin, DEFAULT_LIGHT.temperature_kelvin, 2000, 10000, 0)),
                rgb:normalizeHex(sourceLight.rgb),
                relative_exposure_ev:bounded(sourceLight.relative_exposure_ev, DEFAULT_LIGHT.relative_exposure_ev, -6, 6, 1),
                angular_size_degrees:bounded(sourceLight.angular_size_degrees, DEFAULT_LIGHT.angular_size_degrees, 0.5, 30, 1),
                casts_shadow:sourceLight.casts_shadow !== false
            }],
            compiler_version:COMPILER_VERSION
        };
    }
    function defaultLightingIntent() {
        return normalizeLightingIntent(DEFAULT_INTENT);
    }
    function keyLight(intent) {
        return normalizeLightingIntent(intent).lights[0];
    }
    function lightingDirectionVector(intentOrLight) {
        const light = intentOrLight?.lights ? keyLight(intentOrLight) : normalizeLightingIntent({lights:[intentOrLight]}).lights[0];
        const azimuth = light.azimuth_degrees * Math.PI / 180;
        const elevation = light.elevation_degrees * Math.PI / 180;
        const horizontal = Math.cos(elevation);
        return Object.freeze({
            x:round(Math.sin(azimuth) * horizontal, 6),
            y:round(Math.sin(elevation), 6),
            z:round(Math.cos(azimuth) * horizontal, 6)
        });
    }
    function temperatureToRgb(kelvin) {
        const temperature = clamp(finite(kelvin, DEFAULT_LIGHT.temperature_kelvin), 1000, 40000) / 100;
        let red;
        let green;
        let blue;
        if (temperature <= 66) {
            red = 255;
            green = 99.4708025861 * Math.log(temperature) - 161.1195681661;
            blue = temperature <= 19 ? 0 : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
        } else {
            red = 329.698727446 * ((temperature - 60) ** -0.1332047592);
            green = 288.1221695283 * ((temperature - 60) ** -0.0755148492);
            blue = 255;
        }
        const channel = value => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');
        return `#${channel(red)}${channel(green)}${channel(blue)}`;
    }
    function resolvedLightColor(intent) {
        const light = keyLight(intent);
        return light.color_mode === 'rgb' ? light.rgb : temperatureToRgb(light.temperature_kelvin);
    }
    function directionBucket(azimuth) {
        if (azimuth >= -22.5 && azimuth < 22.5) return 'front';
        if (azimuth >= 22.5 && azimuth < 67.5) return 'front-right';
        if (azimuth >= 67.5 && azimuth < 112.5) return 'right';
        if (azimuth >= 112.5 && azimuth < 157.5) return 'rear-right';
        if (azimuth >= 157.5 || azimuth < -157.5) return 'rear';
        if (azimuth >= -157.5 && azimuth < -112.5) return 'rear-left';
        if (azimuth >= -112.5 && azimuth < -67.5) return 'left';
        return 'front-left';
    }
    function heightBucket(elevation) {
        if (elevation < 0) return 'below';
        if (elevation < 15) return 'eye-level';
        if (elevation < 45) return 'raised';
        if (elevation < 70) return 'high';
        return 'overhead';
    }
    function heightDescription(bucket, language) {
        const descriptions = language === 'zh'
            ? {
                below:'位于主体下方',
                'eye-level':'接近平视高度',
                raised:'高于眼平线',
                high:'位于主体高处',
                overhead:'接近主体正上方'
            }
            : {
                below:'below the subject',
                'eye-level':'near eye level',
                raised:'raised above eye level',
                high:'high above the subject',
                overhead:'near-overhead'
            };
        return descriptions[bucket];
    }
    function sourcePositionDescription(direction, height, language) {
        const vertical = heightDescription(height, language);
        if (language === 'zh') {
            const descriptions = {
                front:`来自接近画面中央的相机方向、${vertical}`,
                'front-left':`来自画面左侧、${vertical}且稍微靠近相机`,
                left:`来自画面左侧的主体侧方、${vertical}`,
                'rear-left':`来自画面左侧、${vertical}且稍微位于主体后方`,
                rear:`来自主体后方并接近画面中央、${vertical}`,
                'rear-right':`来自画面右侧、${vertical}且稍微位于主体后方`,
                right:`来自画面右侧的主体侧方、${vertical}`,
                'front-right':`来自画面右侧、${vertical}且稍微靠近相机`
            };
            return descriptions[direction];
        }
        const descriptions = {
            front:`coming from near image-center, ${vertical} and toward the camera`,
            'front-left':`coming from image-left, ${vertical} and slightly toward the camera`,
            left:`coming from image-left at the subject's side, ${vertical}`,
            'rear-left':`coming from image-left, ${vertical} and slightly behind the subject`,
            rear:`coming from behind the subject near image-center, ${vertical}`,
            'rear-right':`coming from image-right, ${vertical} and slightly behind the subject`,
            right:`coming from image-right at the subject's side, ${vertical}`,
            'front-right':`coming from image-right, ${vertical} and slightly toward the camera`
        };
        return descriptions[direction];
    }
    function temperatureColorDescription(kelvin, language) {
        const bucket = kelvin <= 3000
            ? 'very-warm'
            : kelvin <= 3800
                ? 'warm'
                : kelvin <= 5000
                    ? 'warm-neutral'
                    : kelvin <= 6000
                        ? 'neutral-daylight'
                        : kelvin <= 7500
                            ? 'cool-daylight'
                            : 'blue-cool';
        const descriptions = language === 'zh'
            ? {
                'very-warm':'很暖的琥珀白色',
                warm:'暖白色',
                'warm-neutral':'暖中性白色',
                'neutral-daylight':'中性日光白色',
                'cool-daylight':'冷日光白色',
                'blue-cool':'偏蓝冷白色'
            }
            : {
                'very-warm':'very-warm amber-white',
                warm:'warm-white',
                'warm-neutral':'warm-neutral-white',
                'neutral-daylight':'neutral-daylight-white',
                'cool-daylight':'cool-daylight-white',
                'blue-cool':'blue-cool-white'
            };
        return descriptions[bucket];
    }
    function rgbColorDescription(hex, language) {
        const channels = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(normalizeHex(hex));
        const [red, green, blue] = channels.slice(1).map(value => parseInt(value, 16) / 255);
        const maximum = Math.max(red, green, blue);
        const minimum = Math.min(red, green, blue);
        const delta = maximum - minimum;
        const saturation = maximum === 0 ? 0 : delta / maximum;
        if (saturation < 0.12) return language === 'zh' ? '中性白色' : 'neutral-white';
        let hue = 0;
        if (delta) {
            if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
            else if (maximum === green) hue = 60 * (((blue - red) / delta) + 2);
            else hue = 60 * (((red - green) / delta) + 4);
        }
        if (hue < 0) hue += 360;
        const hueName = hue < 15 || hue >= 345
            ? 'red'
            : hue < 45
                ? 'amber'
                : hue < 70
                    ? 'yellow'
                    : hue < 100
                        ? 'yellow-green'
                        : hue < 165
                            ? 'green'
                            : hue < 200
                                ? 'cyan'
                                : hue < 255
                                    ? 'blue'
                                    : hue < 290
                                        ? 'violet'
                                        : 'magenta';
        if (language === 'zh') {
            const names = {
                red:'红色', amber:'琥珀色', yellow:'黄色', 'yellow-green':'黄绿色',
                green:'绿色', cyan:'青色', blue:'蓝色', violet:'紫色', magenta:'品红色'
            };
            return saturation < 0.35 ? `轻微${names[hueName]}调` : names[hueName];
        }
        return saturation < 0.35 ? `subtly-${hueName}-tinted` : `${hueName}-colored`;
    }
    function lightColorDescription(light, language) {
        return light.color_mode === 'rgb'
            ? rgbColorDescription(light.rgb, language)
            : temperatureColorDescription(light.temperature_kelvin, language);
    }
    function litPlaneDescription(direction, language) {
        if (language === 'zh') {
            if (direction === 'front') return '让朝向相机的平面清晰而自然地更亮，让背向相机的平面落入仍可读的自然自阴影。';
            if (direction === 'rear') return '在主体外轮廓和背向相机的边缘形成受控轮廓光，让朝向相机的平面保持在仍可读的自然自阴影中。';
            if (direction === 'rear-left' || direction === 'rear-right') {
                const side = direction === 'rear-left' ? '画面左侧' : '画面右侧';
                return `让主体${side}轮廓和背向相机的平面清晰而自然地更亮，让朝向相机及相反侧平面落入仍可读的自然自阴影。`;
            }
            const side = direction.includes('left') ? '画面左侧' : '画面右侧';
            const facing = direction.startsWith('front-') ? '及朝向相机的平面' : '朝向主光的平面';
            return `让主体${side}${facing}清晰而自然地更亮，让相反侧平面落入仍可读的自然自阴影。`;
        }
        if (direction === 'front') return 'Make the camera-facing planes clearly but naturally brighter. Let the back-facing planes fall into readable natural self-shadow.';
        if (direction === 'rear') return "Create a controlled rim light along the subject's outer contour and back-facing edges. Keep the camera-facing planes in readable natural self-shadow.";
        if (direction === 'rear-left' || direction === 'rear-right') {
            const side = direction === 'rear-left' ? 'image-left' : 'image-right';
            return `Make the subject's ${side} rim and back-facing planes clearly but naturally brighter. Let the camera-facing and opposite-side planes fall into readable natural self-shadow.`;
        }
        const side = direction.includes('left') ? 'image-left' : 'image-right';
        const facing = direction.startsWith('front-') ? ' and camera-facing planes' : '-facing planes';
        return `Make the ${side}${facing} clearly but naturally brighter. Let the opposite planes fall into readable natural self-shadow.`;
    }
    function shadowDirectionDescription(direction, language) {
        const targets = language === 'zh'
            ? {
                front:'主体后方并远离相机',
                'front-left':'画面右侧',
                left:'画面右侧',
                'rear-left':'画面右侧并朝向画面前景',
                rear:'朝向相机一侧的画面前景',
                'rear-right':'画面左侧并朝向画面前景',
                right:'画面左侧',
                'front-right':'画面左侧'
            }
            : {
                front:'behind the subject, away from the camera',
                'front-left':'toward image-right',
                left:'toward image-right',
                'rear-left':'toward image-right and the camera-facing foreground',
                rear:'toward the camera-facing foreground',
                'rear-right':'toward image-left and the camera-facing foreground',
                right:'toward image-left',
                'front-right':'toward image-left'
            };
        return targets[direction];
    }
    function shadowDescription(light, direction, language) {
        if (!light.casts_shadow) {
            return language === 'zh'
                ? '尽量减少明显的定向投影，只保留现有表面所支持的自然接触感。不要为了展示方向而新增墙影、背景光斑、地面、背景布或次级灯光。'
                : 'Keep visible directional cast shadows minimal and unobtrusive; preserve only natural contact grounding already supported by existing surfaces. Do not invent an extra wall shadow, background light patch, floor, backdrop, or secondary light merely to demonstrate the direction.';
        }
        const target = shadowDirectionDescription(direction, language);
        return language === 'zh'
            ? `在现有可见表面确实接收到主体投影时，使投影和接触阴影与该主光在物理上保持一致；从画面观察，其主要方向应远离主光并延伸至${target}。不要为了展示方向而新增墙影、背景光斑、地面、背景布或次级灯光。`
            : `Where an existing visible surface actually receives a shadow from the subject, keep the cast and contact shadows physically coherent with this key; as seen in the image, their dominant direction extends away from the key ${target}. Do not invent an extra wall shadow, background light patch, floor, backdrop, or secondary light merely to demonstrate the direction.`;
    }
    function sourceSizeBucket(size) {
        if (size <= 2) return 'hard';
        if (size <= 10) return 'medium';
        return 'soft';
    }
    function lightQualityDescription(light, language) {
        const size = sourceSizeBucket(light.angular_size_degrees);
        if (language === 'zh') {
            if (size === 'hard') {
                const cast = light.casts_shadow ? '在原场景支持可见投影时，让影边清晰并保持很窄的半影。' : '';
                return `使用来自较小表观光源的硬质定向光，形成紧凑高光和清晰的明暗过渡。${cast}`;
            }
            if (size === 'soft') {
                const cast = light.casts_shadow ? '在原场景支持可见投影时，让影边宽阔、柔和并具有明显羽化。' : '';
                return `使用来自较大表观光源的柔和定向光，形成宽阔高光和顺滑的明暗过渡。${cast}`;
            }
            const cast = light.casts_shadow ? '在原场景支持可见投影时，让影边呈现中等半影与适度羽化——既不锐利，也不宽泛模糊。' : '';
            return `使用来自中等表观尺寸光源的中等柔和定向光，形成顺滑的高光与自阴影过渡。${cast}`;
        }
        if (size === 'hard') {
            const cast = light.casts_shadow ? ' Where the original scene supports a visible cast shadow, give its edge a narrow penumbra and a crisp, clearly defined transition.' : '';
            return `Use hard directional illumination, as if from a small apparent source relative to the subject. Produce compact highlights and crisp highlight-to-shadow transitions.${cast}`;
        }
        if (size === 'soft') {
            const cast = light.casts_shadow ? ' Where the original scene supports a visible cast shadow, give its edge a wide penumbra and a broad, feathered transition.' : '';
            return `Use soft directional illumination, as if from a large apparent source relative to the subject. Produce broad highlights and smooth, gradual highlight-to-shadow transitions.${cast}`;
        }
        const cast = light.casts_shadow ? ' Where the original scene supports a visible cast shadow, give its edge a moderate penumbra and a moderately feathered transition—not razor-sharp and not broadly diffuse.' : '';
        return `Use medium-soft directional illumination, as if from a source of moderate apparent size relative to the subject. Produce smooth highlight and self-shadow transitions.${cast}`;
    }
    function fillDescription(intent, light, language) {
        const difference = intent.environment.relative_exposure_ev - light.relative_exposure_ev;
        if (language === 'zh') {
            if (difference >= -0.5) return '保持原图整体曝光和平均亮度。使用充足的环境补光打开暗侧细节，并保持柔和的主光/补光对比，同时让定向主光仍可辨认。';
            if (difference < -2.5) return '保持原图整体曝光和平均亮度。限制环境补光，使主光保持明确主导，同时保留可读的暗侧细节而不压死黑位。';
            return '保持原图整体曝光和平均亮度。使用足够的环境补光保留暗侧细节，但不要抹平主光与补光的对比。';
        }
        if (difference >= -0.5) return 'Preserve the original overall exposure and average scene brightness. Use generous ambient fill for open shadow-side detail and gentle key-to-fill contrast, while keeping the directional key perceptible.';
        if (difference < -2.5) return 'Preserve the original overall exposure and average scene brightness. Keep ambient fill restrained so the key remains clearly dominant, while retaining readable shadow-side detail without crushing the blacks.';
        return 'Preserve the original overall exposure and average scene brightness. Keep enough ambient fill for detail on shadow-side surfaces without flattening the key-to-fill contrast.';
    }
    function compileLightingPrompts(value={}) {
        const intent = normalizeLightingIntent(value);
        const light = intent.lights[0];
        const direction = directionBucket(light.azimuth_degrees);
        const height = heightBucket(light.elevation_degrees);
        const fillDifference = intent.environment.relative_exposure_ev - light.relative_exposure_ev;
        const enDominance = fillDifference < -0.5 ? 'one dominant, unseen off-camera' : 'one unseen off-camera';
        const zhDominance = fillDifference < -0.5 ? '一盏占主导且不可见的画外' : '一盏不可见的画外';
        return Object.freeze({
            zh:[
                '使用所提供的图片，仅修改灯光。',
                `使用${zhDominance}${lightColorDescription(light, 'zh')}主光，${sourcePositionDescription(direction, height, 'zh')}。照明来源位于画面之外，不是可见的场景物体。所有灯光设备都保持在画外且不可见；不要新增或显露灯具、柔光箱、反光板、灯架、线缆、支撑结构或固定装置。`,
                `${litPlaneDescription(direction, 'zh')}${shadowDescription(light, direction, 'zh')}`,
                `${lightQualityDescription(light, 'zh')}${fillDescription(intent, light, 'zh')}`,
                '其他所有内容保持完全不变：主体身份与面部特征、姿态、表情、相机视点、取景、构图、几何结构、材质、纹理、原始视觉风格和渲染方式、原始色彩关系、原始背景及所有现有物体、标志与文字。'
            ].join('\n\n'),
            en:[
                'Using the provided image, change only the lighting.',
                `Relight the existing subject and scene with ${enDominance} ${lightColorDescription(light, 'en')} key ${sourcePositionDescription(direction, height, 'en')}. The illumination source is outside the depicted image and is not a visible scene object. Keep all lighting equipment off-camera and invisible; do not add or reveal lamps, softboxes, reflectors, stands, cables, rigs, or fixtures.`,
                `${litPlaneDescription(direction, 'en')} ${shadowDescription(light, direction, 'en')}`,
                `${lightQualityDescription(light, 'en')} ${fillDescription(intent, light, 'en')}`,
                'Keep everything else exactly the same: subject identity and facial features, pose, expression, camera viewpoint, framing, composition, geometry, materials, textures, original visual style and rendering method, original color relationships, original background and all existing objects, logos, and text.'
            ].join('\n\n')
        });
    }
    return Object.freeze({
        SCHEMA,
        COMPILER_VERSION,
        COORDINATE_SPACE,
        DEFAULT_LIGHT,
        DEFAULT_INTENT,
        defaultLightingIntent,
        normalizeLightingIntent,
        lightingDirectionVector,
        temperatureToRgb,
        resolvedLightColor,
        compileLightingPrompts
    });
});
