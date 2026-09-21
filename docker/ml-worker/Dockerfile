# Deep-Check ML Worker -- All Verification Engines
# GPU mode: uses NVIDIA CUDA for DINOv3/DINOv2 inference
# CPU mode: falls back to ONNX EfficientNet

ARG GPU_MODE=auto

# GPU base image
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04 AS gpu-base
RUN apt-get update && apt-get install -y python3 python3-pip python3-dev libgl1 libglib2.0-0 awscli && rm -rf /var/lib/apt/lists/*
RUN ln -s /usr/bin/python3 /usr/bin/python

# CPU base image
FROM python:3.11-slim AS cpu-base
RUN apt-get update && apt-get install -y libgl1 libglib2.0-0 awscli && rm -rf /var/lib/apt/lists/*

# Select base based on GPU_MODE
FROM gpu-base AS base

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py .
COPY model_loader.py .
COPY engines/ engines/

# Model volume mount point
RUN mkdir -p /app/models/deepfake /app/models/doc_forensics /app/models/keystroke

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')" || exit 1

CMD ["python", "main.py"]
