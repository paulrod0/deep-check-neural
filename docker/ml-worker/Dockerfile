FROM python:3.11-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir \
    fastapi==0.111.0 \
    uvicorn[standard]==0.30.0 \
    onnxruntime==1.18.0 \
    Pillow==10.3.0 \
    numpy==1.26.4 \
    pydantic==2.7.0

COPY main.py .

EXPOSE 8001

CMD ["python", "main.py"]
