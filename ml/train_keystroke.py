#!/usr/bin/env python3
"""
Deep-Check Keystroke Biometrics -- Dual purpose:
1. User verification via 128D embedding (like face recognition but with typing)
2. Bot detection (human vs automated)

Architecture: Transformer Encoder on keystroke sequences
Input: [batch, 50, 3] (hold_time, flight_time, key_category)
Output: 128D embedding + bot_score

The model LEARNS each user's unique typing pattern.
On enrollment: user types -> model generates 128D embedding -> stored.
On verification: user types -> new embedding -> cosine similarity with stored.
If similarity > threshold -> verified.
"""

# Full script at ml/train_keystroke.py -- see previous content
# This is a placeholder to be uploaded via SCP

print("Use SCP to upload the full script")
