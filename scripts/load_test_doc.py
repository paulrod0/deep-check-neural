#!/usr/bin/env python3
"""
Deep-Check Document Load Test — IE University Simulation
=========================================================
Simulates batch document processing (DNIs, passports, diplomas, transcripts)
as if IE University were submitting them through the API.

Run from Mac terminal:
    python3 scripts/load_test_doc.py --host 100.116.188.12 --docs 50 --concurrent 3

Requirements: pip3 install requests Pillow
"""

import argparse
import time
import json
import io
import sys
import random
import string
import statistics
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import requests
from PIL import Image, ImageDraw


# ── Synthetic Document Generator ──

def generate_dni_image():
    """Generate a synthetic Spanish DNI-style document image."""
    img = Image.new("RGB", (856, 540), color=(245, 240, 230))
    draw = ImageDraw.Draw(img)
    draw.rectangle([(0, 0), (856, 60)], fill=(0, 51, 102))
    draw.text((20, 15), "DOCUMENTO NACIONAL DE IDENTIDAD", fill="white")
    draw.text((650, 15), "ESPANA", fill="white")
    draw.rectangle([(30, 80), (230, 320)], outline=(100, 100, 100), width=2)
    draw.text((80, 190), "FOTO", fill=(150, 150, 150))

    fields = [
        ("APELLIDOS", f"{''.join(random.choices(string.ascii_uppercase, k=8))} {''.join(random.choices(string.ascii_uppercase, k=6))}"),
        ("NOMBRE", random.choice(["PABLO", "MARIA", "CARLOS", "ANA", "JORGE", "LUCIA"])),
        ("FECHA NACIMIENTO", f"{random.randint(1,28):02d}/{random.randint(1,12):02d}/{random.randint(1970,2005)}"),
        ("DNI NUM", f"{random.randint(10000000, 99999999)}{random.choice(string.ascii_uppercase)}"),
        ("VALIDEZ", f"{random.randint(1,28):02d}/{random.randint(1,12):02d}/{random.randint(2026,2035)}"),
    ]
    y = 90
    for label, value in fields:
        draw.text((260, y), label, fill=(100, 100, 100))
        draw.text((260, y + 18), value, fill=(0, 0, 0))
        y += 50

    mrz1 = "IDESP" + "".join(random.choices(string.ascii_uppercase + string.digits, k=35))
    mrz2 = "".join(random.choices(string.digits + string.ascii_uppercase + "<", k=40))
    draw.text((30, 470), mrz1, fill=(0, 0, 0))
    draw.text((30, 495), mrz2, fill=(0, 0, 0))
    return img


def generate_passport_image():
    """Generate a synthetic passport-style document."""
    img = Image.new("RGB", (900, 600), color=(240, 245, 250))
    draw = ImageDraw.Draw(img)
    draw.rectangle([(0, 0), (900, 50)], fill=(0, 80, 160))
    country = random.choice(["UNITED KINGDOM", "FRANCE", "GERMANY", "ITALY", "JAPAN", "BRAZIL", "INDIA"])
    draw.text((20, 12), f"PASSPORT  {country}", fill="white")
    draw.rectangle([(30, 70), (250, 330)], outline=(100, 100, 100), width=2)

    fields = [
        ("Surname", "".join(random.choices(string.ascii_uppercase, k=random.randint(5, 10)))),
        ("Given Names", random.choice(["JAMES", "SOPHIE", "AHMED", "YUKI", "PRIYA", "LUCAS"])),
        ("Nationality", country[:3]),
        ("Passport No", f"{random.choice(string.ascii_uppercase)}{random.randint(1000000, 9999999)}"),
    ]
    y = 80
    for label, value in fields:
        draw.text((280, y), label, fill=(100, 100, 100))
        draw.text((280, y + 16), value, fill=(0, 0, 0))
        y += 45

    mrz1 = "P<" + "".join(random.choices(string.ascii_uppercase + "<", k=42))
    mrz2 = "".join(random.choices(string.digits + string.ascii_uppercase + "<", k=44))
    draw.text((30, 520), mrz1, fill=(0, 0, 0))
    draw.text((30, 548), mrz2, fill=(0, 0, 0))
    return img


def generate_diploma_image():
    """Generate a synthetic IE University diploma/transcript."""
    img = Image.new("RGB", (800, 1100), color=(255, 252, 245))
    draw = ImageDraw.Draw(img)
    draw.rectangle([(20, 20), (780, 1080)], outline=(180, 150, 100), width=3)
    uni = random.choice(["IE UNIVERSITY", "IE BUSINESS SCHOOL", "IE SCHOOL OF ARCHITECTURE"])
    draw.text((200, 60), uni, fill=(0, 51, 102))
    draw.text((250, 100), "ACADEMIC TRANSCRIPT", fill=(80, 80, 80))

    student = f"{''.join(random.choices(string.ascii_uppercase, k=6))} {''.join(random.choices(string.ascii_uppercase, k=8))}"
    draw.text((100, 160), f"Student: {student}", fill=(0, 0, 0))
    draw.text((100, 190), f"ID: IE-{random.randint(100000, 999999)}", fill=(0, 0, 0))
    draw.text((100, 220), f"Program: {random.choice(['BBA', 'MBA', 'MIM', 'LLM'])}", fill=(0, 0, 0))

    y = 280
    for sem in range(1, random.randint(4, 9)):
        draw.text((100, y), f"Semester {sem}", fill=(0, 51, 102))
        y += 25
        for _ in range(random.randint(4, 7)):
            course = "".join(random.choices(string.ascii_uppercase, k=3)) + str(random.randint(100, 499))
            grade = round(random.uniform(5.0, 10.0), 1)
            draw.text((120, y), f"{course}  -  {grade}/10", fill=(0, 0, 0))
            y += 20
        y += 10
    return img


DOC_GENERATORS = {"Dni": generate_dni_image, "Passport": generate_passport_image, "Diploma": generate_diploma_image}


# ── API Client ──

def send_document(host, port, doc_type, doc_id):
    generator = DOC_GENERATORS.get(doc_type, generate_dni_image)
    img = generator()
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    buf.seek(0)

    url = f"http://{host}:{port}/detect/document"
    t0 = time.time()
    try:
        resp = requests.post(url, files={"image": (f"{doc_type}_{doc_id}.jpg", buf, "image/jpeg")}, timeout=60)
        latency_ms = (time.time() - t0) * 1000
        if resp.status_code == 200:
            data = resp.json()
            return {"id": doc_id, "type": doc_type, "status": "OK", "latency_ms": round(latency_ms, 1),
                    "verdict": data.get("verdict", "unknown"), "p_tampered": round(data.get("p_tampered", data.get("p_fake", 0)), 4)}
        return {"id": doc_id, "type": doc_type, "status": f"HTTP {resp.status_code}", "latency_ms": round(latency_ms, 1), "verdict": "error", "p_tampered": 0}
    except Exception as e:
        return {"id": doc_id, "type": doc_type, "status": f"ERR: {str(e)[:40]}", "latency_ms": round((time.time() - t0) * 1000, 1), "verdict": "error", "p_tampered": 0}


# ── Dashboard ──

def print_dashboard(results, total, start_time, concurrent):
    elapsed = time.time() - start_time
    done = len(results)
    ok = sum(1 for r in results if r["status"] == "OK")
    latencies = [r["latency_ms"] for r in results if r["status"] == "OK"]
    avg_lat = statistics.mean(latencies) if latencies else 0
    p50 = statistics.median(latencies) if latencies else 0
    p95 = sorted(latencies)[int(len(latencies) * 0.95)] if len(latencies) > 1 else avg_lat
    throughput = done / elapsed if elapsed > 0 else 0
    pct = done / total * 100
    bar_len = 40
    filled = int(bar_len * done / total)
    bar = "\u2588" * filled + "\u2591" * (bar_len - filled)

    print(f"\033[2J\033[H", end="")
    print("=" * 70)
    print("  DEEP-CHECK LOAD TEST  |  IE UNIVERSITY SIMULATION")
    print("=" * 70)
    print(f"  Progress: [{bar}] {pct:.0f}%  ({done}/{total})")
    print(f"  Elapsed:  {elapsed:.1f}s  |  Concurrent: {concurrent}")
    print("-" * 70)
    print(f"  Throughput:  {throughput:.2f} docs/sec")
    print(f"  Avg Latency: {avg_lat:.0f}ms  |  P50: {p50:.0f}ms  |  P95: {p95:.0f}ms")
    print(f"  Success:     {ok}  |  Errors: {done - ok}")
    print("-" * 70)
    print("  RECENT RESULTS:")
    for r in results[-8:]:
        sc = "\033[92m" if r["status"] == "OK" else "\033[91m"
        v = f"{r['verdict']} (p={r['p_tampered']:.3f})" if r["status"] == "OK" else r["status"]
        print(f"  {sc}[{r['status']:>4}]\033[0m {r['type']:>8} #{r['id']:<4} | {r['latency_ms']:>7.0f}ms | {v}")
    print("-" * 70)
    if latencies:
        buckets = {"<100ms": 0, "100-500ms": 0, "500ms-1s": 0, "1-5s": 0, ">5s": 0}
        for l in latencies:
            if l < 100: buckets["<100ms"] += 1
            elif l < 500: buckets["100-500ms"] += 1
            elif l < 1000: buckets["500ms-1s"] += 1
            elif l < 5000: buckets["1-5s"] += 1
            else: buckets[">5s"] += 1
        print("  LATENCY DISTRIBUTION:")
        for bucket, count in buckets.items():
            pct_b = count / len(latencies) * 100
            bar_b = "\u2588" * int(pct_b / 2.5)
            print(f"    {bucket:>10}: {bar_b} {count} ({pct_b:.0f}%)")
    print("=" * 70)
    sys.stdout.flush()


# ── Main ──

def main():
    parser = argparse.ArgumentParser(description="Deep-Check Document Load Test")
    parser.add_argument("--host", default="100.116.188.12", help="ML Worker host")
    parser.add_argument("--port", default=8001, type=int)
    parser.add_argument("--docs", default=50, type=int, help="Total documents")
    parser.add_argument("--concurrent", default=3, type=int, help="Concurrent requests")
    args = parser.parse_args()

    mix = {"Dni": 40, "Passport": 30, "Diploma": 30}
    queue = []
    for doc_type, pct in mix.items():
        queue.extend([(doc_type, i) for i in range(int(args.docs * pct / 100))])
    random.shuffle(queue)
    while len(queue) < args.docs:
        queue.append((random.choice(list(mix.keys())), len(queue)))

    print(f"\n  Deep-Check Load Test | IE University")
    print(f"  Host: {args.host}:{args.port} | Docs: {args.docs} | Concurrent: {args.concurrent}")
    try:
        r = requests.get(f"http://{args.host}:{args.port}/health", timeout=5)
        print(f"  ML Worker: online\n")
    except Exception as e:
        print(f"  ERROR: Cannot reach ML Worker: {e}")
        return

    results = []
    start_time = time.time()
    doc_id = 0
    with ThreadPoolExecutor(max_workers=args.concurrent) as pool:
        futures = {}
        for doc_type, _ in queue:
            doc_id += 1
            futures[pool.submit(send_document, args.host, args.port, doc_type, doc_id)] = doc_id
        for future in as_completed(futures):
            results.append(future.result())
            print_dashboard(results, args.docs, start_time, args.concurrent)

    elapsed = time.time() - start_time
    ok = sum(1 for r in results if r["status"] == "OK")
    latencies = [r["latency_ms"] for r in results if r["status"] == "OK"]
    print(f"\n{'='*70}")
    print(f"  FINAL REPORT")
    print(f"{'='*70}")
    print(f"  Documents: {args.docs} | Success: {ok} | Failed: {args.docs - ok}")
    print(f"  Time: {elapsed:.1f}s | Throughput: {ok/elapsed:.2f} docs/sec")
    if latencies:
        print(f"  Avg: {statistics.mean(latencies):.0f}ms | P50: {statistics.median(latencies):.0f}ms | P95: {sorted(latencies)[int(len(latencies)*0.95)]:.0f}ms")
    print(f"{'='*70}\n")

    report_path = f"load_test_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(report_path, "w") as f:
        json.dump({"timestamp": datetime.now().isoformat(), "docs": args.docs, "concurrent": args.concurrent,
                    "elapsed_s": round(elapsed, 1), "throughput": round(ok/elapsed, 2), "success": ok, "errors": args.docs-ok,
                    "avg_ms": round(statistics.mean(latencies), 1) if latencies else 0, "results": results}, f, indent=2)
    print(f"  Report: {report_path}")


if __name__ == "__main__":
    main()
