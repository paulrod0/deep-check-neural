# Deep-Check Native Mobile SDK — Architecture Plan

## Status: Planning Phase

## Strategy

Build a **React Native Expo** app that wraps the core logic — NOT a WebView wrapper.
Key: share TypeScript logic between web (Next.js) and native (Expo) via a shared `/packages/core` workspace.

## Monorepo Structure

```
deep-check/
├── apps/
│   ├── web/          ← current Next.js app (move here)
│   └── native/       ← new Expo app
├── packages/
│   ├── core/         ← shared TypeScript: mrzParser, scoring, types
│   ├── face-match/   ← MediaPipe web / VisionCamera native adapter
│   └── ui/           ← shared design tokens (colors, spacing)
└── package.json      ← pnpm workspaces
```

## Native-specific implementations

| Feature | Web (current) | Native (React Native) |
|---|---|---|
| Camera | `getUserMedia` + `<video>` | `react-native-vision-camera` |
| Face landmarks | MediaPipe WASM | `react-native-fast-tflite` (TFLite) |
| Document overlay | Canvas 2D | `react-native-skia` |
| Perspective crop | Canvas crop | VisionCamera frame processor |
| File I/O | FileReader | `expo-file-system` |
| Secure storage | localStorage | `expo-secure-store` |
| Notifications | Web Push | `expo-notifications` |

## MVP Scope (v1 — 4 weeks)

1. **Document capture** — VisionCamera + overlay + blur/glare detection
2. **MRZ scanning** — `react-native-mrz-scanner` or custom TFLite OCR
3. **Face match** — TFLite FaceLandmarker (MobileNet port of MediaPipe)
4. **Results screen** — shared verdict logic from `packages/core`

## Installation plan

```bash
# Create native app
npx create-expo-app apps/native --template expo-template-blank-typescript

# Camera
npx expo install react-native-vision-camera

# GPU-accelerated ML
npx expo install react-native-fast-tflite

# Drawing
npx expo install @shopify/react-native-skia

# Build config
npx expo install expo-build-properties

# EAS build (Expo Application Services)
npm install -g eas-cli
eas login
eas build --platform all
```

## Key files to create

- `apps/native/app/_layout.tsx` — Expo Router root
- `apps/native/app/(tabs)/verify.tsx` — Document verification tab
- `apps/native/app/(tabs)/interview.tsx` — Interview monitoring tab
- `apps/native/components/DocumentScanner.tsx` — VisionCamera + overlay
- `apps/native/components/FaceMatchNative.tsx` — TFLite face comparison
- `apps/native/babel.config.js` — Reanimated + worklets

## TFLite models needed

- `face_landmarker.task` (MediaPipe) — 22MB, already in packages/@mediapipe
- `text_detector.tflite` — for MRZ region detection
- `efficientnet_b4_docforensics.tflite` — convert from ONNX when v5 is ready

## ONNX → TFLite conversion

```bash
# After training CNN v5
python -c "
import onnx
from onnx_tf import backend
import tensorflow as tf

onnx_model = onnx.load('models/deepcheck_forensics_v5.onnx')
tf_rep = backend.prepare(onnx_model)
tf_rep.export_graph('/tmp/tf_model')

converter = tf.lite.TFLiteConverter.from_saved_model('/tmp/tf_model')
converter.optimizations = [tf.lite.Optimize.DEFAULT]
converter.target_spec.supported_types = [tf.float16]  # FP16 for mobile
tflite_model = converter.convert()
open('models/deepcheck_forensics_v5.tflite', 'wb').write(tflite_model)
"
```

## Estimated timeline

| Week | Deliverable |
|---|---|
| 1 | Monorepo setup + Expo app skeleton + shared packages |
| 2 | VisionCamera document capture + MRZ scanning |
| 3 | TFLite face match + results screen |
| 4 | EAS build + TestFlight/Play Store beta |

## Decision: When to start

Start after:
1. CNN v5 training completes (~87% doc acc, epoch 160+) ← happening now
2. TFLite conversion of forensics model (needs completed training)
3. At least 1 enterprise customer asks for mobile ← prioritize based on demand

Blocker resolved: face-match TFLite model is available TODAY (MediaPipe publishes
the .task file). Document forensics TFLite needs the trained v5 model.
