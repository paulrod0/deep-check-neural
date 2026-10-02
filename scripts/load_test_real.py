#!/usr/bin/env python3
"""
Deep-Check Real Document Load Test
====================================
Processes real document images from a dataset directory.
Each image is sent to the ML Worker for forensic analysis.
Generates a full report with scores, verdicts, and performance metrics.

Usage:
  python3 scripts/load_test_real.py --host 100.116.188.12 --data /path/to/dataset --concurrent 5

Dataset structure expected:
  dataset/
    authentic/   ← real documents
    tampered/    ← manipulated documents
    OR
    *.jpg / *.png / *.pdf  ← mixed (no labels)
"""

import argparse
import time
import json
import os
import sys
import statistics
import glob
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests


def find_images(data_dir):
    """Find all image/PDF files in a directory tree."""
    extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.pdf', '.webp'}
    files = []
    for root, dirs, filenames in os.walk(data_dir):
        for f in filenames:
            if Path(f).suffix.lower() in extensions:
                full_path = os.path.join(root, f)
                # Determine label from parent folder name
                parent = os.path.basename(root).lower()
                if parent in ('authentic', 'real', 'genuine', 'original', 'pristine', 'au', 'tp'):
                    label = 'authentic'
                elif parent in ('tampered', 'fake', 'forged', 'manipulated', 'spliced', 'copy-move', 'sp', 'cm'):
                    label = 'tampered'
                else:
                    label = 'unknown'
                files.append({'path': full_path, 'label': label, 'name': f})
    return files


def send_document(host, port, file_info, endpoint='/detect/document'):
    """Send a document to the ML Worker."""
    path = file_info['path']
    t0 = time.time()

    try:
        with open(path, 'rb') as f:
            files = {'image': (file_info['name'], f, 'image/jpeg')}
            resp = requests.post(
                f'http://{host}:{port}{endpoint}',
                files=files,
                timeout=60,
            )

        latency_ms = (time.time() - t0) * 1000

        if resp.status_code == 200:
            data = resp.json()
            return {
                'file': file_info['name'],
                'label': file_info['label'],
                'status': 'OK',
                'verdict': data.get('verdict', 'unknown'),
                'p_tampered': data.get('p_tampered', 0),
                'model': data.get('model', ''),
                'pixel_p': data.get('pixel_forensics', {}).get('p_tampered', data.get('p_tampered', 0)),
                'structural_p': data.get('pdf_structural', {}).get('p_tampered', 0) if data.get('pdf_structural') else None,
                'qr_count': len(data.get('qr_codes', [])),
                'has_text': bool(data.get('text_extracted', '')),
                'latency_ms': round(latency_ms, 1),
            }
        else:
            return {
                'file': file_info['name'], 'label': file_info['label'],
                'status': f'HTTP {resp.status_code}', 'verdict': 'error',
                'p_tampered': 0, 'latency_ms': round(latency_ms, 1),
            }
    except Exception as e:
        return {
            'file': file_info['name'], 'label': file_info['label'],
            'status': f'ERR: {str(e)[:40]}', 'verdict': 'error',
            'p_tampered': 0, 'latency_ms': round((time.time() - t0) * 1000, 1),
        }


def print_dashboard(results, total, start_time, concurrent, target_time):
    elapsed = time.time() - start_time
    done = len(results)
    ok = sum(1 for r in results if r['status'] == 'OK')
    pct = done / total * 100
    throughput = done / elapsed if elapsed > 0 else 0
    eta = (total - done) / throughput if throughput > 0 else 0

    latencies = [r['latency_ms'] for r in results if r['status'] == 'OK']
    avg_lat = statistics.mean(latencies) if latencies else 0
    p50 = statistics.median(latencies) if latencies else 0
    p95 = sorted(latencies)[int(len(latencies) * 0.95)] if len(latencies) > 1 else avg_lat

    # Verdict distribution
    verdicts = {}
    for r in results:
        v = r.get('verdict', 'error')
        verdicts[v] = verdicts.get(v, 0) + 1

    bar_len = 40
    filled = int(bar_len * done / total)
    bar = '\u2588' * filled + '\u2591' * (bar_len - filled)
    on_track = elapsed + eta <= target_time

    print(f'\033[2J\033[H', end='')
    print('=' * 72)
    print('  DEEP-CHECK REAL DOCUMENT LOAD TEST')
    print('=' * 72)
    print(f'  [{bar}] {pct:.0f}%  ({done}/{total})')
    print(f'  Elapsed: {elapsed:.0f}s / {target_time:.0f}s target  |  ETA: {eta:.0f}s  |  {"ON TRACK" if on_track else "BEHIND"}')
    print(f'  Concurrent: {concurrent}  |  Throughput: {throughput:.1f} docs/sec')
    print('-' * 72)
    print(f'  Latency  — Avg: {avg_lat:.0f}ms  |  P50: {p50:.0f}ms  |  P95: {p95:.0f}ms')
    print(f'  Success: {ok}  |  Errors: {done - ok}')
    print('-' * 72)
    print('  VERDICT DISTRIBUTION:')
    for v, count in sorted(verdicts.items(), key=lambda x: -x[1]):
        pct_v = count / max(1, done) * 100
        color = '\033[92m' if v == 'authentic' else '\033[93m' if v in ('suspicious', 'likely_authentic', 'review_needed') else '\033[91m' if v == 'tampered' else '\033[90m'
        bar_v = '\u2588' * int(pct_v / 2.5)
        print(f'    {color}{v:>20}\033[0m  {bar_v} {count} ({pct_v:.0f}%)')

    # Last 5
    print('-' * 72)
    print('  RECENT:')
    for r in results[-5:]:
        sc = '\033[92m' if r['verdict'] == 'authentic' else '\033[91m' if r['verdict'] == 'tampered' else '\033[93m'
        lab = f' [{r["label"]}]' if r['label'] != 'unknown' else ''
        print(f'    {sc}{r["verdict"]:>15}\033[0m  p={r.get("p_tampered",0):.3f}  {r["latency_ms"]:>6.0f}ms  {r["file"][:35]}{lab}')
    print('=' * 72)
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser(description='Deep-Check Real Document Load Test')
    parser.add_argument('--host', default='100.116.188.12')
    parser.add_argument('--port', default=8001, type=int)
    parser.add_argument('--data', required=True, help='Path to dataset directory')
    parser.add_argument('--concurrent', default=5, type=int)
    parser.add_argument('--limit', default=0, type=int, help='Max docs to process (0=all)')
    parser.add_argument('--target-time', default=900, type=int, help='Target time in seconds (default 900=15min)')
    args = parser.parse_args()

    # Find documents
    files = find_images(args.data)
    if not files:
        print(f'ERROR: No images/PDFs found in {args.data}')
        return

    if args.limit > 0:
        files = files[:args.limit]

    total = len(files)
    labeled = sum(1 for f in files if f['label'] != 'unknown')

    print(f'\n  Deep-Check Real Document Load Test')
    print(f'  Host: {args.host}:{args.port}')
    print(f'  Dataset: {args.data}')
    print(f'  Documents: {total} ({labeled} labeled)')
    print(f'  Concurrent: {args.concurrent}')
    print(f'  Target: {args.target_time}s ({args.target_time/60:.0f} min)')

    # Health check
    try:
        r = requests.get(f'http://{args.host}:{args.port}/health', timeout=5)
        print(f'  ML Worker: online\n')
    except Exception as e:
        print(f'  ERROR: Cannot reach ML Worker: {e}')
        return

    results = []
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=args.concurrent) as pool:
        futures = {}
        for fi in files:
            futures[pool.submit(send_document, args.host, args.port, fi)] = fi

        for future in as_completed(futures):
            results.append(future.result())
            print_dashboard(results, total, start_time, args.concurrent, args.target_time)

    # Final report
    elapsed = time.time() - start_time
    ok = sum(1 for r in results if r['status'] == 'OK')
    latencies = [r['latency_ms'] for r in results if r['status'] == 'OK']

    verdicts = {}
    for r in results:
        v = r.get('verdict', 'error')
        verdicts[v] = verdicts.get(v, 0) + 1

    # Accuracy (if labeled)
    tp = sum(1 for r in results if r['label'] == 'tampered' and r['verdict'] in ('tampered', 'suspicious'))
    tn = sum(1 for r in results if r['label'] == 'authentic' and r['verdict'] in ('authentic', 'likely_authentic'))
    fp = sum(1 for r in results if r['label'] == 'authentic' and r['verdict'] in ('tampered', 'suspicious'))
    fn = sum(1 for r in results if r['label'] == 'tampered' and r['verdict'] in ('authentic', 'likely_authentic'))
    total_labeled = tp + tn + fp + fn
    accuracy = (tp + tn) / total_labeled if total_labeled > 0 else 0

    print(f'\n{"="*72}')
    print(f'  FINAL REPORT')
    print(f'{"="*72}')
    print(f'  Documents: {total}  |  Success: {ok}  |  Errors: {total - ok}')
    print(f'  Time: {elapsed:.1f}s ({elapsed/60:.1f} min)  |  Target: {args.target_time/60:.0f} min  |  {"PASSED" if elapsed <= args.target_time else "FAILED"}')
    print(f'  Throughput: {ok/elapsed:.2f} docs/sec  ({ok/elapsed*60:.0f} docs/min)')
    if latencies:
        print(f'  Latency: Avg {statistics.mean(latencies):.0f}ms  |  P50 {statistics.median(latencies):.0f}ms  |  P95 {sorted(latencies)[int(len(latencies)*0.95)]:.0f}ms  |  Max {max(latencies):.0f}ms')
    print(f'\n  VERDICTS:')
    for v, count in sorted(verdicts.items(), key=lambda x: -x[1]):
        print(f'    {v:>20}: {count} ({count/total*100:.1f}%)')
    if total_labeled > 0:
        print(f'\n  ACCURACY (labeled data):')
        print(f'    True Positive:  {tp}  (tampered correctly detected)')
        print(f'    True Negative:  {tn}  (authentic correctly passed)')
        print(f'    False Positive: {fp}  (authentic flagged as tampered)')
        print(f'    False Negative: {fn}  (tampered missed)')
        print(f'    Accuracy:       {accuracy*100:.1f}%')
        if tp + fp > 0:
            print(f'    Precision:      {tp/(tp+fp)*100:.1f}%')
        if tp + fn > 0:
            print(f'    Recall:         {tp/(tp+fn)*100:.1f}%')
    print(f'{"="*72}\n')

    # Save report
    report = {
        'timestamp': datetime.now().isoformat(),
        'host': args.host,
        'dataset': args.data,
        'total': total,
        'success': ok,
        'errors': total - ok,
        'elapsed_s': round(elapsed, 1),
        'target_s': args.target_time,
        'passed': elapsed <= args.target_time,
        'throughput': round(ok / elapsed, 2),
        'avg_ms': round(statistics.mean(latencies), 1) if latencies else 0,
        'p50_ms': round(statistics.median(latencies), 1) if latencies else 0,
        'p95_ms': round(sorted(latencies)[int(len(latencies) * 0.95)], 1) if len(latencies) > 1 else 0,
        'verdicts': verdicts,
        'accuracy': round(accuracy, 4) if total_labeled > 0 else None,
        'results': results,
    }
    report_path = f'load_test_real_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2)
    print(f'  Report: {report_path}')


if __name__ == '__main__':
    main()
