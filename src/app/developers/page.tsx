'use client'

import { useState } from 'react'

const BASE = 'https://deep-check-two.vercel.app'

const codeExamples = {
  curl: `curl -X POST ${BASE}/api/v1/detect \\
  -H "Authorization: Bearer dc_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "image": "<base64-encoded-image>",
    "cropFace": true
  }'`,

  python: `import requests
import base64

API_KEY = "dc_live_YOUR_KEY"
URL = "${BASE}/api/v1/detect"

# Read and encode image
with open("photo.jpg", "rb") as f:
    image_b64 = base64.b64encode(f.read()).decode()

response = requests.post(URL, json={
    "image": image_b64,
    "cropFace": True
}, headers={
    "Authorization": f"Bearer {API_KEY}"
})

data = response.json()["data"]
print(f"Score: {data['authenticityScore']}/100")
print(f"Verdict: {data['verdict']}")
print(f"Confidence: {data['confidence']}")`,

  javascript: `const response = await fetch("${BASE}/api/v1/detect", {
  method: "POST",
  headers: {
    "Authorization": "Bearer dc_live_YOUR_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    image: base64EncodedImage,
    cropFace: true
  })
});

const { data } = await response.json();
console.log(\`Score: \${data.authenticityScore}/100\`);
console.log(\`Verdict: \${data.verdict}\`);`,

  batch: `// Batch mode: up to 10 images
const response = await fetch("${BASE}/api/v1/detect", {
  method: "POST",
  headers: {
    "Authorization": "Bearer dc_live_YOUR_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    images: [base64Image1, base64Image2, base64Image3],
    cropFace: true,
    webhookUrl: "https://your-server.com/webhook"
  })
});

const { data } = await response.json();
console.log(\`Average: \${data.summary.averageAuthenticityScore}/100\`);
data.results.forEach(r => {
  console.log(\`Image \${r.index}: \${r.verdict} (\${r.authenticityScore})\`);
});`,
}

export default function DevelopersPage() {
  const [tab, setTab] = useState<keyof typeof codeExamples>('curl')

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      {/* Hero */}
      <div className="border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <div className="inline-flex items-center gap-2 bg-emerald-500/10 text-emerald-400 px-3 py-1 rounded-full text-sm mb-6">
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            API v1
          </div>
          <h1 className="text-4xl font-bold mb-4">Deep-Check API</h1>
          <p className="text-zinc-400 text-lg max-w-2xl">
            Detect AI-generated faces and deepfakes via REST API.
            Server-side inference with EfficientNet-B4 + frequency analysis.
          </p>
          <div className="mt-6 flex gap-3">
            <code className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 text-sm text-zinc-300">
              POST /api/v1/detect
            </code>
            <code className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 text-sm text-zinc-300">
              GET /api/v1/detect
            </code>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12 space-y-16">
        {/* Authentication */}
        <section>
          <h2 className="text-2xl font-bold mb-4">Authentication</h2>
          <p className="text-zinc-400 mb-4">
            All requests require a Bearer token in the Authorization header.
          </p>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <code className="text-emerald-400 text-sm">
              Authorization: Bearer dc_live_your_api_key_here
            </code>
          </div>
          <p className="text-zinc-500 text-sm mt-3">
            Contact us to get an API key. Keys have read/write permissions and usage is tracked.
          </p>
        </section>

        {/* Endpoints */}
        <section>
          <h2 className="text-2xl font-bold mb-6">Endpoints</h2>

          {/* POST /detect */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden mb-6">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
              <span className="bg-emerald-500/20 text-emerald-400 text-xs font-bold px-2 py-1 rounded">POST</span>
              <code className="text-sm">/api/v1/detect</code>
              <span className="text-zinc-500 text-sm ml-auto">Detect AI-generated content</span>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-zinc-300 mb-2">Request Body</h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-zinc-500 text-left">
                      <th className="pb-2 pr-4">Field</th>
                      <th className="pb-2 pr-4">Type</th>
                      <th className="pb-2 pr-4">Required</th>
                      <th className="pb-2">Description</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-400">
                    <tr className="border-t border-zinc-800">
                      <td className="py-2 pr-4"><code className="text-emerald-400">image</code></td>
                      <td className="py-2 pr-4">string</td>
                      <td className="py-2 pr-4">Yes*</td>
                      <td className="py-2">Base64-encoded image (JPEG, PNG, WebP)</td>
                    </tr>
                    <tr className="border-t border-zinc-800">
                      <td className="py-2 pr-4"><code className="text-emerald-400">images</code></td>
                      <td className="py-2 pr-4">string[]</td>
                      <td className="py-2 pr-4">Yes*</td>
                      <td className="py-2">Array of base64 images (batch mode, max 10)</td>
                    </tr>
                    <tr className="border-t border-zinc-800">
                      <td className="py-2 pr-4"><code className="text-emerald-400">cropFace</code></td>
                      <td className="py-2 pr-4">boolean</td>
                      <td className="py-2 pr-4">No</td>
                      <td className="py-2">Auto-crop face region (default: true)</td>
                    </tr>
                    <tr className="border-t border-zinc-800">
                      <td className="py-2 pr-4"><code className="text-emerald-400">webhookUrl</code></td>
                      <td className="py-2 pr-4">string</td>
                      <td className="py-2 pr-4">No</td>
                      <td className="py-2">URL for async result callback</td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-zinc-600 text-xs mt-2">* Provide either &quot;image&quot; (single) or &quot;images&quot; (batch)</p>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-zinc-300 mb-2">Response</h4>
                <pre className="bg-black/50 rounded-lg p-4 text-xs text-zinc-300 overflow-x-auto">{`{
  "success": true,
  "data": {
    "authenticityScore": 92,    // 1-100 (100 = definitely real)
    "verdict": "real",          // real | suspicious | likely_fake | fake
    "confidence": "high",       // high | medium | low
    "pFake": 0.0842,           // Raw P(AI-generated) 0-1
    "modelVersion": "v3-efficientnet-b4",
    "processingMs": 245
  }
}`}</pre>
              </div>
            </div>
          </div>

          {/* GET /detect */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
              <span className="bg-blue-500/20 text-blue-400 text-xs font-bold px-2 py-1 rounded">GET</span>
              <code className="text-sm">/api/v1/detect</code>
              <span className="text-zinc-500 text-sm ml-auto">Model info + health check</span>
            </div>
            <div className="p-4">
              <pre className="bg-black/50 rounded-lg p-4 text-xs text-zinc-300 overflow-x-auto">{`{
  "success": true,
  "data": {
    "status": "ready",
    "model": {
      "modelVersion": "v3-efficientnet-b4",
      "inputShape": [1, 3, 224, 224],
      "fileSizeMB": 70.2,
      "runtime": "onnxruntime-node"
    }
  }
}`}</pre>
            </div>
          </div>
        </section>

        {/* Code Examples */}
        <section>
          <h2 className="text-2xl font-bold mb-6">Code Examples</h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="flex border-b border-zinc-800">
              {(['curl', 'python', 'javascript', 'batch'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    tab === t
                      ? 'text-emerald-400 border-b-2 border-emerald-400 bg-zinc-800/50'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {t === 'curl' ? 'cURL' : t === 'javascript' ? 'JavaScript' : t === 'python' ? 'Python' : 'Batch'}
                </button>
              ))}
            </div>
            <pre className="p-4 text-xs text-zinc-300 overflow-x-auto leading-relaxed">
              {codeExamples[tab]}
            </pre>
          </div>
        </section>

        {/* Verdicts */}
        <section>
          <h2 className="text-2xl font-bold mb-6">Verdict Scale</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { verdict: 'real', range: '80-99', color: 'emerald', desc: 'Likely authentic human photo' },
              { verdict: 'suspicious', range: '60-79', color: 'yellow', desc: 'Possible manipulation detected' },
              { verdict: 'likely_fake', range: '30-59', color: 'orange', desc: 'Strong AI generation indicators' },
              { verdict: 'fake', range: '1-29', color: 'red', desc: 'Almost certainly AI-generated' },
            ].map(v => (
              <div key={v.verdict} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <div className={`text-${v.color}-400 font-bold text-lg mb-1`}>{v.verdict}</div>
                <div className="text-zinc-500 text-sm mb-2">Score: {v.range}</div>
                <div className="text-zinc-400 text-xs">{v.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Rate Limits */}
        <section>
          <h2 className="text-2xl font-bold mb-6">Plans & Limits</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { plan: 'Starter', price: '29/mo', calls: '1,000 calls/mo', batch: 'Up to 5 per batch' },
              { plan: 'Pro', price: '79/mo', calls: '10,000 calls/mo', batch: 'Up to 10 per batch' },
              { plan: 'Enterprise', price: 'Custom', calls: 'Unlimited', batch: 'Up to 100 per batch' },
            ].map(p => (
              <div key={p.plan} className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
                <h3 className="font-bold text-lg mb-1">{p.plan}</h3>
                <div className="text-emerald-400 font-bold text-xl mb-3">{p.price}</div>
                <div className="text-zinc-400 text-sm space-y-1">
                  <div>{p.calls}</div>
                  <div>{p.batch}</div>
                  <div>Webhook callbacks</div>
                  <div>Model version selection</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Error Codes */}
        <section>
          <h2 className="text-2xl font-bold mb-6">Error Codes</h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 text-left border-b border-zinc-800">
                  <th className="p-3">Status</th>
                  <th className="p-3">Meaning</th>
                </tr>
              </thead>
              <tbody className="text-zinc-400">
                {[
                  ['400', 'Bad request — missing image or invalid format'],
                  ['401', 'Unauthorized — invalid or missing API key'],
                  ['413', 'Image too large — max 10MB'],
                  ['429', 'Rate limit exceeded'],
                  ['500', 'Server error — model loading or inference failure'],
                ].map(([code, desc]) => (
                  <tr key={code} className="border-t border-zinc-800">
                    <td className="p-3"><code className="text-red-400">{code}</code></td>
                    <td className="p-3">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Footer */}
        <div className="border-t border-zinc-800 pt-8 pb-12 text-center">
          <p className="text-zinc-500 text-sm">
            Deep-Check API by HIUM Solutions SL
          </p>
          <p className="text-zinc-600 text-xs mt-1">
            Contact: info@deep-check.io | Andalucia, Spain
          </p>
        </div>
      </div>
    </div>
  )
}
