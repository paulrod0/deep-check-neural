export default function SignaturePage() {
  return (
    <div style={{ padding: '40px', background: '#ffffff', minHeight: '100vh' }}>
      <p style={{ color: '#999', fontSize: '12px', marginBottom: '20px' }}>
        Select everything below this line, copy (Ctrl+C), then paste into Gmail Settings &gt; Signature
      </p>
      <hr style={{ borderColor: '#eee', marginBottom: '20px' }} />

      {/* === THE SIGNATURE === */}
      <table cellPadding={0} cellSpacing={0} style={{ fontFamily: "'Inter',Helvetica,Arial,sans-serif", color: '#1a1a20', fontSize: '13px', lineHeight: '1.4' }}>
        <tbody>
          <tr>
            <td style={{ paddingRight: '16px', borderRight: '2px solid #00cc7d', verticalAlign: 'top' }}>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a20' }}>Pablo López Rodríguez</div>
              <div style={{ fontSize: '11px', color: '#71717a', marginTop: '2px' }}>Founder &amp; CEO</div>
            </td>
            <td style={{ paddingLeft: '16px', verticalAlign: 'top' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a20' }}>
                Deep-Check<span style={{ color: '#00cc7d' }}>.</span>
              </div>
              <div style={{ fontSize: '10px', color: '#71717a', letterSpacing: '0.5px', marginTop: '1px' }}>
                AI-Powered Identity Verification
              </div>
              <div style={{ marginTop: '6px' }}>
                <a href="https://deep-check-two.vercel.app" style={{ color: '#00cc7d', textDecoration: 'none', fontSize: '11px' }}>
                  deep-check-two.vercel.app
                </a>
              </div>
              <div style={{ color: '#a1a1aa', fontSize: '10px', marginTop: '3px' }}>Madrid, Spain</div>
            </td>
          </tr>
          <tr>
            <td colSpan={2} style={{ paddingTop: '8px' }}>
              <div style={{ fontSize: '9px', color: '#a1a1aa', letterSpacing: '0.3px' }}>
                Continuous verification · Zero biometric data to servers · GDPR native
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
