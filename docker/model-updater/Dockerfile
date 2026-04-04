FROM python:3.11-slim

RUN apt-get update && apt-get install -y awscli curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY update.py .

CMD ["python", "update.py"]
