#!/usr/bin/env python3
"""
Deep-Check University Outreach — Email Generator
=================================================
Generates personalized HTML emails for each target university.
Output: one HTML file per university in outreach/emails/
"""

import os
import json
from pathlib import Path

OUT_DIR = Path(__file__).parent / "emails"
OUT_DIR.mkdir(exist_ok=True)

# ── University database ──

UNIVERSITIES = [
    # UK
    {"name": "University of Oxford", "email": "admissions@admin.ox.ac.uk", "region": "uk", "hook": "With over 25,000 international applications annually, Oxford faces unique verification challenges at scale", "apps": "26,000+"},
    {"name": "University of Cambridge", "email": "admissions@cam.ac.uk", "region": "uk", "hook": "Cambridge's rigorous admissions process demands equally rigorous document verification — especially with rising AI-generated fraud", "apps": "24,000+"},
    {"name": "Imperial College London", "email": "admissions@imperial.ac.uk", "region": "uk", "hook": "As a world leader in STEM, Imperial understands the critical importance of AI-powered verification in combating increasingly sophisticated document fraud", "apps": "22,000+"},
    {"name": "University College London", "email": "admissions@ucl.ac.uk", "region": "uk", "hook": "UCL's position as the UK's largest university by enrollment means verification at massive scale — exactly what Deep-Check was built for", "apps": "60,000+"},
    {"name": "London School of Economics", "email": "ug.admissions@lse.ac.uk", "region": "uk", "hook": "LSE's globally diverse student body means verifying documents from virtually every country — a challenge our 195-country ICAO compliance directly addresses", "apps": "25,000+"},
    {"name": "King's College London", "email": "admissions@kcl.ac.uk", "region": "uk", "hook": "King's international reputation attracts applicants worldwide, making robust document verification essential to maintaining admissions integrity", "apps": "30,000+"},
    {"name": "University of Manchester", "email": "ug.admissions@manchester.ac.uk", "region": "uk", "hook": "As one of the UK's largest universities with a major international intake, Manchester needs verification that scales without compromising accuracy", "apps": "35,000+"},
    {"name": "University of Edinburgh", "email": "admissions@ed.ac.uk", "region": "uk", "hook": "Edinburgh's strong international profile — with students from over 160 countries — creates verification complexity that AI can uniquely solve", "apps": "20,000+"},
    {"name": "University of Bristol", "email": "ug-admissions@bristol.ac.uk", "region": "uk", "hook": "Bristol's commitment to academic excellence requires ensuring every admitted student's credentials are genuine", "apps": "15,000+"},
    {"name": "University of Warwick", "email": "admissions@warwick.ac.uk", "region": "uk", "hook": "Warwick's growing international presence makes automated, privacy-first verification increasingly critical", "apps": "18,000+"},
    {"name": "Durham University", "email": "admissions@durham.ac.uk", "region": "uk", "hook": "Durham's selective admissions process benefits from AI-powered verification that catches what manual review cannot", "apps": "14,000+"},
    {"name": "University of Leeds", "email": "admissions@leeds.ac.uk", "region": "uk", "hook": "Leeds' large-scale international recruitment requires document verification that is both accurate and efficient", "apps": "20,000+"},

    # USA
    {"name": "Massachusetts Institute of Technology", "email": "admissions@mit.edu", "region": "us", "hook": "MIT's commitment to innovation extends to how it verifies applicant credentials — AI-powered detection catches fraud that traditional methods miss", "apps": "26,000+"},
    {"name": "Stanford University", "email": "admission@stanford.edu", "region": "us", "hook": "Stanford's highly competitive admissions demands the highest standard of credential verification to protect institutional integrity", "apps": "56,000+"},
    {"name": "Harvard University", "email": "admissions@fas.harvard.edu", "region": "us", "hook": "Harvard's global prestige makes it a prime target for application fraud — Deep-Check provides the AI defense layer needed", "apps": "57,000+"},
    {"name": "Yale University", "email": "admissions@yale.edu", "region": "us", "hook": "Yale's tradition of excellence deserves verification technology that matches — detecting AI-generated documents before they reach reviewers", "apps": "52,000+"},
    {"name": "Princeton University", "email": "admission@princeton.edu", "region": "us", "hook": "Princeton's selective process can be strengthened with pixel-level document analysis that human reviewers cannot replicate", "apps": "37,000+"},
    {"name": "Columbia University", "email": "ugrad-admiss@columbia.edu", "region": "us", "hook": "Columbia's position in New York City draws applicants globally, requiring verification across every document type and country", "apps": "60,000+"},
    {"name": "UC Berkeley", "email": "admissions@berkeley.edu", "region": "us", "hook": "Berkeley's massive applicant pool demands automated verification that scales — without compromising on detection accuracy", "apps": "130,000+"},
    {"name": "University of Michigan", "email": "admissions@umich.edu", "region": "us", "hook": "Michigan's large international student population requires document verification across dozens of countries and document formats", "apps": "87,000+"},
    {"name": "New York University", "email": "admissions@nyu.edu", "region": "us", "hook": "NYU's global network — spanning New York, Abu Dhabi, and Shanghai — creates unique multi-region verification needs", "apps": "120,000+"},
    {"name": "University of Pennsylvania", "email": "admissions@upenn.edu", "region": "us", "hook": "Penn's Ivy League standards require verification that catches increasingly sophisticated AI-generated credentials", "apps": "65,000+"},
    {"name": "Duke University", "email": "admissions@duke.edu", "region": "us", "hook": "Duke's research leadership can extend to adopting cutting-edge AI verification — staying ahead of document fraud", "apps": "50,000+"},
    {"name": "University of Chicago", "email": "admissions@uchicago.edu", "region": "us", "hook": "UChicago's intellectual rigor should be matched by equally rigorous credential verification", "apps": "38,000+"},

    # UAE
    {"name": "Khalifa University", "email": "admissions@ku.ac.ae", "region": "uae", "hook": "Khalifa University's role as the UAE's leading research institution makes it a natural fit for AI-powered verification technology", "apps": "5,000+"},
    {"name": "UAE University", "email": "admission@uaeu.ac.ae", "region": "uae", "hook": "As the UAE's flagship national university, UAEU can lead the region in adopting privacy-first identity verification", "apps": "8,000+"},
    {"name": "American University of Sharjah", "email": "admissions@aus.edu", "region": "uae", "hook": "AUS attracts students from over 90 nationalities — requiring document verification that handles global diversity", "apps": "6,000+"},
    {"name": "NYU Abu Dhabi", "email": "admissions@nyu.edu", "region": "uae", "hook": "NYU Abu Dhabi's truly global student body — representing 120+ countries — demands verification technology built for international scale", "apps": "12,000+"},
    {"name": "University of Sharjah", "email": "admission@sharjah.ac.ae", "region": "uae", "hook": "The University of Sharjah's growing enrollment benefits from automated verification that maintains accuracy at scale", "apps": "10,000+"},
    {"name": "Zayed University", "email": "admissions@zu.ac.ae", "region": "uae", "hook": "Zayed University's commitment to national excellence can be reinforced with advanced AI verification technology", "apps": "4,000+"},
    {"name": "American University in Dubai", "email": "admissions@aud.edu", "region": "uae", "hook": "AUD's diverse international community requires robust document and identity verification across multiple regions", "apps": "3,000+"},

    # International
    {"name": "ETH Zurich", "email": "admissions@ethz.ch", "region": "intl", "hook": "ETH Zurich's position as Europe's leading technical university makes it a natural early adopter of AI-powered verification", "apps": "12,000+"},
    {"name": "University of Toronto", "email": "admissions@utoronto.ca", "region": "intl", "hook": "UofT's massive international intake — one of the largest in North America — demands scalable, privacy-compliant verification", "apps": "100,000+"},
    {"name": "University of Melbourne", "email": "admissions@unimelb.edu.au", "region": "intl", "hook": "Melbourne's strong international recruitment from Asia-Pacific requires document verification across diverse document standards", "apps": "50,000+"},
    {"name": "National University of Singapore", "email": "admissions@nus.edu.sg", "region": "intl", "hook": "NUS's role as Asia's top university means setting the standard for secure, AI-powered admissions verification", "apps": "25,000+"},
    {"name": "Sorbonne University", "email": "admissions@sorbonne-universite.fr", "region": "intl", "hook": "Sorbonne's historic prestige and growing international programs require modern AI verification to match", "apps": "15,000+"},
    {"name": "Technical University of Munich", "email": "admissions@tum.de", "region": "intl", "hook": "TUM's position as Germany's top technical university makes it an ideal partner for advanced verification technology", "apps": "20,000+"},
    {"name": "University of Tokyo", "email": "admissions@u-tokyo.ac.jp", "region": "intl", "hook": "UTokyo's expanding international programs require verification technology that handles documents from every region", "apps": "10,000+"},
    {"name": "University of Hong Kong", "email": "admissions@hku.hk", "region": "intl", "hook": "HKU's position as a gateway between East and West creates unique verification demands across multiple document standards", "apps": "18,000+"},
]

# ── Region-specific compliance notes ──

COMPLIANCE = {
    "uk": "fully GDPR compliant by design — browser-side processing means zero biometric data leaves your network",
    "us": "designed with FERPA and institutional data governance in mind — all biometric processing runs client-side, with optional on-premise deployment",
    "uae": "compliant with UAE data protection regulations and designed for the region's high standards — browser-side processing ensures zero biometric data leaves your infrastructure",
    "intl": "designed for international data protection standards including GDPR — browser-side processing ensures zero biometric data is transmitted externally",
}

REGION_LABELS = {
    "uk": "United Kingdom",
    "us": "United States",
    "uae": "United Arab Emirates",
    "intl": "International",
}


def generate_email_html(uni):
    region = uni["region"]
    compliance = COMPLIANCE[region]

    return f'''<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Email - {uni["name"]}</title></head>
<body style="font-family: Arial, sans-serif; font-size: 14px; color: #222; line-height: 1.6; max-width: 680px; margin: 40px auto; padding: 20px;">

<p style="color:#888; font-size:12px; margin-bottom:20px;">
<strong>To:</strong> {uni["email"]}<br>
<strong>Subject:</strong> AI-Powered Identity &amp; Document Verification for {uni["name"]} — Meeting Request
</p>
<hr style="border:none; border-top:1px solid #eee; margin-bottom:20px;">

<p>Dear {uni["name"]} Admissions Team,</p>

<p>My name is Pablo Lopez Rodriguez, founder of <strong>Deep-Check</strong> — an AI-powered identity verification platform built for institutions that cannot afford to get document fraud wrong.</p>

<p>{uni["hook"]}. I believe our technology can add significant value to your verification workflows.</p>

<p>Universities today face a rapidly evolving threat landscape:</p>

<ul style="padding-left: 20px;">
<li><strong>Fraudulent documents in admissions:</strong> AI-generated transcripts, manipulated diplomas, and forged IDs that are virtually undetectable by human review.</li>
<li><strong>Remote exam integrity:</strong> deepfake faces and AI impersonation during online proctored assessments.</li>
<li><strong>International document diversity:</strong> passports, visas, and national IDs from 195 countries with different formats and security features.</li>
<li><strong>Bot activity:</strong> automated scripts completing online coursework or assessments.</li>
</ul>

<h3 style="color: #1a1a2e; margin-top: 24px; font-size: 15px;">DEEP-CHECK: WHAT WE DO</h3>

<p>We combine multiple AI verification layers into one platform:</p>

<ol style="padding-left: 20px;">
<li style="margin-bottom: 8px;"><strong>Document Forensics</strong> — Pixel-level tampering detection (AUC 0.998) that catches manipulations invisible to the human eye. ICAO 9303 compliant, covering TD1 (ID cards), TD2 (visas), and TD3 (passports) across 195 countries.</li>
<li style="margin-bottom: 8px;"><strong>Deepfake Detection</strong> — Multi-model AI ensemble that detects faces generated by Stable Diffusion, MidJourney, DALL-E, and FaceSwap tools.</li>
<li style="margin-bottom: 8px;"><strong>Keystroke Biometrics</strong> — Typing pattern analysis that verifies student identity and detects bot activity during online exams — no additional hardware required.</li>
<li style="margin-bottom: 8px;"><strong>Intelligent OCR + MRZ</strong> — Automated field extraction and cross-validation of document data with coherence checking.</li>
</ol>

<h3 style="color: #1a1a2e; margin-top: 24px; font-size: 15px;">WHY DEEP-CHECK</h3>

<ul style="padding-left: 20px;">
<li><strong>Privacy-first:</strong> {compliance}.</li>
<li><strong>On-premise deployment:</strong> Docker-based, runs entirely within your infrastructure if required.</li>
<li><strong>Easy integration:</strong> JavaScript and Python SDKs for direct integration into existing admissions portals, exam platforms, or student management systems.</li>
<li><strong>Published research:</strong> peer-reviewed paper with industrial benchmarks following ISO 30107-3 standards.</li>
</ul>

<h3 style="color: #1a1a2e; margin-top: 24px; font-size: 15px;">ADMISSIONS VERIFICATION FLOW</h3>

<table style="border-collapse: collapse; margin: 12px 0; font-size: 13px; width: 100%;">
<tr><td style="padding: 10px 16px; background: #f0f4ff; border: 1px solid #ddd;">Applicant uploads passport + transcript</td></tr>
<tr><td style="padding: 4px 16px; text-align: center; color: #999; font-size: 16px;">&#8595;</td></tr>
<tr><td style="padding: 10px 16px; background: #f0fff4; border: 1px solid #ddd;">Document Forensics &#8594; <strong>authentic / tampered</strong></td></tr>
<tr><td style="padding: 4px 16px; text-align: center; color: #999; font-size: 16px;">&#8595;</td></tr>
<tr><td style="padding: 10px 16px; background: #f0fff4; border: 1px solid #ddd;">MRZ + field extraction &#8594; <strong>data consistency check</strong></td></tr>
<tr><td style="padding: 4px 16px; text-align: center; color: #999; font-size: 16px;">&#8595;</td></tr>
<tr><td style="padding: 10px 16px; background: #f0fff4; border: 1px solid #ddd;">Deepfake detection on photo &#8594; <strong>real / AI-generated</strong></td></tr>
<tr><td style="padding: 4px 16px; text-align: center; color: #999; font-size: 16px;">&#8595;</td></tr>
<tr><td style="padding: 10px 16px; background: #e8f5e9; border: 1px solid #ddd; font-weight: bold;">Result: verified &#10003; or flagged for manual review &#9888;</td></tr>
</table>

<p style="margin-top: 24px;">I would welcome the opportunity to schedule a <strong>20-minute call</strong> to discuss how Deep-Check could support {uni["name"]}'s verification workflows — whether in admissions, examination, or research integrity.</p>

<p>Would any time during the <strong>week of 14 April</strong> work for a brief introduction? I am happy to prepare a live demo tailored to your specific needs.</p>

<br>
<p>Kind regards,</p>

<p style="margin-top: 4px;">
<strong>Pablo Lopez Rodriguez</strong><br>
Founder, Deep-Check | Hium Solutions<br>
<a href="mailto:pablo@hiumsolutions.com" style="color: #1a73e8;">pablo@hiumsolutions.com</a><br>
<a href="https://deep-check-two.vercel.app" style="color: #1a73e8;">deep-check-two.vercel.app</a>
</p>

</body>
</html>'''


def generate_summary():
    """Generate a summary table of all universities and emails."""
    lines = ["# Deep-Check University Outreach Campaign", ""]
    lines.append(f"**Total universities:** {len(UNIVERSITIES)}")
    lines.append(f"**Regions:** UK ({sum(1 for u in UNIVERSITIES if u['region']=='uk')}), "
                 f"US ({sum(1 for u in UNIVERSITIES if u['region']=='us')}), "
                 f"UAE ({sum(1 for u in UNIVERSITIES if u['region']=='uae')}), "
                 f"International ({sum(1 for u in UNIVERSITIES if u['region']=='intl')})")
    lines.append("")

    for region_key in ["uk", "us", "uae", "intl"]:
        lines.append(f"## {REGION_LABELS[region_key]}")
        lines.append("")
        lines.append("| University | Email | Applications |")
        lines.append("|-----------|-------|-------------|")
        for u in UNIVERSITIES:
            if u["region"] == region_key:
                lines.append(f"| {u['name']} | `{u['email']}` | {u['apps']} |")
        lines.append("")

    lines.append("## How to send")
    lines.append("")
    lines.append("1. Open each `.html` file in `outreach/emails/` in Chrome")
    lines.append("2. **Cmd+A** to select all, **Cmd+C** to copy")
    lines.append("3. In Gmail: Compose > paste with **Cmd+V**")
    lines.append("4. The **To** and **Subject** are shown at the top of each email")
    lines.append("5. Review, adjust if needed, and send")
    lines.append("")
    lines.append("Or use the Gmail draft batch below (copy-paste into Gmail drafts).")

    return "\n".join(lines)


if __name__ == "__main__":
    # Generate individual emails
    for uni in UNIVERSITIES:
        slug = uni["name"].lower().replace(" ", "_").replace("(", "").replace(")", "")
        filename = f"{uni['region']}_{slug}.html"
        filepath = OUT_DIR / filename
        filepath.write_text(generate_email_html(uni), encoding="utf-8")
        print(f"  Generated: {filename}")

    # Generate summary
    summary_path = Path(__file__).parent / "OUTREACH_CAMPAIGN.md"
    summary_path.write_text(generate_summary(), encoding="utf-8")
    print(f"\n  Summary: OUTREACH_CAMPAIGN.md")
    print(f"  Total: {len(UNIVERSITIES)} universities")
    print(f"  Emails in: outreach/emails/")
